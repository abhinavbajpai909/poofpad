import { fromBase64Url } from "../shared/base64url";
import { PAD_ID_PATTERN } from "../shared/limits";
import { KEY_BYTES } from "./crypto";

export type PadLinkResult = { ok: true; path: string } | { ok: false; message: string };

/** Checks a pasted link points at a pad on this site and carries a well-formed key. */
export function parsePadLink(text: string, origin: string): PadLinkResult {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { ok: false, message: "Paste the full pad link first." };
  }
  let url: URL;
  try {
    url = new URL(trimmed, origin);
  } catch {
    return { ok: false, message: "That doesn't look like a link." };
  }
  if (url.origin !== origin) {
    return { ok: false, message: "That link is for a different site." };
  }
  const padId = /^\/p\/([^/]+)$/.exec(url.pathname)?.[1];
  if (padId === undefined || !PAD_ID_PATTERN.test(padId)) {
    return { ok: false, message: "That isn't a PoofPad link." };
  }
  const key = url.hash.slice(1);
  if (key === "") {
    return {
      ok: false,
      message: "This link is incomplete. Paste the whole link, including the part after #.",
    };
  }
  if (fromBase64Url(key)?.byteLength !== KEY_BYTES) {
    return { ok: false, message: "The key in this link looks damaged. Copy the whole link again." };
  }
  return { ok: true, path: `/p/${padId}#${key}` };
}
