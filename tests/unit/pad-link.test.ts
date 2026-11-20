import { describe, expect, it } from "vitest";
import { generateKeyText } from "../../src/client/crypto";
import { parsePadLink } from "../../src/client/pad-link";
import { formatRemaining } from "../../src/client/format-remaining";

const ORIGIN = "https://poofpad.example";
const PAD_ID = "AAAAAAAAAAAAAAAAAAAAAA";

describe("parsePadLink", () => {
  it("accepts a full link and returns an in-site path", () => {
    const key = generateKeyText();
    expect(parsePadLink(`  ${ORIGIN}/p/${PAD_ID}#${key}  `, ORIGIN)).toEqual({
      ok: true,
      path: `/p/${PAD_ID}#${key}`,
    });
  });

  it("accepts a relative link", () => {
    const key = generateKeyText();
    expect(parsePadLink(`/p/${PAD_ID}#${key}`, ORIGIN).ok).toBe(true);
  });

  it.each([
    ["empty text", ""],
    ["a missing key", `${ORIGIN}/p/${PAD_ID}`],
    ["a short key", `${ORIGIN}/p/${PAD_ID}#abc`],
    ["a key with bad characters", `${ORIGIN}/p/${PAD_ID}#${"!".repeat(43)}`],
    ["another site", `https://evil.example/p/${PAD_ID}#${generateKeyText()}`],
    ["a bad pad id", `${ORIGIN}/p/short#${generateKeyText()}`],
    ["a non-pad path", `${ORIGIN}/privacy#${generateKeyText()}`],
    ["javascript: urls", "javascript:alert(1)"],
  ])("rejects %s", (_name, text) => {
    expect(parsePadLink(text, ORIGIN).ok).toBe(false);
  });
});

describe("formatRemaining", () => {
  it("formats minutes, hours and the end", () => {
    expect(formatRemaining(61_000)).toBe("01:01");
    expect(formatRemaining(3_661_000)).toBe("1:01:01");
    expect(formatRemaining(86_400_000)).toBe("24:00:00");
    expect(formatRemaining(-5)).toBe("00:00");
  });
});
