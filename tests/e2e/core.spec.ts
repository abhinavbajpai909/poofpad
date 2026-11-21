import {
  createPad,
  docText,
  expect,
  expectScreen,
  expectText,
  focusEditorEnd,
  guardSecrets,
  modKey,
  newClient,
  openPad,
  openSidebar,
  paste,
  sidebarButton,
  test,
  typeLines,
  waitOnline,
} from "./helpers";

test.describe("pad basics", () => {
  test("landing creates a pad, two clients sync, text survives reload", async ({
    page,
    browser,
    consoleGuard,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.getByLabel("Join with link")).toBeVisible();
    await page.getByRole("button", { name: "New pad" }).click();
    await page.waitForURL(/\/p\/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$/);
    await waitOnline(page);
    const url = new URL(page.url());
    guardSecrets(testInfo, url.pathname.slice(3), url.hash.slice(1));

    await focusEditorEnd(page);
    await page.keyboard.type("hello from A");
    const other = await newClient(browser, consoleGuard);
    await openPad(other, url.pathname + url.hash);
    await expectText(other, "hello from A");

    await focusEditorEnd(other);
    await other.keyboard.type(" and B");
    await expectText(page, "hello from A and B");

    await page.reload();
    await waitOnline(page);
    await expectText(page, "hello from A and B");
  });

  test("an empty pad stays empty and usable", async ({ page, browser, consoleGuard }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    expect(await docText(page)).toBe("");
    expect(await docText(other)).toBe("");
    await page.reload();
    await waitOnline(page);
    expect(await docText(page)).toBe("");
    await focusEditorEnd(other);
    await other.keyboard.type("x");
    await expectText(page, "x");
  });

  test("Unicode round-trips exactly (test 14)", async ({ page, browser, consoleGuard }) => {
    const text = [
      "emoji 👩‍💻 family 👨‍👩‍👧 flag 🇮🇳",
      "Hindi नमस्ते दुनिया",
      "Arabic مرحبا بالعالم",
      "tab\there",
      "zero‍width joiner",
      "crlf line one\r\ncrlf line two",
    ].join("\n");
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    // Pasted, as Windows text (CRLF) would arrive in practice.
    await page.locator(".cm-content").click();
    await paste(page, text);
    await expectText(page, text);
    await expectText(other, text);
    const late = await newClient(browser, consoleGuard);
    await openPad(late, pad.url);
    await expectText(late, text);
  });

  test("undo and redo affect only your own edits", async ({ page, browser, consoleGuard }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);

    // Each person's text arrives as one edit, so it is one undo step whatever the typing speed (the
    // undo manager groups keystrokes less than 500 ms apart; a slow engine can split typed words).
    await focusEditorEnd(page);
    await page.keyboard.insertText("mine");
    await expectText(other, "mine");
    await focusEditorEnd(other);
    await other.keyboard.insertText(" theirs");
    await expectText(page, "mine theirs");

    const mod = await modKey(page);
    await page.locator(".cm-content").focus();
    await page.keyboard.press(`${mod}+z`);
    await expectText(page, " theirs");
    await expectText(other, " theirs");
    // Shift with a letter key gives an upper-case key value on a real keyboard.
    await page.keyboard.press(`${mod}+Shift+Z`);
    await expectText(page, "mine theirs");
    await expectText(other, "mine theirs");
  });

  test("language change syncs to others and survives reload (test 19)", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);

    await openSidebar(page);
    await page.locator("#language-select").selectOption("python");
    await expect(other.locator("#language-select")).toHaveValue("python");
    await focusEditorEnd(other);
    await typeLines(other, "def f():\nreturn 1");
    // Python highlighting reached the other client's editor (a keyword token is styled).
    await expect(page.locator(".cm-content span").filter({ hasText: /^def$/ })).toHaveCount(1);
    await other.reload();
    await waitOnline(other);
    await expect(other.locator("#language-select")).toHaveValue("python");
  });

  test("theme toggle persists across reload (test 19)", async ({ page }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const html = page.locator("html");
    const before = await html.getAttribute("data-theme");
    const toggleName = before === "light" ? "Dark theme" : "Light theme";
    await sidebarButton(page, toggleName);
    const after = before === "light" ? "dark" : "light";
    await expect(html).toHaveAttribute("data-theme", after);
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", after);
    await page.goto("/");
    await expect(html).toHaveAttribute("data-theme", after);
  });

  test("countdown is right after reload and on a device whose clock is 2 hours fast", async ({
    page,
  }) => {
    const pad = await createPad(page, 3600);
    await openPad(page, pad.url);
    const countdown = page.locator(".countdown").first();
    await expect(countdown).toHaveText(/^(1:00:00|59:\d\d)$/);
    await page.reload();
    await waitOnline(page);
    await expect(countdown).toHaveText(/^(1:00:00|59:\d\d)$/);

    await page.clock.setFixedTime(new Date(Date.now() + 2 * 3600 * 1000));
    await page.reload();
    await waitOnline(page);
    await expect(countdown).toHaveText(/^(1:00:00|59:\d\d)$/);
  });

  test("QR dialog shows the code and the link text", async ({ page }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    await sidebarButton(page, "QR code");
    const dialog = page.getByRole("dialog", { name: "Scan to open this pad" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("img", { name: "QR code of the pad link" })).toBeVisible();
    await expect(dialog.locator(".qr-link")).toHaveText(page.url());
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });

  test("your name is editable, shared, and its input has a name and id", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);

    await openSidebar(page);
    const input = page.getByLabel("Your name (you)");
    await expect(input).toHaveAttribute("id", "display-name");
    await expect(input).toHaveAttribute("name", "display-name");
    await input.fill("Ada <b>Lovelace</b>");
    await input.press("Enter");
    await openSidebar(other);
    await expect(other.locator(".user-label")).toHaveText("Ada <b>Lovelace</b>");
    await expect(other.locator(".user-label b")).toHaveCount(0);
    await expect(other.getByRole("heading", { name: "Active users (2)" })).toBeVisible();
  });

  test("End now: creator confirms, every client sees the pad gone", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New pad" }).click();
    await page.waitForURL(/\/p\//);
    await waitOnline(page);
    const url = new URL(page.url());
    const other = await newClient(browser, consoleGuard);
    await openPad(other, url.pathname + url.hash);

    await openSidebar(other);
    await expect(other.getByRole("button", { name: "End now" })).toHaveCount(0);

    await sidebarButton(page, "End now");
    const dialog = page.getByRole("dialog", { name: "End this pad now?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.status-row[data-state="online"]')).toBeAttached();

    await sidebarButton(page, "End now");
    await page.getByRole("button", { name: "End pad now" }).click();
    await expectScreen(page, "This pad has expired");
    await expectScreen(other, "This pad has expired");
    await other.reload();
    await expectScreen(other, "Pad not found");
  });

  test("privacy page", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("body")).toContainText(/encrypt/i);
  });
});
