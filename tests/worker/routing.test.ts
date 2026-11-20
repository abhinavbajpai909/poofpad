import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const origin = "https://poofpad.test";
const validPadId = "AbCdEfGhIjKlMnOpQrStUv";

function get(path: string): Promise<Response> {
  return exports.default.fetch(new Request(origin + path));
}

describe("worker routing", () => {
  it.each(["/p/" + validPadId, "/privacy"])("serves the app shell at %s", async (path) => {
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(await response.text()).toContain('<main id="app">');
  });

  it.each([
    "/nope",
    "/p/",
    "/p/short",
    "/p/" + validPadId + "x",
    "/p/AbCdEfGhIjKlMnOpQrSt.v",
    "/p/" + validPadId + "/extra",
    "/p/..%2F..%2Fetc%2Fpasswd",
    "/privacy/extra",
  ])("returns 404 for %s", async (path) => {
    const response = await get(path);
    expect(response.status).toBe(404);
    await response.body?.cancel();
  });
});
