import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../../src/worker/http";
import headersFile from "../../public/_headers?raw";
import wranglerConfig from "../../wrangler.jsonc?raw";

describe("public/_headers", () => {
  const rules = headersFile
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));
  const assetsAt = rules.indexOf("/assets/*");

  it("repeats SECURITY_HEADERS for every path", () => {
    expect(rules[0]).toBe("/*");
    const pairs = rules.slice(1, assetsAt).map((line) => {
      const trimmed = line.trim();
      const colon = trimmed.indexOf(": ");
      return [trimmed.slice(0, colon), trimmed.slice(colon + 2)];
    });
    expect(Object.fromEntries(pairs)).toEqual(SECURITY_HEADERS);
  });

  it("caches only the hashed /assets/ files for long", () => {
    expect(rules.slice(assetsAt)).toEqual([
      "/assets/*",
      "  Cache-Control: public, max-age=31536000, immutable",
    ]);
  });
});

describe("wrangler.jsonc (production config)", () => {
  const config = wranglerConfig;

  it("sets ALLOW_TEST_TTL to 0 and nowhere to 1", () => {
    expect(config).toMatch(/"ALLOW_TEST_TTL":\s*"0"/);
    expect(config).not.toMatch(/ALLOW_TEST_TTL"?\s*[:=]\s*"?1/);
    expect(config).not.toMatch(/"env"\s*:/);
  });

  it("disables observability and binds no analytics, logs or tail consumers", () => {
    expect(config).toMatch(/"observability":\s*\{\s*"enabled":\s*false\s*\}/);
    expect(config).not.toMatch(/analytics_engine|logpush|tail_consumers|"logs"/);
  });
});
