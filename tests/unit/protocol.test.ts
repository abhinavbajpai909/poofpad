import { describe, expect, it } from "vitest";
import { CloseCode, isErrorCloseCode } from "../../src/shared/codes";
import { MAX_FRAME_BYTES, MAX_SNAPSHOT_FRAME_BYTES } from "../../src/shared/limits";
import {
  FrameType,
  decodeCompactRequest,
  decodeError,
  decodeFrame,
  decodeInfo,
  decodeSnapshot,
  decodeSyncAll,
  encodeCompactRequest,
  encodeError,
  encodeFrame,
  encodeInfo,
  encodeSnapshot,
  encodeSyncAll,
} from "../../src/shared/protocol";

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

describe("frames", () => {
  it.each(Object.values(FrameType))("round-trips frame type %i", (type) => {
    const payload = bytes(9, 8, 7);
    const decoded = decodeFrame(encodeFrame(type, payload).buffer, MAX_FRAME_BYTES);
    expect(decoded?.type).toBe(type);
    expect(decoded?.payload).toEqual(payload);
  });

  it("round-trips an empty payload", () => {
    const decoded = decodeFrame(encodeFrame(FrameType.Update, bytes()).buffer, MAX_FRAME_BYTES);
    expect(decoded?.payload.byteLength).toBe(0);
  });

  it.each([0, 8, 255])("rejects unknown type %i", (type) => {
    expect(decodeFrame(bytes(type, 1, 2).buffer, MAX_FRAME_BYTES)).toBeNull();
  });

  it("rejects an empty frame", () => {
    expect(decodeFrame(new ArrayBuffer(0), MAX_FRAME_BYTES)).toBeNull();
  });

  it("rejects an oversize frame and accepts one at the limit", () => {
    const atLimit = encodeFrame(FrameType.Update, new Uint8Array(MAX_FRAME_BYTES - 1));
    const overLimit = encodeFrame(FrameType.Update, new Uint8Array(MAX_FRAME_BYTES));
    expect(decodeFrame(atLimit.buffer, MAX_FRAME_BYTES)).not.toBeNull();
    expect(decodeFrame(overLimit.buffer, MAX_FRAME_BYTES)).toBeNull();
  });
});

describe("SYNC_ALL payload", () => {
  it("round-trips rows including empty ones", () => {
    const rows = [bytes(1, 2, 3), bytes(), bytes(4)];
    expect(decodeSyncAll(encodeSyncAll(rows))).toEqual(rows);
  });

  it("round-trips no rows", () => {
    expect(decodeSyncAll(encodeSyncAll([]))).toEqual([]);
  });

  it("decodes rows from a payload that is a view into a larger frame", () => {
    const rows = [bytes(5, 6), bytes(7)];
    const frame = decodeFrame(encodeFrame(FrameType.SyncAll, encodeSyncAll(rows)).buffer, 1 << 20);
    expect(frame && decodeSyncAll(frame.payload)).toEqual(rows);
  });

  it.each([
    ["truncated length prefix", bytes(0, 0, 1)],
    ["length past the end", bytes(0, 0, 0, 5, 1, 2)],
  ])("rejects %s", (_name, payload) => {
    expect(decodeSyncAll(payload)).toBeNull();
  });
});

describe("INFO payload", () => {
  it("round-trips", () => {
    const info = { peers: 3, expiresAt: 1_800_000_000_000 };
    expect(decodeInfo(encodeInfo(info))).toEqual(info);
  });

  it.each([
    "not json",
    "null",
    '{"peers":-1,"expiresAt":1}',
    '{"peers":1.5,"expiresAt":1}',
    '{"peers":"1","expiresAt":1}',
    '{"peers":1}',
  ])("rejects %s", (text) => {
    expect(decodeInfo(new TextEncoder().encode(text))).toBeNull();
  });
});

describe("COMPACT_REQUEST payload", () => {
  it.each([1, 300, 0xffff_ffff])("round-trips upToSeq %i", (seq) => {
    expect(decodeCompactRequest(encodeCompactRequest(seq))).toBe(seq);
  });

  it.each([0, -1, 1.5, 2 ** 32])("refuses to encode %d", (seq) => {
    expect(() => encodeCompactRequest(seq)).toThrow(RangeError);
  });

  it.each([
    ["empty", bytes()],
    ["too short", bytes(0, 0, 1)],
    ["too long", bytes(0, 0, 0, 1, 0)],
    ["seq 0", bytes(0, 0, 0, 0)],
  ])("rejects %s", (_name, payload) => {
    expect(decodeCompactRequest(payload)).toBeNull();
  });
});

describe("SNAPSHOT payload", () => {
  it("round-trips", () => {
    const snapshot = { upToSeq: 42, data: bytes(1, 2, 3) };
    const payload = encodeSnapshot(snapshot);
    expect(Array.from(payload.subarray(0, 4))).toEqual([0, 0, 0, 42]);
    expect(decodeSnapshot(payload)).toEqual(snapshot);
  });

  it("decodes from a frame view", () => {
    const frame = decodeFrame(
      encodeFrame(FrameType.Snapshot, encodeSnapshot({ upToSeq: 7, data: bytes(9) })).buffer,
      MAX_SNAPSHOT_FRAME_BYTES,
    );
    expect(frame && decodeSnapshot(frame.payload)).toEqual({ upToSeq: 7, data: bytes(9) });
  });

  it.each([
    ["empty", bytes()],
    ["seq only", bytes(0, 0, 0, 1)],
    ["seq 0", bytes(0, 0, 0, 0, 5)],
    ["truncated seq", bytes(0, 1)],
  ])("rejects %s", (_name, payload) => {
    expect(decodeSnapshot(payload)).toBeNull();
  });
});

describe("ERROR payload", () => {
  it.each(Object.values(CloseCode).filter((code) => code >= 4000))("round-trips %i", (code) => {
    if (!isErrorCloseCode(code)) {
      throw new Error("not an error code");
    }
    const payload = encodeError(code);
    expect(Array.from(payload)).toEqual([code - 4000]);
    expect(decodeError(payload)).toBe(code);
  });

  it("encodes service busy as 5", () => {
    expect(Array.from(encodeError(CloseCode.ServiceBusy))).toEqual([5]);
  });

  it.each([
    ["empty", bytes()],
    ["unknown code", bytes(2)],
    ["two bytes", bytes(5, 5)],
  ])("rejects %s", (_name, payload) => {
    expect(decodeError(payload)).toBeNull();
  });
});
