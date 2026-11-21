import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../../src/worker/http";
import { origin } from "./helpers";

const validPadId = "AbCdEfGhIjKlMnOpQrStUv";

function asset(path: string): Promise<Response> {
  return env.ASSETS.fetch(new URL(path, origin));
}

describe("search engine files (served by the platform)", () => {
  it.each([
    [
      "/robots.txt",
      /Disallow: \/p\/[\s\S]*Disallow: \/api\/[\s\S]*Disallow: \/ws\/[\s\S]*Sitemap: https:\/\/poofpad\.com\/sitemap\.xml/,
    ],
    [
      "/sitemap.xml",
      /<loc>https:\/\/poofpad\.com\/<\/loc>[\s\S]*<loc>https:\/\/poofpad\.com\/privacy<\/loc>/,
    ],
  ])("%s is served with the security headers", async (path, body) => {
    const response = await asset(path);
    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name), name).toBe(value);
    }
    expect(await response.text()).toMatch(body);
  });

  it("the landing page has a meta description and a canonical link", async () => {
    const response = await asset("/");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("End-to-end encrypted, real-time shared text pad");
    expect(html).toContain('<link rel="canonical" href="https://poofpad.com/" />');
    expect(html).toMatch(/name="description"/);
    expect(html).toContain('property="og:url" content="https://poofpad.com/"');
  });
});

describe("indexing of pads", () => {
  it("/p/<id> carries X-Robots-Tag noindex, nofollow", async () => {
    const response = await exports.default.fetch(new Request(origin + "/p/" + validPadId));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    await response.body?.cancel();
  });

  it("/privacy is indexable", async () => {
    const response = await exports.default.fetch(new Request(origin + "/privacy"));
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
    await response.body?.cancel();
  });
});
