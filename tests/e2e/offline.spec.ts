import type { Page } from "@playwright/test";
import {
  createPad,
  docText,
  expect,
  expectText,
  focusEditorEnd,
  newClient,
  openPad,
  paste,
  test,
  waitOnline,
} from "./helpers";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from "../../src/shared/limits";
import { controlSocket } from "./network";

/** Reconnect backoff tops out at 10 s; allow one full step plus the sync. */
const RECONNECT_TIMEOUT = 25_000;
/** The longest a dead connection can go unnoticed while the tab is visible: one ping interval plus its timeout. */
const DETECTION_MS = HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS;
/** First byte of an UPDATE frame (src/shared/protocol.ts). */
const UPDATE_FRAME = 1;
/** "At once": well under the smallest reconnect backoff step plus a sync. */
const IMMEDIATE_MS = 3_000;
/** `controlSocket` records text frames (heartbeat pings) as type -1. */
const TEXT_FRAME = -1;

/** Starts recording, in the page, the first time the offline banner is shown (Date.now()). */
async function recordBanner(page: Page): Promise<void> {
  await page.evaluate(() => {
    const banner = document.querySelector<HTMLElement>(".banner");
    const record = window as Window & { bannerShownAt?: number };
    if (banner === null) {
      return;
    }
    new MutationObserver(() => {
      if (!banner.hidden) {
        record.bannerShownAt ??= Date.now();
      }
    }).observe(banner, { attributes: true, attributeFilter: ["hidden"] });
  });
}

function bannerShownAt(page: Page): Promise<number | null> {
  return page.evaluate(() => (window as Window & { bannerShownAt?: number }).bannerShownAt ?? null);
}

async function expectSameText(a: Page, b: Page): Promise<string> {
  await expect
    .poll(async () => (await docText(a)) === (await docText(b)), { timeout: RECONNECT_TIMEOUT })
    .toBe(true);
  return docText(a);
}

test.describe("offline and reconnect (test 15)", () => {
  test("a dropped connection shows the banner, keeps local edits and merges them on reconnect", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    const control = await controlSocket(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    await focusEditorEnd(page);
    await page.keyboard.type("shared.");
    await expectText(other, "shared.");

    await control.drop();
    const banner = page.locator(".banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("You are offline");

    await focusEditorEnd(page);
    await page.keyboard.type(" A offline.");
    await focusEditorEnd(other);
    await other.keyboard.type(" B online.");
    await expectText(page, "shared. A offline.");
    await expectText(other, "shared. B online.");

    control.reconnect();
    await expect(banner).toBeHidden({ timeout: RECONNECT_TIMEOUT });
    await waitOnline(page);
    const merged = await expectSameText(page, other);
    expect(merged.startsWith("shared.")).toBe(true);
    expect(merged).toContain(" A offline.");
    expect(merged).toContain(" B online.");
    expect(merged.length).toBe("shared. A offline. B online.".length);
  });

  test("both clients offline, both edit, both reconnect: merged correctly", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    const controlA = await controlSocket(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    const controlB = await controlSocket(other);
    await openPad(other, pad.url);
    await focusEditorEnd(page);
    await page.keyboard.type("base");
    await expectText(other, "base");

    await controlA.drop();
    await controlB.drop();
    await expect(page.locator(".banner")).toBeVisible();
    await expect(other.locator(".banner")).toBeVisible();
    await focusEditorEnd(page);
    await page.keyboard.type(" from-A");
    await other.locator(".cm-content").click();
    await other.keyboard.press("Home");
    await other.keyboard.type("from-B ");

    controlA.reconnect();
    controlB.reconnect();
    await waitOnline(page);
    await waitOnline(other);
    expect(await expectSameText(page, other)).toBe("from-B base from-A");
  });
  test("a half-open connection (server stops answering) is detected by the heartbeat, then reconnects and merges", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    // The behaviour itself takes up to one ping interval plus the pong timeout (35 s) to show.
    test.setTimeout(DETECTION_MS + 60_000);
    const pad = await createPad(page);
    const control = await controlSocket(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    await focusEditorEnd(page);
    await page.keyboard.type("shared.");
    await expectText(other, "shared.");

    await recordBanner(page);
    const connectionsBefore = control.connections();
    control.stall();
    const stalledAt = Date.now();
    await focusEditorEnd(page);
    await page.keyboard.type(" A stalled.");
    await focusEditorEnd(other);
    await other.keyboard.type(" B online.");
    // Nothing gets through, but nothing has closed either: the app still believes it is connected.
    await expect(page.locator(".banner")).toBeHidden();
    await expectText(page, "shared. A stalled.");

    // The banner may be up only briefly (the reconnect starts within a second), so the page records it.
    await expect.poll(() => bannerShownAt(page), { timeout: DETECTION_MS + 5_000 }).not.toBeNull();
    const detectedAfter = ((await bannerShownAt(page)) ?? 0) - stalledAt;
    expect(detectedAfter).toBeLessThanOrEqual(DETECTION_MS + 2_000);
    expect(control.sent, "a text ping was sent").toContain(TEXT_FRAME);
    // The client closed the dead connection itself and opened a new one (new ones are not stalled).
    expect(control.stalledClosedByClient).toEqual([1000]);
    await expect.poll(() => control.connections()).toBeGreaterThan(connectionsBefore);
    await expect(page.locator(".banner")).toBeHidden({ timeout: RECONNECT_TIMEOUT });
    await waitOnline(page);
    const merged = await expectSameText(page, other);
    expect(merged.startsWith("shared.")).toBe(true);
    expect(merged).toContain(" A stalled.");
    expect(merged).toContain(" B online.");
    expect(merged.length).toBe("shared. A stalled. B online.".length);
  });

  test("the browser's offline event shows the banner at once; online reconnects at once and merges", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    await focusEditorEnd(page);
    await page.keyboard.type("shared.");
    await expectText(other, "shared.");

    await page.context().setOffline(true);
    const banner = page.locator(".banner");
    await expect(banner).toBeVisible({ timeout: IMMEDIATE_MS });
    await focusEditorEnd(page);
    await page.keyboard.type(" A offline.");
    await focusEditorEnd(other);
    await other.keyboard.type(" B online.");
    await expectText(other, "shared. B online.");
    // While the browser says it is offline the app waits rather than retrying: the banner stays up.
    await page.waitForTimeout(3_000);
    await expect(banner).toBeVisible();
    await expectText(page, "shared. A offline.");

    await page.context().setOffline(false);
    // No backoff wait: the online event reconnects right away.
    await expect(banner).toBeHidden({ timeout: IMMEDIATE_MS });
    await waitOnline(page);
    const merged = await expectSameText(page, other);
    expect(merged).toContain(" A offline.");
    expect(merged).toContain(" B online.");
    expect(merged.length).toBe("shared. A offline. B online.".length);
  });
});

test.describe("edits lost in flight (review item 2)", () => {
  test("a large update lost in flight plus a large offline edit still reaches everyone after reconnect", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    const control = await controlSocket(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    await focusEditorEnd(page);
    await page.keyboard.type("base");
    await expectText(other, "base");

    // The connection silently dies; A does not know yet. A's next 900 KB paste is sent (and flushed)
    // but never reaches the server.
    control.stall();
    const updatesSent = () => control.sent.filter((type) => type === UPDATE_FRAME).length;
    const before = updatesSent();
    await focusEditorEnd(page);
    await paste(page, { ascii: 900 * 1024 });
    await expect.poll(updatesSent).toBeGreaterThan(before);
    await control.drop();
    await expect(page.locator(".banner")).toBeVisible();

    // Offline, A pastes another 800 KB. Each edit fits a frame; together with the lost one they do not.
    await focusEditorEnd(page);
    await paste(page, { ascii: 800 * 1024 });
    await focusEditorEnd(other);
    await other.keyboard.type(" B online.");
    await expectText(other, "base B online.");

    control.reconnect();
    await waitOnline(page);
    const expectedLength = "base".length + 900 * 1024 + 800 * 1024 + " B online.".length;
    await expect
      .poll(async () => (await docText(page)).length, { timeout: RECONNECT_TIMEOUT })
      .toBe(expectedLength);
    await expect
      .poll(async () => (await docText(other)).length, { timeout: RECONNECT_TIMEOUT })
      .toBe(expectedLength);
    expect(await docText(page)).toBe(await docText(other));
    await expect(page.locator(".message-title")).toHaveCount(0);
  });
});
