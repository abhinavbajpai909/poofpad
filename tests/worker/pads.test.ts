import { env, exports } from "cloudflare:workers";
import { listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CloseCode } from "../../src/shared/codes";
import { FrameType, decodeError } from "../../src/shared/protocol";
import { createPad, nextOfType, open, origin, post, storedTables } from "./helpers";

const VALID_TTLS = [15, 600, 3600, 21600, 86400];

describe("create pad (test 3)", () => {
  it.each(VALID_TTLS)("creates a pad with ttl %i", async (ttl) => {
    const before = Date.now();
    const { padId, adminToken, expiresAt } = await createPad(ttl);
    expect(padId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(adminToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBeGreaterThanOrEqual(before + ttl * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + ttl * 1000);
  });

  it.each([
    ["ttl 0", '{"ttl":0}'],
    ["ttl -1", '{"ttl":-1}'],
    ["ttl 99999", '{"ttl":99999}'],
    ["ttl 14", '{"ttl":14}'],
    ["ttl 3600.5", '{"ttl":3600.5}'],
    ['ttl "3600"', '{"ttl":"3600"}'],
    ["ttl null", '{"ttl":null}'],
    ["missing ttl", "{}"],
    ["extra fields", '{"ttl":3600,"x":1}'],
    ["an array", "[3600]"],
    ["null", "null"],
    ["not JSON", "ttl=3600"],
    ["an empty body", ""],
    ["a body over 1 KB", `{"ttl":3600,"pad":"${"x".repeat(1100)}"}`],
  ])("rejects %s with 400", async (_name, body) => {
    const response = await post("/api/pads", { body });
    expect(response.status).toBe(400);
    await response.body?.cancel();
  });

  it("rejects a missing body with 400", async () => {
    const response = await post("/api/pads");
    expect(response.status).toBe(400);
    await response.body?.cancel();
  });

  it("stores only the SHA-256 of the admin token", async () => {
    const { padId, adminToken } = await createPad();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(adminToken));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    const stored = await runInDurableObject(env.PAD.getByName(padId), (_instance, state) =>
      state.storage.sql.exec<{ admin_hash: string }>("SELECT admin_hash FROM meta").one(),
    );
    expect(stored.admin_hash).toBe(hex);
  });
});

describe("invalid pad ids (test 4)", () => {
  const BAD_IDS = [
    "short",
    "AbCdEfGhIjKlMnOpQrStUvW",
    "AbCdEfGhIjKlMnOpQrSt.v",
    "AbCdEfGhIjKlMnOpQrSt+v",
    "..",
    "..%2F..%2Fetc%2Fpasswd",
    "%41bCdEfGhIjKlMnOpQrStUv",
    "AbCdEfGhIjKlMnOpQrSt%00",
  ];

  it.each(BAD_IDS)("returns 404 for %s without creating a Durable Object", async (badId) => {
    const before = (await listDurableObjectIds(env.PAD)).length;
    const requests = [
      new Request(`${origin}/p/${badId}`),
      new Request(`${origin}/ws/${badId}`, { headers: { Upgrade: "websocket", Origin: origin } }),
      new Request(`${origin}/api/pads/${badId}/end`, {
        method: "POST",
        headers: { Authorization: `Bearer ${"a".repeat(43)}` },
      }),
    ];
    for (const request of requests) {
      const response = await exports.default.fetch(request);
      expect(response.status).toBe(404);
      await response.body?.cancel();
    }
    expect((await listDurableObjectIds(env.PAD)).length).toBe(before);
  });
});

describe("end now (test 6)", () => {
  function end(padId: string, authorization?: string): Promise<Response> {
    return post(
      `/api/pads/${padId}/end`,
      authorization === undefined ? {} : { headers: { Authorization: authorization } },
    );
  }

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not Bearer", "Basic abc"],
    ["malformed", "Bearer not-a-token"],
    ["wrong", `Bearer ${"A".repeat(43)}`],
  ])("rejects a %s token with 401 and keeps the pad", async (_name, authorization) => {
    const { padId } = await createPad();
    const response = await end(padId, authorization);
    expect(response.status).toBe(401);
    await response.body?.cancel();
    expect(await storedTables(padId)).toContain("meta");
  });

  it("burns the pad with the correct token", async () => {
    const { padId, adminToken } = await createPad();
    const a = await open(padId);
    const b = await open(padId);
    await nextOfType(b, FrameType.SyncAll);

    const response = await end(padId, `Bearer ${adminToken}`);
    expect(response.status).toBe(204);

    for (const client of [a, b]) {
      expect(decodeError(await nextOfType(client, FrameType.Error))).toBe(CloseCode.Expired);
      expect(await client.closed).toBe(CloseCode.Expired);
    }
    expect(await storedTables(padId)).toEqual([]);

    const again = await end(padId, `Bearer ${adminToken}`);
    expect(again.status).toBe(404);
    await again.body?.cancel();
    const late = await open(padId);
    expect(await late.closed).toBe(CloseCode.NotFound);
  });

  it("returns 404 for a pad that does not exist", async () => {
    const response = await end("AAAAAAAAAAAAAAAAAAAAAA", `Bearer ${"A".repeat(43)}`);
    expect(response.status).toBe(404);
    await response.body?.cancel();
  });

  it.each(["GET", "PUT", "DELETE"])("returns 405 for %s", async (method) => {
    const { padId, adminToken } = await createPad();
    const response = await exports.default.fetch(
      new Request(`${origin}/api/pads/${padId}/end`, {
        method,
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    await response.body?.cancel();
    expect(await storedTables(padId)).toContain("meta");
  });
});
