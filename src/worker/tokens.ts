import { toBase64Url } from "../shared/base64url";

export function randomBase64Url(byteLength: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes as unpadded base64url. */
export const ADMIN_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashesMatch(expected: string, actual: string): boolean {
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(actual);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}
