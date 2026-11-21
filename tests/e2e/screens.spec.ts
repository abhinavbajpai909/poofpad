import {
  createPad,
  expect,
  expectScreen,
  expectText,
  focusEditorEnd,
  guardSecrets,
  newClient,
  openPad,
  randomKey,
  test,
  tryCreatePad,
} from "./helpers";

const UNKNOWN_PAD = "AbCdEfGhIjKlMnOpQrStUv";

test.describe("error screens", () => {
  test("link without #key shows the incomplete-link screen (test 17)", async ({ page }) => {
    const pad = await createPad(page);
    await page.goto(`/p/${pad.padId}`);
    await expectScreen(page, "This link is incomplete");
    await page.goto(`/p/${pad.padId}#`);
    await expectScreen(page, "This link is incomplete");
  });

  for (const [name, key] of [
    ["truncated", randomKey().slice(0, 30)],
    ["one character too long", randomKey() + "A"],
    ["invalid base64url characters", randomKey().slice(0, 42) + "+"],
    ["percent-encoded junk", "%00%2F" + randomKey().slice(6)],
    ["non-canonical last character", randomKey().slice(0, 42) + "B"],
  ] as const) {
    test(`a ${name} key shows the incomplete-link screen`, async ({ page }, testInfo) => {
      const pad = await createPad(page);
      guardSecrets(testInfo, pad.padId);
      await page.goto(`/p/${pad.padId}#${key}`);
      await expectScreen(page, "This link is incomplete");
      await expect(page.locator("body")).not.toContainText(key);
    });
  }

  test("wrong key shows the wrong-key screen and leaves the pad untouched for others (test 17)", async ({
    page,
    browser,
    consoleGuard,
  }, testInfo) => {
    const pad = await createPad(page);
    const wrongKey = randomKey();
    guardSecrets(testInfo, pad.padId, pad.key, wrongKey);
    await openPad(page, pad.url);
    await focusEditorEnd(page);
    await page.keyboard.type("secret text");
    await expectText(page, "secret text");

    const intruder = await newClient(browser, consoleGuard);
    await intruder.goto(`/p/${pad.padId}#${wrongKey}`);
    await expectScreen(intruder, "Wrong key");
    await expect(intruder.locator("body")).not.toContainText("secret text");

    await focusEditorEnd(page);
    await page.keyboard.type("!");
    const late = await newClient(browser, consoleGuard);
    await openPad(late, pad.url);
    await expectText(late, "secret text!");
  });

  test("unknown pad shows not found", async ({ page }) => {
    await page.goto(`/p/${UNKNOWN_PAD}#${randomKey()}`);
    await expectScreen(page, "Pad not found");
  });

  for (const path of ["/p/short", `/p/${UNKNOWN_PAD}x`, `/p/${UNKNOWN_PAD}/extra`, "/nope"]) {
    test(`malformed path ${path} answers 404`, async ({ page, consoleGuard }) => {
      consoleGuard.allow(/Failed to load resource.*404|404 \(Not Found\)/);
      const response = await page.goto(`${path}#${randomKey()}`);
      expect(response?.status()).toBe(404);
    });
  }

  test("a 15 s pad expires on every client; reload then shows not found (test 16)", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await tryCreatePad(page, 15);
    test.skip(pad === null, "15 s test pads are disabled on this server (production)");
    if (pad === null) {
      return;
    }
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);

    // Both are connected now. Expiry is 15 s after creation; the alarm may fire a little late. (No other
    // work here: on a slow engine it would race the 15 s deadline.)
    await expectScreen(page, "This pad has expired", 30_000);
    await expectScreen(other, "This pad has expired", 30_000);
    await page.reload();
    await expectScreen(page, "Pad not found");
  });
});
