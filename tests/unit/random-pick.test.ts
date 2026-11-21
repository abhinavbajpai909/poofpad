import { describe, expect, it } from "vitest";
import { pick, pickWith, rejectionLimit } from "../../src/client/random-pick";

describe("rejectionLimit", () => {
  it("is the largest multiple of the count that fits in 2^32", () => {
    for (const count of [1, 2, 3, 7, 10, 255, 1000]) {
      const limit = rejectionLimit(count);
      expect(limit % count).toBe(0);
      expect(limit).toBeLessThanOrEqual(2 ** 32);
      expect(2 ** 32 - limit).toBeLessThan(count);
    }
  });

  it("matches known values", () => {
    expect(rejectionLimit(10)).toBe(4294967290);
    expect(rejectionLimit(2)).toBe(2 ** 32);
    expect(rejectionLimit(3)).toBe(4294967295);
  });
});

describe("pickWith", () => {
  it("redraws values at or above the limit", () => {
    const items = ["a", "b", "c"];
    const draws = [4294967295, 4294967295, 4];
    let calls = 0;
    const result = pickWith(items, () => draws[calls++] as number);
    expect(calls).toBe(3);
    expect(result).toBe("b");
  });

  it("accepts the largest value below the limit", () => {
    const items = ["a", "b", "c"];
    expect(pickWith(items, () => 4294967294)).toBe("c");
  });

  it("maps every residue to its item", () => {
    const items = ["a", "b", "c", "d"];
    expect(items.map((_, i) => pickWith(items, () => i))).toEqual(items);
  });
});

describe("pick", () => {
  it("only returns items from the list and reaches all of them", () => {
    const items = ["a", "b", "c", "d", "e"] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const item = pick(items);
      expect(items).toContain(item);
      seen.add(item);
    }
    expect(seen.size).toBe(items.length);
  });
});
