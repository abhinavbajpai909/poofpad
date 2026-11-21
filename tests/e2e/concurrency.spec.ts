import type { Page } from "@playwright/test";
import {
  createPad,
  docText,
  expect,
  expectText,
  focusEditorEnd,
  modKey,
  newClient,
  openPad,
  test,
  typeLines,
} from "./helpers";

function sorted(text: string): string {
  return [...text].sort().join("");
}

async function expectConverged(pages: readonly Page[], timeout = 20_000): Promise<string> {
  await expect
    .poll(async () => new Set(await Promise.all(pages.map(docText))).size, { timeout })
    .toBe(1);
  return docText(pages[0] as Page);
}

test.describe("concurrent editing", () => {
  test("two clients typing at the same position at once: identical text, nothing lost (test 10)", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    await focusEditorEnd(page);
    await page.keyboard.type("[]");
    await expectText(other, "[]");
    for (const client of [page, other]) {
      await client.locator(".cm-content").click();
      await client.keyboard.press("End");
      await client.keyboard.press("ArrowLeft");
    }

    const a = "aaaaaaaaaaaaaaaaaaaaAAAAAAAAAAAAAAAAAAAA";
    const b = "bbbbbbbbbbbbbbbbbbbbBBBBBBBBBBBBBBBBBBBB";
    await Promise.all([
      page.keyboard.type(a, { delay: 15 }),
      other.keyboard.type(b, { delay: 15 }),
    ]);
    const final = await expectConverged([page, other]);
    expect(final.length).toBe(2 + a.length + b.length);
    expect(sorted(final)).toBe(sorted("[]" + a + b));
    expect(final.startsWith("[")).toBe(true);
    expect(final.endsWith("]")).toBe(true);
    // Each client's own keystrokes stay in order.
    expect(final.replace(/[^aA]/g, "")).toBe(a);
    expect(final.replace(/[^bB]/g, "")).toBe(b);
  });

  test("rapid typing from two clients on different lines converges", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    await focusEditorEnd(page);
    await typeLines(page, "top\nbottom");
    await expectText(other, "top\nbottom");
    await page.locator(".cm-content").click();
    await page.keyboard.press(`${await modKey(page)}+Home`);
    await page.keyboard.press("End");
    await focusEditorEnd(other);

    const lineA = " the quick brown fox jumps over the lazy dog".repeat(3);
    const lineB = " pack my box with five dozen liquor jugs".repeat(3);
    await Promise.all([page.keyboard.type(lineA), other.keyboard.type(lineB)]);
    expect(await expectConverged([page, other])).toBe(`top${lineA}\nbottom${lineB}`);
  });
});
