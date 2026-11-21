import { DurableObject } from "cloudflare:workers";
import { CloseCode, type ErrorCloseCode } from "../shared/codes";
import {
  BURN_RETRY_MS,
  COMPACT_MAX_BYTES,
  COMPACT_MAX_ROWS,
  COMPACT_RETRY_MS,
  MAX_FRAME_BYTES,
  MAX_MESSAGES_PER_SECOND,
  MAX_PEERS_PER_PAD,
  MAX_SNAPSHOT_FRAME_BYTES,
  MAX_STORED_BYTES_PER_PAD,
  RATE_WINDOW_MS,
} from "../shared/limits";
import {
  FrameType,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  decodeFrame,
  decodeSnapshot,
  encodeCompactRequest,
  encodeError,
  encodeFrame,
  encodeInfo,
  encodeSyncAll,
} from "../shared/protocol";
import { acceptWebSocket, refuseWebSocket } from "./http";
import { hashesMatch } from "./tokens";

interface PadMeta {
  expiresAt: number;
  adminHash: string;
}

interface StoredStats {
  rows: number;
  bytes: number;
  /** Size of the oldest row: the base snapshot once the pad has been compacted. */
  oldestBytes: number;
}

/** Per-socket state, kept in the socket attachment so it survives hibernation. */
interface SocketState {
  /** Arrival times of recent messages (ms), for the sliding rate window. */
  hits: number[];
  /** The `upToSeq` of the COMPACT_REQUEST this socket may answer, if any. */
  compactUpTo: number | null;
}

export type CreateResult = { ok: true; expiresAt: number } | { ok: false; busy: boolean };
export type EndResult = "ended" | "unauthorized" | "notFound" | "busy";

function readSocketState(ws: WebSocket): SocketState {
  const value: unknown = ws.deserializeAttachment();
  if (typeof value === "object" && value !== null) {
    const { hits, compactUpTo } = value as Record<string, unknown>;
    if (
      Array.isArray(hits) &&
      hits.every((hit) => typeof hit === "number") &&
      (compactUpTo === null || typeof compactUpTo === "number")
    ) {
      return { hits, compactUpTo };
    }
  }
  return { hits: [], compactUpTo: null };
}

export class Pad extends DurableObject<Env> {
  /** Cache of `updates` totals. Recomputed from storage whenever it is null (e.g. after hibernation). */
  private stats: StoredStats | null = null;
  /** Throttles COMPACT_REQUEST. Losing it to hibernation only means asking again, which is harmless. */
  private lastCompactRequestAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // The runtime answers heartbeat pings itself, even while the object hibernates: no wake-up, no duration,
    // not billed, and they never reach webSocketMessage (so they don't count towards the rate limit).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG));
  }

  async create(ttlSeconds: number, adminHash: string): Promise<CreateResult> {
    if (this.readMeta() !== null) {
      return { ok: false, busy: false };
    }
    const sql = this.ctx.storage.sql;
    const expiresAt = Date.now() + ttlSeconds * 1000;
    try {
      this.ctx.storage.transactionSync(() => {
        sql.exec(
          "CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), expires_at INTEGER NOT NULL, admin_hash TEXT NOT NULL)",
        );
        sql.exec(
          "CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL)",
        );
        sql.exec(
          "INSERT INTO meta (id, expires_at, admin_hash) VALUES (1, ?, ?)",
          expiresAt,
          adminHash,
        );
      });
      await this.ctx.storage.setAlarm(expiresAt);
    } catch {
      return { ok: false, busy: true };
    }
    return { ok: true, expiresAt };
  }

  async end(adminHash: string): Promise<EndResult> {
    const meta = await this.liveMeta();
    if (meta === null) {
      return "notFound";
    }
    if (!hashesMatch(meta.adminHash, adminHash)) {
      return "unauthorized";
    }
    try {
      await this.burn();
    } catch {
      return "busy";
    }
    return "ended";
  }

  override async fetch(): Promise<Response> {
    const meta = await this.liveMeta();
    if (meta === null) {
      return refuseWebSocket(CloseCode.NotFound);
    }
    if (this.openSockets(null).length >= MAX_PEERS_PER_PAD) {
      return refuseWebSocket(CloseCode.PadFull);
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ hits: [], compactUpTo: null } satisfies SocketState);
    server.send(encodeFrame(FrameType.SyncAll, encodeSyncAll(this.readRows())));
    this.broadcastInfo(meta, null);
    return acceptWebSocket(client);
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.withinRateLimit(ws)) {
      this.reject(ws, CloseCode.RateLimited);
      return;
    }
    if (typeof message === "string") {
      ws.close(CloseCode.UnsupportedData, "unsupported frame");
      return;
    }
    if (message.byteLength > MAX_SNAPSHOT_FRAME_BYTES) {
      this.reject(ws, CloseCode.TooLarge);
      return;
    }
    const frame = decodeFrame(message, MAX_SNAPSHOT_FRAME_BYTES);
    if (frame === null) {
      ws.close(CloseCode.UnsupportedData, "unsupported frame");
      return;
    }
    if (frame.type !== FrameType.Snapshot && message.byteLength > MAX_FRAME_BYTES) {
      this.reject(ws, CloseCode.TooLarge);
      return;
    }
    if ((await this.liveMeta()) === null) {
      return;
    }
    switch (frame.type) {
      case FrameType.Update:
        this.storeUpdate(ws, frame.payload);
        return;
      case FrameType.Awareness:
        this.relay(ws, frame.type, frame.payload);
        return;
      case FrameType.Snapshot:
        this.applySnapshot(ws, frame.payload);
        return;
      default:
        ws.close(CloseCode.UnsupportedData, "unsupported frame");
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.peerLeft(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.peerLeft(ws);
  }

  override async alarm(): Promise<void> {
    await this.expire();
  }

  private withinRateLimit(ws: WebSocket): boolean {
    const now = Date.now();
    const state = readSocketState(ws);
    const hits = state.hits.filter((hit) => now - hit < RATE_WINDOW_MS);
    if (hits.length >= MAX_MESSAGES_PER_SECOND) {
      return false;
    }
    hits.push(now);
    ws.serializeAttachment({ ...state, hits } satisfies SocketState);
    return true;
  }

  /** Sends `ERROR` with the close code, then closes the socket with it. */
  private reject(ws: WebSocket, code: ErrorCloseCode): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encodeFrame(FrameType.Error, encodeError(code)));
      ws.close(code, "error");
    }
  }

  /**
   * Runs a storage write. Any failure is reported as "service busy": exceeding a free-plan daily limit makes
   * writes throw until 00:00 UTC, and Cloudflare does not document a distinguishable error for it.
   */
  private tryWrite(ws: WebSocket, write: () => void): boolean {
    try {
      write();
      return true;
    } catch {
      this.stats = null;
      this.reject(ws, CloseCode.ServiceBusy);
      return false;
    }
  }

  private storeUpdate(ws: WebSocket, payload: Uint8Array<ArrayBuffer>): void {
    const stats = this.readStats();
    if (stats.bytes + payload.byteLength > MAX_STORED_BYTES_PER_PAD) {
      this.reject(ws, CloseCode.TooLarge);
      return;
    }
    let seq = 0;
    const stored = this.tryWrite(ws, () => {
      seq = this.ctx.storage.sql
        .exec<{ seq: number }>(
          "INSERT INTO updates (data) VALUES (?) RETURNING seq",
          payload.slice().buffer,
        )
        .one().seq;
    });
    if (!stored) {
      return;
    }
    this.stats = {
      rows: stats.rows + 1,
      bytes: stats.bytes + payload.byteLength,
      oldestBytes: stats.rows === 0 ? payload.byteLength : stats.oldestBytes,
    };
    this.relay(ws, FrameType.Update, payload);
    this.maybeRequestCompaction(ws, seq, this.stats);
  }

  /** Asks the writer of the newest row for a snapshot covering every row up to and including it. */
  private maybeRequestCompaction(ws: WebSocket, seq: number, stats: StoredStats): void {
    const now = Date.now();
    const needed =
      stats.rows > COMPACT_MAX_ROWS || stats.bytes - stats.oldestBytes > COMPACT_MAX_BYTES;
    if (!needed || now - this.lastCompactRequestAt < COMPACT_RETRY_MS) {
      return;
    }
    this.lastCompactRequestAt = now;
    ws.serializeAttachment({ ...readSocketState(ws), compactUpTo: seq } satisfies SocketState);
    ws.send(encodeFrame(FrameType.CompactRequest, encodeCompactRequest(seq)));
  }

  /**
   * Replaces rows `seq <= upToSeq` with the snapshot, stored at `seq = upToSeq`; newer rows are untouched.
   * Only the socket that was asked may answer, once. A snapshot that does not cover any row beyond the
   * oldest stored one (stale: a newer snapshot already landed) is ignored.
   */
  private applySnapshot(ws: WebSocket, payload: Uint8Array<ArrayBuffer>): void {
    const snapshot = decodeSnapshot(payload);
    if (snapshot === null) {
      ws.close(CloseCode.UnsupportedData, "unsupported frame");
      return;
    }
    const state = readSocketState(ws);
    if (state.compactUpTo !== snapshot.upToSeq) {
      return;
    }
    ws.serializeAttachment({ ...state, compactUpTo: null } satisfies SocketState);
    const sql = this.ctx.storage.sql;
    const oldest = sql
      .exec<{ seq: number | null }>("SELECT MIN(seq) AS seq FROM updates")
      .one().seq;
    if (oldest === null || oldest >= snapshot.upToSeq) {
      return;
    }
    const compacted = this.tryWrite(ws, () => {
      this.ctx.storage.transactionSync(() => {
        sql.exec("DELETE FROM updates WHERE seq <= ?", snapshot.upToSeq);
        sql.exec(
          "INSERT INTO updates (seq, data) VALUES (?, ?)",
          snapshot.upToSeq,
          snapshot.data.slice().buffer,
        );
      });
    });
    this.stats = null;
    if (compacted) {
      // The 10 s wait is only for unanswered requests; after an answer, the next one may go out at once.
      this.lastCompactRequestAt = 0;
    }
  }

  private async peerLeft(ws: WebSocket): Promise<void> {
    const meta = await this.liveMeta();
    if (meta !== null) {
      this.broadcastInfo(meta, ws);
    }
  }

  /** Deletes everything (including the alarm), then closes every socket with 4001. */
  private async burn(): Promise<void> {
    this.stats = null;
    await this.ctx.storage.deleteAll();
    this.closeAll();
  }

  /**
   * Expiry. If deletion fails (e.g. free-plan quota), sockets are still closed — `expires_at` already
   * blocks all access — and the alarm is re-armed to delete the ciphertext later.
   */
  private async expire(): Promise<void> {
    try {
      await this.burn();
    } catch {
      this.closeAll();
      await this.ctx.storage.setAlarm(Date.now() + BURN_RETRY_MS);
    }
  }

  private closeAll(): void {
    for (const socket of this.ctx.getWebSockets()) {
      this.reject(socket, CloseCode.Expired);
    }
  }

  private readMeta(): PadMeta | null {
    const sql = this.ctx.storage.sql;
    const tables = sql
      .exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
      .toArray();
    if (tables.length === 0) {
      return null;
    }
    const row = sql
      .exec<{ expires_at: number; admin_hash: string }>(
        "SELECT expires_at, admin_hash FROM meta WHERE id = 1",
      )
      .toArray()[0];
    return row === undefined ? null : { expiresAt: row.expires_at, adminHash: row.admin_hash };
  }

  /** Meta of a pad that exists and has not expired. An expired pad found here is deleted now. */
  private async liveMeta(): Promise<PadMeta | null> {
    const meta = this.readMeta();
    if (meta === null) {
      return null;
    }
    if (meta.expiresAt <= Date.now()) {
      await this.expire();
      return null;
    }
    return meta;
  }

  private readStats(): StoredStats {
    if (this.stats === null) {
      const sql = this.ctx.storage.sql;
      const totals = sql
        .exec<{ rows: number; bytes: number }>(
          "SELECT COUNT(*) AS rows, COALESCE(SUM(length(data)), 0) AS bytes FROM updates",
        )
        .one();
      const oldest = sql
        .exec<{ bytes: number }>("SELECT length(data) AS bytes FROM updates ORDER BY seq LIMIT 1")
        .toArray()[0];
      this.stats = { rows: totals.rows, bytes: totals.bytes, oldestBytes: oldest?.bytes ?? 0 };
    }
    return this.stats;
  }

  private readRows(): Uint8Array[] {
    return this.ctx.storage.sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM updates ORDER BY seq")
      .toArray()
      .map((row) => new Uint8Array(row.data));
  }

  private openSockets(except: WebSocket | null): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket !== except && socket.readyState === WebSocket.OPEN);
  }

  private relay(sender: WebSocket, type: FrameType, payload: Uint8Array): void {
    const frame = encodeFrame(type, payload);
    for (const socket of this.openSockets(sender)) {
      socket.send(frame);
    }
  }

  private broadcastInfo(meta: PadMeta, leaving: WebSocket | null): void {
    const sockets = this.openSockets(leaving);
    const frame = encodeFrame(
      FrameType.Info,
      encodeInfo({ peers: sockets.length, expiresAt: meta.expiresAt, now: Date.now() }),
    );
    for (const socket of sockets) {
      socket.send(frame);
    }
  }
}
