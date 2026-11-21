import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "../../src/shared/base64url";

describe("base64url edge cases", () => {
  it("round-trips the empty string", () => {
    expect(toBase64Url(new Uint8Array())).toBe("");
    expect(fromBase64Url("")).toEqual(new Uint8Array());
  });

  it.each([1, 2, 3, 16, 31, 32, 33])("round-trips %i random bytes without padding", (length) => {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    const text = toBase64Url(bytes);
    expect(text).not.toContain("=");
    expect(fromBase64Url(text)).toEqual(bytes);
  });

  it.each([
    ["non-zero trailing bits (2 chars)", "AB"],
    ["non-zero trailing bits (3 chars)", "AAB"],
    ["padding", "AA=="],
    ["standard base64 alphabet", "a+b/"],
    ["whitespace", "AA AA"],
    ["a newline", "AAAA\n"],
    ["percent-encoding", "%41AA"],
    ["a length that is 1 mod 4", "AAAAA"],
    ["non-ASCII", "AAÄA"],
  ])("rejects %s", (_name, text) => {
    expect(fromBase64Url(text)).toBeNull();
  });
});
