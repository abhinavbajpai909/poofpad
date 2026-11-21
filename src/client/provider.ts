import {
  type Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { CloseCode } from "../shared/codes";
import {
  AWARENESS_THROTTLE_MS,
  MAX_SNAPSHOT_FRAME_BYTES,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  UPDATE_BATCH_MS,
} from "../shared/limits";
import {
  FrameType,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  type PadInfo,
  decodeCompactRequest,
  decodeError,
  decodeFrame,
  decodeInfo,
  decodeSyncAll,
  encodeFrame,
} from "../shared/protocol";
import { Purpose, decrypt, encrypt } from "./crypto";
import { MAX_UPDATE_BYTES } from "./edit-limit";
import { type Heartbeat, startHeartbeat } from "./heartbeat";
import { createLocalLog } from "./local-log";
import { createSerialQueue } from "./serial-queue";
import { encodeSnapshotFrame } from "./snapshot";

export type ConnectionStatus = "connecting" | "online" | "offline";

export interface PadConnectionHandlers {
  onStatus(status: ConnectionStatus): void;
  onInfo(info: PadInfo): void;
  onClosed(code: number): void;
  onWrongKey(): void;
}

export interface PadConnection {
  /** Bytes of Yjs update the next local change may produce without overflowing a frame. */
  editBudget(): number;
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

const REMOTE = Symbol("remote");

const RETRYABLE_CLOSE_CODES: ReadonlySet<number> = new Set([CloseCode.RateLimited]);

/** Our own close of a connection we gave up on; not terminal, so the client reconnects. */
const CLOSE_ABANDONED = 1000;

function isTerminalClose(code: number): boolean {
  return code >= 4000 ? !RETRYABLE_CLOSE_CODES.has(code) : code === CloseCode.UnsupportedData;
}

function socketUrl(padId: string): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws/${padId}`;
}

function reconnectDelay(attempt: number): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

export function connectPad(
  padId: string,
  key: CryptoKey,
  doc: Y.Doc,
  awareness: Awareness,
  handlers: PadConnectionHandlers,
): PadConnection {
  let socket: WebSocket | null = null;
  let stopped = false;
  let synced = false;
  let attempt = 0;
  let lastPeers = 0;
  let serverError: number | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let updateTimer: ReturnType<typeof setTimeout> | undefined;
  let awarenessTimer: ReturnType<typeof setTimeout> | undefined;
  let awarenessDirty = false;
  let heartbeat: Heartbeat | null = null;
  let pendingUpdates: Uint8Array[] = [];
  let pendingBytes = 0;
  const localLog = createLocalLog();
  const outbox = createSerialQueue();
  const inbox = createSerialQueue();

  function sendEncrypted(type: FrameType, purpose: Purpose, plaintext: Uint8Array): void {
    outbox(async () => {
      const payload = await encrypt(key, purpose, plaintext);
      if (synced && socket?.readyState === WebSocket.OPEN) {
        socket.send(encodeFrame(type, payload));
      }
    });
  }

  function flushUpdates(): void {
    clearTimeout(updateTimer);
    updateTimer = undefined;
    if (!synced || pendingUpdates.length === 0) {
      return;
    }
    const merged = Y.mergeUpdates(pendingUpdates);
    pendingUpdates = [];
    pendingBytes = 0;
    sendEncrypted(FrameType.Update, Purpose.Doc, merged);
  }

  function sendAwareness(): void {
    awarenessDirty = false;
    if (synced) {
      sendEncrypted(
        FrameType.Awareness,
        Purpose.Awareness,
        encodeAwarenessUpdate(awareness, [doc.clientID]),
      );
    }
  }

  function scheduleAwareness(): void {
    awarenessDirty = true;
    if (awarenessTimer !== undefined) {
      return;
    }
    sendAwareness();
    awarenessTimer = setTimeout(() => {
      awarenessTimer = undefined;
      if (awarenessDirty) {
        scheduleAwareness();
      }
    }, AWARENESS_THROTTLE_MS);
  }

  function announceAwareness(): void {
    const state = awareness.getLocalState();
    if (state !== null) {
      awareness.setLocalState(state);
    }
  }

  function onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === REMOTE) {
      return;
    }
    localLog.add(update);
    if (pendingBytes + update.byteLength > MAX_UPDATE_BYTES) {
      flushUpdates();
    }
    pendingUpdates.push(update);
    pendingBytes += update.byteLength;
    updateTimer ??= setTimeout(flushUpdates, UPDATE_BATCH_MS);
  }

  /**
   * Online, a batch that would overflow is flushed first, so each change only has to fit a frame on its
   * own. Offline, everything unsent goes out as one diff on reconnect, so the backlog counts too.
   */
  function editBudget(): number {
    return synced ? MAX_UPDATE_BYTES : MAX_UPDATE_BYTES - pendingBytes;
  }

  function onAwarenessUpdate({ added, updated, removed }: AwarenessChange): void {
    if ([...added, ...updated, ...removed].includes(doc.clientID)) {
      scheduleAwareness();
    }
  }

  function stop(): void {
    stopped = true;
    synced = false;
    clearTimeout(reconnectTimer);
    clearTimeout(updateTimer);
    clearTimeout(awarenessTimer);
    doc.off("update", onDocUpdate);
    awareness.off("update", onAwarenessUpdate);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    heartbeat?.stop();
    heartbeat = null;
    const current = socket;
    socket = null;
    current?.close(1000);
  }

  /**
   * The first stored row is the pad's key check: every client that joins an empty pad writes one, so a
   * client that can't decrypt it has the wrong key. Later rows that fail come from someone else with a
   * wrong key and are skipped.
   */
  async function handleSyncAll(ws: WebSocket, payload: Uint8Array): Promise<void> {
    const rows = decodeSyncAll(payload);
    if (rows === null) {
      return;
    }
    const plain = await Promise.all(rows.map((row) => decrypt(key, Purpose.Doc, row)));
    if (socket !== ws) {
      return;
    }
    if (rows.length > 0 && plain[0] === null) {
      stop();
      handlers.onWrongKey();
      return;
    }
    const serverUpdate = Y.mergeUpdates(plain.filter((row) => row !== null));
    const serverDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, serverUpdate);
    Y.applyUpdate(doc, serverUpdate, REMOTE);

    synced = true;
    attempt = 0;
    pendingUpdates = [];
    pendingBytes = 0;
    clearTimeout(updateTimer);
    updateTimer = undefined;
    if (rows.length === 0 || !Y.equalSnapshots(Y.snapshot(doc), Y.snapshot(serverDoc))) {
      for (const frame of framesForServer(serverDoc)) {
        sendEncrypted(FrameType.Update, Purpose.Doc, frame);
      }
      localLog.prune(serverDoc);
    } else {
      localLog.clear();
    }
    serverDoc.destroy();
    handlers.onStatus("online");
  }

  /**
   * What the server lacks, as frames that each fit. Normally one diff. After a drop it can be larger than a
   * frame (an update lost in flight plus offline edits, each of which fitted); then the logged pieces are
   * resent instead. Only if the log has dropped old entries is the diff sent anyway.
   */
  function framesForServer(serverDoc: Y.Doc): Uint8Array[] {
    const diff = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(serverDoc));
    if (diff.byteLength <= MAX_UPDATE_BYTES) {
      return [diff];
    }
    return localLog.missingFrom(serverDoc, MAX_UPDATE_BYTES) ?? [diff];
  }

  async function handleUpdate(ws: WebSocket, payload: Uint8Array): Promise<void> {
    const update = await decrypt(key, Purpose.Doc, payload);
    if (update !== null && socket === ws) {
      Y.applyUpdate(doc, update, REMOTE);
    }
  }

  async function handleAwareness(ws: WebSocket, payload: Uint8Array): Promise<void> {
    const update = await decrypt(key, Purpose.Awareness, payload);
    if (update !== null && socket === ws) {
      applyAwarenessUpdate(awareness, update, REMOTE);
    }
  }

  function handleInfo(payload: Uint8Array): void {
    const info = decodeInfo(payload);
    if (info === null) {
      return;
    }
    if (info.peers > lastPeers) {
      announceAwareness();
    }
    lastPeers = info.peers;
    handlers.onInfo(info);
  }

  function handleCompactRequest(ws: WebSocket, payload: Uint8Array): void {
    const upToSeq = decodeCompactRequest(payload);
    if (upToSeq === null || !synced) {
      return;
    }
    const pending = encodeSnapshotFrame(key, doc, upToSeq);
    outbox(async () => {
      const frame = await pending;
      const fits = frame.byteLength <= MAX_SNAPSHOT_FRAME_BYTES;
      if (fits && socket === ws && synced && ws.readyState === WebSocket.OPEN) {
        ws.send(frame);
      }
    });
  }

  function handleError(payload: Uint8Array): void {
    serverError = decodeError(payload);
  }

  async function handleMessage(ws: WebSocket, data: ArrayBuffer): Promise<void> {
    if (socket !== ws) {
      return;
    }
    const frame = decodeFrame(data, Number.POSITIVE_INFINITY);
    if (frame === null) {
      return;
    }
    switch (frame.type) {
      case FrameType.SyncAll:
        await handleSyncAll(ws, frame.payload);
        return;
      case FrameType.Update:
        await handleUpdate(ws, frame.payload);
        return;
      case FrameType.Awareness:
        await handleAwareness(ws, frame.payload);
        return;
      case FrameType.Info:
        handleInfo(frame.payload);
        return;
      case FrameType.CompactRequest:
        handleCompactRequest(ws, frame.payload);
        return;
      case FrameType.Error:
        handleError(frame.payload);
        return;
      default:
        return;
    }
  }

  function onMessage(ws: WebSocket, event: MessageEvent): void {
    const data: unknown = event.data;
    if (data instanceof ArrayBuffer) {
      inbox(() => handleMessage(ws, data));
    } else if (data === HEARTBEAT_PONG && socket === ws) {
      heartbeat?.pong();
    }
  }

  function dropRemoteAwareness(): void {
    const remote = [...awareness.getStates().keys()].filter((id) => id !== doc.clientID);
    removeAwarenessStates(awareness, remote, REMOTE);
  }

  function onClose(ws: WebSocket, event: CloseEvent): void {
    if (socket === ws && !stopped) {
      connectionLost(serverError ?? event.code);
    }
  }

  /**
   * A connection that is dead without having closed (no pong, or the browser went offline): give up on it
   * now instead of waiting for a close that can take minutes on mobile networks. Edits made meanwhile are
   * kept and sent as one diff after the reconnect sync, like after any other drop.
   */
  function abandon(ws: WebSocket): void {
    if (socket !== ws || stopped) {
      return;
    }
    connectionLost(CLOSE_ABANDONED);
    ws.close(CLOSE_ABANDONED);
  }

  function connectionLost(code: number): void {
    heartbeat?.stop();
    heartbeat = null;
    socket = null;
    synced = false;
    lastPeers = 0;
    dropRemoteAwareness();
    serverError = null;
    if (isTerminalClose(code)) {
      stop();
      handlers.onClosed(code);
      return;
    }
    handlers.onStatus("offline");
    reconnectTimer = setTimeout(reconnectWhenOnline, reconnectDelay(attempt));
    attempt += 1;
  }

  function connect(): void {
    reconnectTimer = undefined;
    handlers.onStatus("connecting");
    const ws = new WebSocket(socketUrl(padId));
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", () => {
      if (socket === ws) {
        heartbeat = startHeartbeat({
          ping: () => ws.send(HEARTBEAT_PING),
          onDead: () => abandon(ws),
          isVisible: () => document.visibilityState === "visible",
        });
      }
    });
    ws.addEventListener("message", (event) => onMessage(ws, event));
    ws.addEventListener("close", (event) => onClose(ws, event));
    socket = ws;
  }

  /** While the browser says it is offline, attempts are pointless: wait for "online" (or check again later). */
  function reconnectWhenOnline(): void {
    if (navigator.onLine) {
      connect();
    } else {
      reconnectTimer = setTimeout(reconnectWhenOnline, RECONNECT_MAX_MS);
    }
  }

  function onOnline(): void {
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      attempt = 0;
      connect();
    }
  }

  function onOffline(): void {
    if (socket !== null) {
      abandon(socket);
    }
  }

  function onVisibilityChange(): void {
    heartbeat?.visibilityChanged();
  }

  function onPageHide(): void {
    flushUpdates();
    if (synced) {
      sendEncrypted(
        FrameType.Awareness,
        Purpose.Awareness,
        encodeAwarenessUpdate(awareness, [doc.clientID], new Map()),
      );
    }
  }

  doc.on("update", onDocUpdate);
  awareness.on("update", onAwarenessUpdate);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibilityChange);
  connect();
  return { editBudget };
}
