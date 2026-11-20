import { cleanName } from "./name";

export interface Identity {
  name: string;
  color: string;
}

const STORAGE_KEY = "identity";

const ADJECTIVES = [
  "Swift",
  "Quiet",
  "Brave",
  "Clever",
  "Gentle",
  "Lucky",
  "Sunny",
  "Witty",
  "Calm",
  "Bold",
];
const ANIMALS = [
  "Otter",
  "Falcon",
  "Panda",
  "Fox",
  "Heron",
  "Lynx",
  "Koala",
  "Gecko",
  "Badger",
  "Owl",
];
const COLORS = [
  "#e5484d",
  "#f76b15",
  "#d6a100",
  "#30a46c",
  "#12a594",
  "#0091ff",
  "#6e56cf",
  "#d6409f",
  "#8e6c4a",
  "#5f7f9a",
];

function pick<T>(items: readonly T[]): T {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return items[index % items.length] as T;
}

function randomIdentity(): Identity {
  return { name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(COLORS) };
}

function parseIdentity(text: string | null): Identity | null {
  if (text === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const { name, color } = value as Record<string, unknown>;
    if (typeof name !== "string" || typeof color !== "string" || !COLORS.includes(color)) {
      return null;
    }
    const cleaned = cleanName(name);
    return cleaned === "" ? null : { name: cleaned, color };
  } catch {
    return null;
  }
}

function save(identity: Identity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Not remembered; it still applies for this visit.
  }
}

/** Random name and colour on the first visit, then the stored (possibly edited) ones. */
export function loadIdentity(): Identity {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  const existing = parseIdentity(stored);
  if (existing !== null) {
    return existing;
  }
  const created = randomIdentity();
  save(created);
  return created;
}

export function saveName(identity: Identity, name: string): Identity {
  const cleaned = cleanName(name);
  if (cleaned === "") {
    return identity;
  }
  const updated = { ...identity, name: cleaned };
  save(updated);
  return updated;
}
