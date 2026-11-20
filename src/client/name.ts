export const MAX_NAME_LENGTH = 24;

/** Control characters, zero-width and bidi-override characters (they can hide or reorder a name). */
const UNSAFE_CHARACTERS = new RegExp(
  "[\\p{Cc}\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]",
  "gu",
);

/** At most 24 characters, no control characters. The result may be empty. */
export function cleanName(text: string): string {
  const visible = text.replace(UNSAFE_CHARACTERS, "").trim();
  return Array.from(visible).slice(0, MAX_NAME_LENGTH).join("").trim();
}
