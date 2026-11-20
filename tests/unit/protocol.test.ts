import { describe, expect, it } from "vitest";
import { MAX_FRAME_BYTES } from "../../src/shared/limits";
import {
  FrameType,
  decodeFrame,
  decodeInfo,
  decodeSyncAll,
  encodeFrame,
  encodeInfo,
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
