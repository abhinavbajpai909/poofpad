import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../../src/worker/http";
import worker from "../../src/worker/index";
import { createPad, open, origin, post } from "./helpers";

const validPadId = "AbCdEfGhIjKlMnOpQrStUv";

function expectSecurityHeaders(response: Response): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(response.headers.get(name), name).toBe(value);
  }
}

function get(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(new Request(origin + path, init));
}

async function builtScriptPath(): Promise<string> {
  const html = await (await env.ASSETS.fetch(new URL("/", origin))).text();
  const match = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html);
  if (match?.[1] === undefined) {
    throw new Error("no module script in built index.html");
  }
  return match[1];
}

describe("security headers (test 21)", () => {
  it.each(["/p/" + validPadId, "/privacy"])(
    "are set on %s, which must revalidate",
    async (path) => {
      const response = await get(path);
      expect(response.status).toBe(200);
      expectSecurityHeaders(response);
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      await response.body?.cancel();
    },
  );

  it("are set on the landing page", async () => {
    const response = await env.ASSETS.fetch(new URL("/", origin));
    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    await response.body?.cancel();
  });

  it("are set on a JS asset, which is cached forever", async () => {
    const response = await env.ASSETS.fetch(new URL(await builtScriptPath(), origin));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/javascript/);
    expectSecurityHeaders(response);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    await response.body?.cancel();
  });

  it("are set on unhashed assets, which must revalidate", async () => {
    const response = await env.ASSETS.fetch(new URL("/theme-init.js", origin));
    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
    expect(response.headers.get("Cache-Control")).not.toMatch(/immutable|max-age=[1-9]/);
    await response.body?.cancel();
  });

  it.each([
    ["201 create", () => post("/api/pads", { body: '{"ttl":3600}' }), 201],
    ["400 create", () => post("/api/pads", { body: "{}" }), 400],
    ["403 bad origin", () => post("/api/pads", { headers: { Origin: "https://evil.test" } }), 403],
    ["405 wrong method", () => get("/api/pads"), 405],
    [
      "415 wrong content type",
      () => post("/api/pads", { headers: { "Content-Type": "text/plain" } }),
      415,
    ],
    ["401 end", () => post(`/api/pads/${validPadId}/end`), 401],
    ["404 unknown path", () => get("/nope"), 404],
    ["404 bad pad id", () => get("/p/short"), 404],
    ["426 ws without upgrade", () => get(`/ws/${validPadId}`), 426],
  ])("are set on %s and the response is never cached", async (_name, request, status) => {
    const response = await request();
    expect(response.status).toBe(status);
    expectSecurityHeaders(response);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await response.body?.cancel();
  });

  it("are set on WebSocket upgrade responses, accepted and refused", async () => {
    const { padId } = await createPad();
    const upgrade = (headers: Record<string, string>) =>
      get(`/ws/${padId}`, { headers: { Upgrade: "websocket", ...headers } });

    for (const headers of [{ Origin: origin }, { Origin: "https://evil.test" }]) {
      const response = await upgrade(headers);
      expect(response.status).toBe(101);
      expectSecurityHeaders(response);
      response.webSocket?.accept();
      response.webSocket?.close(1000);
    }
  });
});

describe("methods and bodies", () => {
  it.each([
    ["PUT", "/api/pads", "POST"],
    ["DELETE", `/api/pads/${validPadId}/end`, "POST"],
    ["GET", `/api/pads/${validPadId}/end`, "POST"],
    ["POST", "/privacy", "GET, HEAD"],
    ["POST", `/p/${validPadId}`, "GET, HEAD"],
    ["POST", `/ws/${validPadId}`, "GET"],
  ])("answers %s %s with 405 and an Allow header", async (method, path, allow) => {
    const response = await get(path, { method, headers: { Origin: origin } });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe(allow);
    await response.body?.cancel();
  });

  it("answers HEAD on a page like GET", async () => {
    const response = await get("/privacy", { method: "HEAD" });
    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
  });

  it("does not echo input in error bodies", async () => {
    const response = await post("/api/pads", { body: '{"ttl":"<script>x</script>"}' });
    expect(await response.text()).toBe("Bad request");
  });
});

describe("origin check on POST endpoints", () => {
  it.each([
    ["another site", { Origin: "https://evil.test" }],
    ["a look-alike host", { Origin: "https://poofpad.test.evil.test" }],
    ["a malformed origin", { Origin: "not a url" }],
    ["the opaque origin", { Origin: "null" }],
  ])("refuses create and End now from %s with 403", async (_name, headers) => {
    const { padId, adminToken } = await createPad();
    const created = await post("/api/pads", { headers, body: '{"ttl":3600}' });
    expect(created.status).toBe(403);
    await created.body?.cancel();
    const ended = await post(`/api/pads/${padId}/end`, {
      headers: { ...headers, Authorization: `Bearer ${adminToken}` },
    });
    expect(ended.status).toBe(403);
    await ended.body?.cancel();

    const client = await open(padId);
    expect((await client.next()).type).toBeDefined();
    client.socket.close(1000);
  });

  it("refuses a request with no Origin header", async () => {
    const response = await exports.default.fetch(
      new Request(origin + "/api/pads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"ttl":3600}',
      }),
    );
    expect(response.status).toBe(403);
    await response.body?.cancel();
  });

  it("allows localhost origins only while ALLOW_TEST_TTL is 1", async () => {
    const send = (flag: string) =>
      worker.fetch(
        new Request(origin + "/api/pads", {
          method: "POST",
          headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
          body: '{"ttl":3600}',
        }),
        { ...env, ALLOW_TEST_TTL: flag },
      );
    const test = await send("1");
    expect(test.status).toBe(201);
    await test.body?.cancel();
    for (const flag of ["0", "", "true"]) {
      const production = await send(flag);
      expect(production.status).toBe(403);
      await production.body?.cancel();
    }
  });
});
