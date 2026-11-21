import { describe, expect, it } from "vitest";
import { toBase64Url } from "../../src/shared/base64url";
import {
  ALLOWED_TTLS_SECONDS,
  AWARENESS_THROTTLE_MS,
  COMPACT_MAX_BYTES,
  COMPACT_MAX_ROWS,
  COMPACT_RETRY_MS,
  MAX_FRAME_BYTES,
  MAX_JSON_BODY_BYTES,
  MAX_MESSAGES_PER_SECOND,
  MAX_PEERS_PER_PAD,
  MAX_SNAPSHOT_FRAME_BYTES,
  MAX_STORED_BYTES_PER_PAD,
  PAD_ID_PATTERN,
  RATE_WINDOW_MS,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  TEST_TTL_SECONDS,
  UPDATE_BATCH_MS,
} from "../../src/shared/limits";
import { MAX_UPDATE_BYTES } from "../../src/client/edit-limit";

describe("limits match the specification", () => {
  it("has the specified values", () => {
    expect(MAX_PEERS_PER_PAD).toBe(50);
    expect(MAX_FRAME_BYTES).toBe(1024 * 1024);
    expect(MAX_STORED_BYTES_PER_PAD).toBe(5 * 1024 * 1024);
    expect(MAX_SNAPSHOT_FRAME_BYTES).toBe(5 * 1024 * 1024 + 5);
    expect(MAX_MESSAGES_PER_SECOND).toBe(40);
    expect(RATE_WINDOW_MS).toBe(1000);
    expect(ALLOWED_TTLS_SECONDS).toEqual([600, 3600, 21600, 86400]);
    expect(TEST_TTL_SECONDS).toBe(15);
    expect(UPDATE_BATCH_MS).toBe(250);
    expect(AWARENESS_THROTTLE_MS).toBe(250);
    expect([RECONNECT_MIN_MS, RECONNECT_MAX_MS]).toEqual([500, 10_000]);
    expect([COMPACT_MAX_ROWS, COMPACT_MAX_BYTES, COMPACT_RETRY_MS]).toEqual([
      300,
      1024 * 1024,
      10_000,
    ]);
    expect(MAX_JSON_BODY_BYTES).toBe(1024);
  });

  it("keeps a normal client well under the message rate limit", () => {
    const perSecond = 1000 / UPDATE_BATCH_MS + 1000 / AWARENESS_THROTTLE_MS;
    expect(perSecond).toBeLessThan(MAX_MESSAGES_PER_SECOND / 2);
  });

  it("lets a 500 KB paste fit one frame and leaves room for the frame header", () => {
    expect(MAX_UPDATE_BYTES).toBeGreaterThan(500 * 1024);
    expect(MAX_UPDATE_BYTES).toBeLessThan(MAX_FRAME_BYTES);
  });

  it("matches every 16-byte base64url id and nothing else", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(toBase64Url(crypto.getRandomValues(new Uint8Array(16)))).toMatch(PAD_ID_PATTERN);
    }
    for (const bad of [
      "",
      "a".repeat(21),
      "a".repeat(23),
      "a".repeat(21) + "=",
      "a".repeat(21) + "/",
    ]) {
      expect(bad).not.toMatch(PAD_ID_PATTERN);
    }
  });
});
