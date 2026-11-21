import type { Page } from "@playwright/test";
import {
  createPad,
  expect,
  expectText,
  focusEditorEnd,
  openPad,
  sidebarButton,
  test,
} from "./helpers";

/**
 * Test 18. Reading the clipboard back needs the clipboard-read permission, which Playwright can only
 * grant in some engines; where it can't, the test is skipped with the browser's own reason.
 */
test.describe("copy buttons (test 18)", () => {
  test("Copy link and Copy all put the right text on the clipboard", async ({
    browser,
    baseURL,
    consoleGuard,
  }) => {
    // Some engines accept the permission names but fail when the page opens, so both are tried here.
    let page: Page | null = null;
    let reason = "";
    try {
      const context = await browser.newContext({
        baseURL: baseURL ?? "",
        permissions: ["clipboard-read", "clipboard-write"],
      });
      consoleGuard.watch(context);
      page = await context.newPage();
    } catch (error) {
      reason = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
    }
    test.skip(page === null, `Playwright cannot grant clipboard permissions here: ${reason}`);
    if (page === null) {
      return;
    }
    const tab = page;
    // Records the exact string the app hands to the clipboard, before the OS touches it.
    await tab.addInitScript(() => {
      const written: string[] = [];
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (value: string) => {
        written.push(value);
        return original(value);
      };
      Object.assign(window, { clipboardWrites: written });
    });
    const lastWrite = () =>
      tab.evaluate(() =>
        (window as unknown as { clipboardWrites: string[] }).clipboardWrites.at(-1),
      );
    // Windows stores clipboard text with CRLF line ends, so the read-back is compared with LF restored.
    const readBack = async () =>
      (await tab.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");

    const pad = await createPad(tab);
    await openPad(tab, pad.url);
    const text = "line one\nline two 👋\n\tindented";
    await focusEditorEnd(tab);
    await tab.keyboard.insertText(text);
    await expectText(tab, text);

    await sidebarButton(tab, "Copy link");
    await expect(tab.locator(".toast")).toHaveText("Link copied.");
    expect(await lastWrite()).toBe(tab.url());
    expect(await readBack()).toBe(tab.url());

    await sidebarButton(tab, "Copy all");
    await expect(tab.locator(".toast")).toHaveText("Text copied.");
    expect(await lastWrite()).toBe(text);
    expect(await readBack()).toBe(text);
  });
});
