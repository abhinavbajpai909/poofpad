import { DurableObject } from "cloudflare:workers";
import { CloseCode } from "../shared/codes";
import { MAX_FRAME_BYTES } from "../shared/limits";
import { FrameType, decodeFrame, encodeFrame, encodeInfo, encodeSyncAll } from "../shared/protocol";

interface PadMeta {
  expiresAt: number;
}

export class Pad extends DurableObject<Env> {
  async create(ttlSeconds: number, adminHash: string): Promise<number | null> {
    if (this.readMeta() !== null) {
      return null;
    }
    const sql = this.ctx.storage.sql;
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        "CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), expires_at INTEGER NOT NULL, admin_hash TEXT NOT NULL)",
      );
      sql.exec("CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY, data BLOB NOT NULL)");
      sql.exec(
        "INSERT INTO meta (id, expires_at, admin_hash) VALUES (1, ?, ?)",
        expiresAt,
        adminHash,
      );
    });
    await this.ctx.storage.setAlarm(expiresAt);
    return expiresAt;
  }

  override async fetch(): Promise<Response> {
    const meta = await this.liveMeta();
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    if (meta === null) {
      server.accept();
      server.close(CloseCode.NotFound, "not found");
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    server.send(encodeFrame(FrameType.SyncAll, encodeSyncAll(this.readRows())));
    this.broadcastInfo(meta, null);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const frame = typeof message === "string" ? null : decodeFrame(message, MAX_FRAME_BYTES);
    if (frame === null) {
      ws.close(CloseCode.UnsupportedData, "unsupported frame");
      return;
    }
    if ((await this.liveMeta()) === null) {
      return;
    }
    switch (frame.type) {
      case FrameType.Update:
        this.ctx.storage.sql.exec(
          "INSERT INTO updates (data) VALUES (?)",
          frame.payload.slice().buffer,
        );
        this.relay(ws, frame.type, frame.payload);
        return;
      case FrameType.Awareness:
        this.relay(ws, frame.type, frame.payload);
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
    await this.burn();
  }

  private async peerLeft(ws: WebSocket): Promise<void> {
    const meta = await this.liveMeta();
    if (meta !== null) {
      this.broadcastInfo(meta, ws);
    }
  }

  private async burn(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(CloseCode.Expired, "expired");
    }
    await this.ctx.storage.deleteAll();
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
      .exec<{ expires_at: number }>("SELECT expires_at FROM meta WHERE id = 1")
      .toArray()[0];
    return row === undefined ? null : { expiresAt: row.expires_at };
  }

  private async liveMeta(): Promise<PadMeta | null> {
    const meta = this.readMeta();
    if (meta === null) {
      return null;
    }
    if (meta.expiresAt <= Date.now()) {
      await this.burn();
      return null;
    }
    return meta;
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
      encodeInfo({ peers: sockets.length, expiresAt: meta.expiresAt }),
    );
    for (const socket of sockets) {
      socket.send(frame);
    }
  }
}
