import {
  createPad,
  expect,
  expectScreen,
  guardSecrets,
  newClient,
  openPad,
  randomKey,
  shareButton,
  test,
  waitOnline,
} from "./helpers";
import { controlSocket } from "./network";

/** The first stored row of a pad is its key check (docs/protocol.md): whoever writes it first decides which key is right. */
test.describe("key check on an empty pad (review item 3)", () => {
  test("the race is real: a client with a wrong key that reaches an empty pad first makes the creator see 'Wrong key'", async ({
    page,
    browser,
    consoleGuard,
  }, testInfo) => {
    const pad = await createPad(page);
    const wrongKey = randomKey();
    guardSecrets(testInfo, pad.padId, pad.key, wrongKey);
    const early = await newClient(browser, consoleGuard);
    await early.goto(`/p/${pad.padId}#${wrongKey}`);
    await waitOnline(early);
    await page.goto(pad.url);
    await expectScreen(page, "Wrong key");
  });

  test("the share link and QR code stay disabled until this client has synced, so the link cannot go out before the key check is written", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    const control = await controlSocket(page);
    await control.drop();
    await page.goto(pad.url);
    const copyLink = shareButton(page, "Copy link");
    const qr = shareButton(page, "QR code");
    await expect(copyLink).toBeDisabled();
    await expect(qr).toBeDisabled();
    // Copy all copies only the text, not the link, so it is not held back.
    await expect(shareButton(page, "Copy all")).toBeEnabled();

    control.reconnect();
    await waitOnline(page);
    await expect(copyLink).toBeEnabled({ timeout: 25_000 });
    await expect(qr).toBeEnabled();

    // And the pad works for the person the link goes to.
    const friend = await newClient(browser, consoleGuard);
    await openPad(friend, pad.url);
  });

  test("once enabled, the buttons stay enabled across a later drop (the key check is long stored)", async ({
    page,
  }) => {
    const pad = await createPad(page);
    const control = await controlSocket(page);
    await openPad(page, pad.url);
    await control.drop();
    await expect(page.locator(".banner")).toBeVisible();
    await expect(shareButton(page, "Copy link")).toBeEnabled();
    await expect(shareButton(page, "QR code")).toBeEnabled();
  });
});
