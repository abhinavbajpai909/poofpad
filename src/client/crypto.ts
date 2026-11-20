import { fromBase64Url, toBase64Url } from "../shared/base64url";

export const KEY_BYTES = 32;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;

/** Bound to each ciphertext as AES-GCM additional data, so a doc payload can't be replayed as awareness or vice versa. */
export const Purpose = {
  Doc: 1,
  Awareness: 2,
} as const;

export type Purpose = (typeof Purpose)[keyof typeof Purpose];

const ALGORITHM = "AES-GCM";

export function generateKeyText(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(KEY_BYTES)));
}

/** Imports a base64url key as a non-extractable AES-GCM 256 key, or returns null if the text is not a valid key. */
export async function importKey(keyText: string): Promise<CryptoKey | null> {
  const raw = fromBase64Url(keyText);
  if (raw === null || raw.byteLength !== KEY_BYTES) {
    return null;
  }
  try {
    return await crypto.subtle.importKey("raw", raw, { name: ALGORITHM }, false, [
      "encrypt",
      "decrypt",
    ]);
  } finally {
    raw.fill(0);
  }
}

function params(purpose: Purpose, iv: Uint8Array<ArrayBuffer>) {
  return { name: ALGORITHM, iv, additionalData: new Uint8Array([purpose]) };
}

/** Returns `iv (12 bytes) || ciphertext+tag`, with a fresh random IV. */
export async function encrypt(
  key: CryptoKey,
  purpose: Purpose,
  plaintext: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(params(purpose, iv), key, new Uint8Array(plaintext));
  const out = new Uint8Array(IV_BYTES + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), IV_BYTES);
  return out;
}

/** Returns the plaintext, or null if the payload is malformed, tampered with or sealed with another key or purpose. */
export async function decrypt(
  key: CryptoKey,
  purpose: Purpose,
  payload: Uint8Array,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (payload.byteLength < IV_BYTES + TAG_BYTES) {
    return null;
  }
  const iv = new Uint8Array(payload.subarray(0, IV_BYTES));
  try {
    const plain = await crypto.subtle.decrypt(
      params(purpose, iv),
      key,
      new Uint8Array(payload.subarray(IV_BYTES)),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}
