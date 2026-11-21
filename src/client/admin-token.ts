const PREFIX = "admin:";

/**
 * Entries are removed this long after their pad's expiry rather than at it, so a device clock that runs
 * fast can't drop the token of a pad that is still alive.
 */
export const STALE_GRACE_MS = 60 * 60 * 1000;

function storageKey(padId: string): string {
  return `${PREFIX}${padId}`;
}

function parseEntry(raw: string | null): { token: string; expiresAt: number } | null {
  if (raw === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null) {
      const { token, expiresAt } = value as Record<string, unknown>;
      if (typeof token === "string" && typeof expiresAt === "number") {
        return { token, expiresAt };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Stores the creator's admin token with the pad's expiry, so the entry can be cleaned up later. */
export function rememberAdminToken(padId: string, token: string, expiresAt: number): void {
  try {
    localStorage.setItem(storageKey(padId), JSON.stringify({ token, expiresAt }));
  } catch {
    return;
  }
}

export function readAdminToken(padId: string): string | null {
  try {
    return parseEntry(localStorage.getItem(storageKey(padId)))?.token ?? null;
  } catch {
    return null;
  }
}

export function forgetAdminToken(padId: string): void {
  try {
    localStorage.removeItem(storageKey(padId));
  } catch {
    return;
  }
}

/**
 * Removes the admin tokens of pads that have expired (and entries in any other format, which carry no expiry).
 * Run on every page load: pads that are never opened again would otherwise keep their token forever.
 */
export function forgetStaleAdminTokens(now: number = Date.now()): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX) !== true) {
        continue;
      }
      const entry = parseEntry(localStorage.getItem(key));
      if (entry === null || entry.expiresAt + STALE_GRACE_MS < now) {
        stale.push(key);
      }
    }
    for (const key of stale) {
      localStorage.removeItem(key);
    }
  } catch {
    return;
  }
}
