import { ERROR_CODE_BASE, type ErrorCloseCode, isErrorCloseCode } from "./codes";

export const FrameType = {
  Update: 1,
  Awareness: 2,
  SyncAll: 3,
  CompactRequest: 4,
  Snapshot: 5,
  Info: 6,
  Error: 7,
} as const;

export type FrameType = (typeof FrameType)[keyof typeof FrameType];

/**
 * Heartbeat: the only text frames. The client sends exactly this ping and the Cloudflare runtime answers
 * with exactly this pong (WebSocket auto-response), without waking the Durable Object. No content.
 */
export const HEARTBEAT_PING = "ping";
export const HEARTBEAT_PONG = "pong";

const FRAME_TYPES: ReadonlySet<number> = new Set(Object.values(FrameType));

export interface Frame {
  type: FrameType;
  payload: Uint8Array<ArrayBuffer>;
}

export interface PadInfo {
  peers: number;
  expiresAt: number;
  /** The server's clock (ms since epoch) when it sent this, so clients can correct their own clock. */
  now: number;
}

export interface Snapshot {
  upToSeq: number;
  data: Uint8Array<ArrayBuffer>;
}

const LENGTH_PREFIX_BYTES = 4;
const SEQ_BYTES = 4;
const MAX_SEQ = 0xffff_ffff;

function isFrameType(value: number): value is FrameType {
  return FRAME_TYPES.has(value);
}

export function encodeFrame(type: FrameType, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(1 + payload.byteLength);
  frame[0] = type;
  frame.set(payload, 1);
  return frame;
}

export function decodeFrame(data: ArrayBuffer, maxBytes: number): Frame | null {
  if (data.byteLength === 0 || data.byteLength > maxBytes) {
    return null;
  }
  const type = new Uint8Array(data, 0, 1)[0];
  if (type === undefined || !isFrameType(type)) {
    return null;
  }
  return { type, payload: new Uint8Array(data, 1) };
}

export function encodeSyncAll(rows: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = rows.reduce((sum, row) => sum + LENGTH_PREFIX_BYTES + row.byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const row of rows) {
    view.setUint32(offset, row.byteLength);
    offset += LENGTH_PREFIX_BYTES;
    out.set(row, offset);
    offset += row.byteLength;
  }
  return out;
}

export function decodeSyncAll(payload: Uint8Array): Uint8Array[] | null {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const rows: Uint8Array[] = [];
  let offset = 0;
  while (offset < payload.byteLength) {
    if (offset + LENGTH_PREFIX_BYTES > payload.byteLength) {
      return null;
    }
    const length = view.getUint32(offset);
    offset += LENGTH_PREFIX_BYTES;
    if (offset + length > payload.byteLength) {
      return null;
    }
    rows.push(payload.subarray(offset, offset + length));
    offset += length;
  }
  return rows;
}

export function encodeInfo(info: PadInfo): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ peers: info.peers, expiresAt: info.expiresAt, now: info.now }),
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function decodeInfo(payload: Uint8Array): PadInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(payload),
    );
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const { peers, expiresAt, now } = parsed as Record<string, unknown>;
  if (
    !isNonNegativeInteger(peers) ||
    !isNonNegativeInteger(expiresAt) ||
    !isNonNegativeInteger(now)
  ) {
    return null;
  }
  return { peers, expiresAt, now };
}

function isSeq(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_SEQ;
}

function encodeSeq(seq: number, extraBytes: number): Uint8Array<ArrayBuffer> {
  if (!isSeq(seq)) {
    throw new RangeError("seq out of range");
  }
  const out = new Uint8Array(SEQ_BYTES + extraBytes);
  new DataView(out.buffer).setUint32(0, seq);
  return out;
}

function readSeq(payload: Uint8Array): number | null {
  if (payload.byteLength < SEQ_BYTES) {
    return null;
  }
  const seq = new DataView(payload.buffer, payload.byteOffset, SEQ_BYTES).getUint32(0);
  return isSeq(seq) ? seq : null;
}

export function encodeCompactRequest(upToSeq: number): Uint8Array<ArrayBuffer> {
  return encodeSeq(upToSeq, 0);
}

export function decodeCompactRequest(payload: Uint8Array): number | null {
  return payload.byteLength === SEQ_BYTES ? readSeq(payload) : null;
}

export function encodeSnapshot(snapshot: Snapshot): Uint8Array<ArrayBuffer> {
  const out = encodeSeq(snapshot.upToSeq, snapshot.data.byteLength);
  out.set(snapshot.data, SEQ_BYTES);
  return out;
}

export function decodeSnapshot(payload: Uint8Array<ArrayBuffer>): Snapshot | null {
  const upToSeq = readSeq(payload);
  if (upToSeq === null || payload.byteLength === SEQ_BYTES) {
    return null;
  }
  return { upToSeq, data: payload.subarray(SEQ_BYTES) };
}

export function encodeError(code: ErrorCloseCode): Uint8Array<ArrayBuffer> {
  return new Uint8Array([code - ERROR_CODE_BASE]);
}

/** Returns the close code an `ERROR` frame announces, or null if the payload is not a known code. */
export function decodeError(payload: Uint8Array): ErrorCloseCode | null {
  const byte = payload.byteLength === 1 ? payload[0] : undefined;
  if (byte === undefined) {
    return null;
  }
  const code = ERROR_CODE_BASE + byte;
  return isErrorCloseCode(code) ? code : null;
}
