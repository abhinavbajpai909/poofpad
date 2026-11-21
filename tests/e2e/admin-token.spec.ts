import { createPad, expect, expectScreen, openPad, randomKey, test } from "./helpers";

const HOUR = 3600 * 1000;

function stored(page: import("@playwright/test").Page, key: string): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

test.describe("admin tokens in localStorage (review item 4)", () => {
  test("expired entries are removed on page load; live ones and other keys stay", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await page.evaluate(
      ([hour]) => {
        const now = Date.now();
        const entry = (expiresAt: number) => JSON.stringify({ token: "t", expiresAt });
        localStorage.setItem("admin:expired", entry(now - 2 * hour));
        localStorage.setItem("admin:justExpired", entry(now - 1000));
        localStorage.setItem("admin:live", entry(now + hour));
        localStorage.setItem("admin:oldFormat", "plain-token");
        localStorage.setItem("something-else", "keep");
      },
      [HOUR] as const,
    );
    await page.reload();
    expect(await stored(page, "admin:expired")).toBeNull();
    expect(await stored(page, "admin:oldFormat")).toBeNull();
    // Within the one-hour grace period, so a fast device clock cannot drop a live pad's token.
    expect(await stored(page, "admin:justExpired")).not.toBeNull();
    expect(await stored(page, "admin:live")).not.toBeNull();
    expect(await stored(page, "something-else")).toBe("keep");
  });

  test("the sweep also runs when a pad page loads", async ({ page }) => {
    const pad = await createPad(page);
    await page.goto("/privacy");
    await page.evaluate(() =>
      localStorage.setItem("admin:other", JSON.stringify({ token: "t", expiresAt: 1 })),
    );
    await openPad(page, pad.url);
    expect(await stored(page, "admin:other")).toBeNull();
  });

  test("opening an unknown pad removes its token", async ({ page }) => {
    const unknown = "AbCdEfGhIjKlMnOpQrStUv";
    await page.goto("/privacy");
    await page.evaluate(
      (id) =>
        localStorage.setItem(
          `admin:${id}`,
          JSON.stringify({ token: "t", expiresAt: Date.now() + 3600 * 1000 }),
        ),
      unknown,
    );
    await page.goto(`/p/${unknown}#${randomKey()}`);
    await expectScreen(page, "Pad not found");
    expect(await stored(page, `admin:${unknown}`)).toBeNull();
  });
});
