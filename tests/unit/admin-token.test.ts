import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STALE_GRACE_MS,
  forgetAdminToken,
  forgetStaleAdminTokens,
  readAdminToken,
  rememberAdminToken,
} from "../../src/client/admin-token";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const NOW = 1_800_000_000_000;

describe("admin token storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores the token with the pad's expiry and reads it back", () => {
    rememberAdminToken("pad1", "secret", NOW + 1000);
    expect(readAdminToken("pad1")).toBe("secret");
    expect(JSON.parse(localStorage.getItem("admin:pad1") ?? "")).toEqual({
      token: "secret",
      expiresAt: NOW + 1000,
    });
    expect(readAdminToken("other")).toBeNull();
  });

  it("forget removes one entry", () => {
    rememberAdminToken("pad1", "a", NOW);
    rememberAdminToken("pad2", "b", NOW);
    forgetAdminToken("pad1");
    expect(readAdminToken("pad1")).toBeNull();
    expect(readAdminToken("pad2")).toBe("b");
  });

  it("the sweep removes expired entries, keeps live ones and leaves other keys alone", () => {
    rememberAdminToken("expired", "a", NOW - STALE_GRACE_MS - 1);
    rememberAdminToken("recentlyExpired", "b", NOW - 1000);
    rememberAdminToken("live", "c", NOW + 3_600_000);
    localStorage.setItem("poofpad:theme", "dark");
    localStorage.setItem("adminish", "not ours");
    forgetStaleAdminTokens(NOW);
    expect(readAdminToken("expired")).toBeNull();
    // Within the grace period: a device clock that runs fast must not drop the token of a live pad.
    expect(readAdminToken("recentlyExpired")).toBe("b");
    expect(readAdminToken("live")).toBe("c");
    expect(localStorage.getItem("poofpad:theme")).toBe("dark");
    expect(localStorage.getItem("adminish")).toBe("not ours");
  });

  it("the sweep removes entries it cannot read (old plain-text format, junk, wrong shape)", () => {
    localStorage.setItem("admin:plain", "just-a-token");
    localStorage.setItem("admin:junk", "{not json");
    localStorage.setItem("admin:shape", JSON.stringify({ token: 1, expiresAt: "x" }));
    localStorage.setItem("admin:null", "null");
    rememberAdminToken("good", "t", NOW + 1000);
    forgetStaleAdminTokens(NOW);
    expect(localStorage.length).toBe(1);
    expect(readAdminToken("good")).toBe("t");
  });

  it("an unreadable entry gives no token", () => {
    localStorage.setItem("admin:plain", "just-a-token");
    expect(readAdminToken("plain")).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      get length(): number {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => rememberAdminToken("p", "t", NOW)).not.toThrow();
    expect(readAdminToken("p")).toBeNull();
    expect(() => forgetAdminToken("p")).not.toThrow();
    expect(() => forgetStaleAdminTokens(NOW)).not.toThrow();
  });
});
