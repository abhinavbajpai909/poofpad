import {
  TOO_LARGE,
  asciiText,
  createPad,
  docText,
  expect,
  expectText,
  focusEditorEnd,
  newClient,
  openPad,
  paste,
  test,
} from "./helpers";

test.describe("paste size limits (test 13)", () => {
  test("a 500 KB paste syncs to the other client", async ({ page, browser, consoleGuard }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    const text = asciiText(500 * 1024);
    await page.locator(".cm-content").click();
    await paste(page, text);
    await expectText(page, text);
    await expectText(other, text, 30_000);
    await expect(page.locator(".toast")).not.toContainText(TOO_LARGE);
  });

  test("a 6 MB paste is blocked with a clear message; the other client is unaffected", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    await focusEditorEnd(page);
    await page.keyboard.type("before");
    await expectText(other, "before");

    await paste(page, { ascii: 6 * 1024 * 1024 });
    await expect(page.locator(".toast")).toContainText(TOO_LARGE);
    expect(await docText(page)).toBe("before");

    await focusEditorEnd(other);
    await other.keyboard.type(" after");
    await expectText(page, "before after");
    await expect(other.locator('.status-row[data-state="online"]')).toBeAttached();
    await expect(page.locator('.status-row[data-state="online"]')).toBeAttached();
  });
});
