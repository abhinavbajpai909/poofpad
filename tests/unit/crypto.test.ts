import { describe, expect, it } from "vitest";
import {
  IV_BYTES,
  KEY_BYTES,
  Purpose,
  TAG_BYTES,
  decrypt,
  encrypt,
  generateKeyText,
  importKey,
} from "../../src/client/crypto";
import { fromBase64Url, toBase64Url } from "../../src/shared/base64url";

async function newKey(): Promise<CryptoKey> {
  const key = await importKey(generateKeyText());
  if (key === null) {
    throw new Error("generated key did not import");
  }
  return key;
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe("base64url", () => {
  it("round-trips every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it.each(["A", "AB+C", "AB/C", "ABC=", "AB C", "ABé", "AB"])("rejects %j", (value) => {
    expect(fromBase64Url(value)).toBeNull();
  });
});

describe("key import", () => {
  it("generates 32-byte base64url keys", () => {
    const keyText = generateKeyText();
    expect(keyText).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fromBase64Url(keyText)?.byteLength).toBe(KEY_BYTES);
  });

  it("imports a non-extractable AES-GCM 256 key", async () => {
    const key = await newKey();
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
    expect([...key.usages].sort()).toEqual(["decrypt", "encrypt"]);
  });

  it.each([
    ["empty", ""],
    ["too short", "A".repeat(42)],
    ["too long", "A".repeat(44)],
    ["16 bytes", toBase64Url(new Uint8Array(16))],
    ["standard base64 chars", `${"A".repeat(41)}+/`],
    ["padding", `${"A".repeat(43)}=`],
    ["non-canonical last char", `${"A".repeat(42)}B`],
  ])("rejects a %s key", async (_name, keyText) => {
    expect(await importKey(keyText)).toBeNull();
  });
});

describe("encrypt / decrypt", () => {
  it.each([0, 1, 1000, 256 * 1024])("round-trips %i bytes", async (size) => {
    const key = await newKey();
    const plaintext = Uint8Array.from({ length: size }, (_, i) => (i * 31) % 256);
    const sealed = await encrypt(key, Purpose.Doc, plaintext);
    expect(sealed.byteLength).toBe(IV_BYTES + size + TAG_BYTES);
    expect(await decrypt(key, Purpose.Doc, sealed)).toEqual(plaintext);
  });

  it("does not contain the plaintext", async () => {
    const key = await newKey();
    const marker = "PLAINTEXT-MARKER-0123456789";
    const sealed = await encrypt(key, Purpose.Doc, text(marker));
    expect(new TextDecoder("latin1").decode(sealed)).not.toContain(marker);
  });

  it("encrypts the same plaintext differently each time", async () => {
    const key = await newKey();
    const a = await encrypt(key, Purpose.Doc, text("same"));
    const b = await encrypt(key, Purpose.Doc, text("same"));
    expect(a).not.toEqual(b);
  });

  it.each([
    ["the IV", 0],
    ["the ciphertext", IV_BYTES + 2],
    ["the tag", -1],
  ])("rejects a payload with a flipped bit in %s", async (_name, index) => {
    const key = await newKey();
    const sealed = await encrypt(key, Purpose.Doc, text("hello, world"));
    const at = index < 0 ? sealed.byteLength + index : index;
    sealed[at] = (sealed[at] ?? 0) ^ 1;
    expect(await decrypt(key, Purpose.Doc, sealed)).toBeNull();
  });

  it("rejects truncated and too-short payloads", async () => {
    const key = await newKey();
    const sealed = await encrypt(key, Purpose.Doc, text("hello, world"));
    expect(await decrypt(key, Purpose.Doc, sealed.subarray(0, sealed.byteLength - 1))).toBeNull();
    expect(await decrypt(key, Purpose.Doc, new Uint8Array(IV_BYTES + TAG_BYTES - 1))).toBeNull();
    expect(await decrypt(key, Purpose.Doc, new Uint8Array())).toBeNull();
  });

  it("rejects a payload sealed with another key", async () => {
    const sealed = await encrypt(await newKey(), Purpose.Doc, text("secret"));
    expect(await decrypt(await newKey(), Purpose.Doc, sealed)).toBeNull();
  });

  it("rejects a payload sealed for another purpose", async () => {
    const key = await newKey();
    const sealed = await encrypt(key, Purpose.Awareness, text("cursor"));
    expect(await decrypt(key, Purpose.Doc, sealed)).toBeNull();
    expect(await decrypt(key, Purpose.Awareness, sealed)).toEqual(text("cursor"));
  });

  it("never repeats an IV across 10,000 encryptions", async () => {
    const key = await newKey();
    const plaintext = text("x");
    const ivs = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const sealed = await encrypt(key, Purpose.Doc, plaintext);
      ivs.add(toBase64Url(sealed.subarray(0, IV_BYTES)));
    }
    expect(ivs.size).toBe(10_000);
  }, 30_000);
});
