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

const FRAME_TYPES: ReadonlySet<number> = new Set(Object.values(FrameType));

export interface Frame {
  type: FrameType;
  payload: Uint8Array<ArrayBuffer>;
}

export interface PadInfo {
  peers: number;
  expiresAt: number;
}

const LENGTH_PREFIX_BYTES = 4;

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
  return new TextEncoder().encode(JSON.stringify({ peers: info.peers, expiresAt: info.expiresAt }));
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
  const { peers, expiresAt } = parsed as Record<string, unknown>;
  if (!isNonNegativeInteger(peers) || !isNonNegativeInteger(expiresAt)) {
    return null;
  }
  return { peers, expiresAt };
}
