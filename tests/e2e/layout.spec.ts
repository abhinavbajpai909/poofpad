import type { Page } from "@playwright/test";
import { createPad, expect, expectScreen, openPad, randomKey, test } from "./helpers";

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("360 px phone layout (test 20)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
  });

  test("no horizontal scroll on any page", async ({ page }) => {
    await page.goto("/");
    await expectNoHorizontalScroll(page);
    await page.goto("/privacy");
    await expectNoHorizontalScroll(page);
    await page.goto(`/p/AbCdEfGhIjKlMnOpQrStUv#${randomKey()}`);
    await expectScreen(page, "Pad not found");
    await expectNoHorizontalScroll(page);

    const pad = await createPad(page);
    await openPad(page, pad.url);
    await page.locator(".cm-content").click();
    await page.keyboard.insertText("a-very-long-line-without-spaces-".repeat(40));
    await expectNoHorizontalScroll(page);
  });

  test("the drawer opens from the menu and closes with Esc, a tap outside, or its button", async ({
    page,
  }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const menu = page.getByRole("button", { name: "Open menu" });
    const sidebar = page.locator("#pad-sidebar");
    await expect(page.locator(".topbar .countdown")).toHaveText(/\d\d:\d\d/);
    await expect(page.locator(".topbar-peers")).toHaveText("1 person");

    await menu.click();
    await expect(sidebar).toHaveClass(/drawer-open/);
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(sidebar).not.toHaveClass(/drawer-open/);
    await expect(menu).toBeFocused();

    await menu.click();
    await expect(sidebar).toHaveClass(/drawer-open/);
    await page.mouse.click(350, 400);
    await expect(sidebar).not.toHaveClass(/drawer-open/);

    await menu.click();
    await page.getByRole("button", { name: "Close menu" }).click();
    await expect(sidebar).not.toHaveClass(/drawer-open/);
  });

  test("touch targets are at least 44 px and the editor font at least 16 px", async ({ page }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const fontSize = await page
      .locator(".cm-content")
      .evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);

    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.locator("#pad-sidebar")).toHaveClass(/drawer-open/);
    const targets = page.locator(
      "#pad-sidebar button, #pad-sidebar select, #pad-sidebar input, .menu-button",
    );
    const count = await targets.count();
    expect(count).toBeGreaterThan(5);
    for (let i = 0; i < count; i += 1) {
      const box = await targets.nth(i).boundingBox();
      expect(
        box,
        await targets.nth(i).evaluate((node) => node.outerHTML.slice(0, 80)),
      ).not.toBeNull();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("security headers on the running server (test 21)", () => {
  test("are on /, a pad page, /privacy and a JS asset", async ({ request }) => {
    const home = await request.get("/");
    const html = await home.text();
    const script = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1];
    expect(script).toBeDefined();
    for (const path of ["/", "/p/AbCdEfGhIjKlMnOpQrStUv", "/privacy", script ?? ""]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const headers = response.headers();
      expect(headers["content-security-policy"], path).toContain("default-src 'self'");
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(headers["strict-transport-security"], path).toBe(
        "max-age=31536000; includeSubDomains",
      );
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["referrer-policy"], path).toBe("no-referrer");
      expect(headers["cross-origin-opener-policy"], path).toBe("same-origin");
      expect(headers["permissions-policy"], path).toContain("camera=()");
    }
  });
});
