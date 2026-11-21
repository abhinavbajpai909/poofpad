import {
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Locator,
  type Page,
  type TestInfo,
  test as base,
  expect,
} from "@playwright/test";

export { expect };

export interface CreatedPad {
  padId: string;
  adminToken: string;
  expiresAt: number;
  /** Path plus `#key`, ready for `page.goto`. */
  url: string;
  key: string;
}

interface ConsoleGuard {
  /** Console errors matching this are expected in the current test. */
  allow(pattern: RegExp): void;
  /**
   * Watches a context created inside the test (the default context is watched already) and closes it
   * when the test ends. The browser is shared by every test in a worker, so a context left open keeps
   * its pad, socket and timers running and slows down every later test.
   */
  watch(context: BrowserContext): void;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomKey(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Every test fails on any console error or uncaught page error unless it declared it (test 20: "no
 * console errors on any page"). The messages are also checked for pad IDs and keys (no logging).
 */
export const test = base.extend<{ consoleGuard: ConsoleGuard }>({
  consoleGuard: [
    async ({ context }, use, testInfo: TestInfo) => {
      const allowed: RegExp[] = [];
      const errors: string[] = [];
      const all: string[] = [];
      const onConsole = (message: ConsoleMessage): void => {
        all.push(message.text());
        if (message.type() === "error") {
          errors.push(message.text());
        }
      };
      const onError = (error: Error): void => {
        errors.push(`pageerror: ${error.message}`);
      };
      const extraContexts: BrowserContext[] = [];
      const listen = (watched: BrowserContext): void => {
        watched.on("console", onConsole);
        watched.on("weberror", (webError) => onError(webError.error()));
      };
      listen(context);
      await use({
        allow: (pattern) => allowed.push(pattern),
        watch: (extra) => {
          listen(extra);
          extraContexts.push(extra);
        },
      });
      await Promise.all(extraContexts.map((extra) => extra.close()));
      const unexpected = errors.filter((text) => !allowed.some((pattern) => pattern.test(text)));
      if (testInfo.status === testInfo.expectedStatus) {
        expect(unexpected, "console errors").toEqual([]);
        const secrets = (testInfo.annotations.find((a) => a.type === "secrets")?.description ?? "")
          .split(" ")
          .filter((value) => value.length > 0);
        for (const secret of secrets) {
          expect(
            all.filter((text) => text.includes(secret)),
            "secret in console",
          ).toEqual([]);
        }
      }
    },
    { auto: true },
  ],
});

/** Records pad IDs and keys that must never show up in console output. */
export function guardSecrets(testInfo: TestInfo, ...values: string[]): void {
  const existing = testInfo.annotations.find((a) => a.type === "secrets");
  if (existing) {
    existing.description = `${existing.description ?? ""} ${values.join(" ")}`;
  } else {
    testInfo.annotations.push({ type: "secrets", description: values.join(" ") });
  }
}

/** Creates a pad through the API, or returns null if the server refuses that TTL (15 s in production). */
export async function tryCreatePad(page: Page, ttl: number): Promise<CreatedPad | null> {
  const response = await page.request.post(new URL("/api/pads", baseUrl()).href, {
    headers: { Origin: new URL(baseUrl()).origin },
    data: { ttl },
  });
  if (response.status() === 400) {
    return null;
  }
  expect(response.status(), "create pad").toBe(201);
  const body = (await response.json()) as {
    padId: string;
    adminToken: string;
    expiresAt: number;
  };
  const key = randomKey();
  return { ...body, key, url: `/p/${body.padId}#${key}` };
}

export async function createPad(page: Page, ttl = 3600): Promise<CreatedPad> {
  const pad = await tryCreatePad(page, ttl);
  if (pad === null) {
    throw new Error(`server refused ttl ${ttl}`);
  }
  return pad;
}

/** Lets this context end the pad (the landing page stores the token the same way). */
export async function becomeCreator(page: Page, pad: CreatedPad): Promise<void> {
  await page.addInitScript(
    ([padId, token, expiresAt]) =>
      localStorage.setItem(`admin:${padId}`, JSON.stringify({ token, expiresAt })),
    [pad.padId, pad.adminToken, pad.expiresAt] as const,
  );
}

/** The configured base URL (BASE_URL for a deployed server, else the local wrangler dev). */
export function baseUrl(): string {
  const configured = base.info().project.use.baseURL;
  if (configured === undefined) {
    throw new Error("baseURL is not configured");
  }
  return configured;
}

export async function waitOnline(page: Page): Promise<void> {
  await expect(page.locator('.status-row[data-state="online"]')).toBeAttached();
}

/** Opens a pad and waits until it is connected and synced. */
export async function openPad(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitOnline(page);
}

/** A second (third, ...) person: own browser context, so own localStorage and identity. */
export async function newClient(
  browser: Browser,
  guard: ConsoleGuard,
  options: Parameters<Browser["newContext"]>[0] = {},
): Promise<Page> {
  const context = await browser.newContext({ baseURL: baseUrl(), ...options });
  guard.watch(context);
  return context.newPage();
}

/**
 * The editor's full text. CodeMirror renders only visible lines, so the DOM can't be used for long
 * documents; CodeMirror 6 keeps its view on the content element (internal, test-only use).
 */
export function docText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const content = document.querySelector(".cm-content") as
      (Element & { cmTile?: { view?: { state: { doc: { toString(): string } } } } }) | null;
    if (content === null) {
      const screen = document.querySelector(".message-title")?.textContent ?? "no editor";
      throw new Error(`no editor on the page (it shows: ${screen})`);
    }
    const view = content.cmTile?.view;
    if (view === undefined) {
      throw new Error("CodeMirror view not found on .cm-content (internal property changed?)");
    }
    return view.state.doc.toString();
  });
}

export async function expectText(page: Page, expected: string, timeout = 15_000): Promise<void> {
  await expect.poll(() => docText(page), { timeout }).toBe(expected);
}

/**
 * Types text with line breaks. CodeMirror's Android mode holds Enter back briefly, waiting for the DOM
 * change a real Android keyboard makes; Playwright's emulated Android types on immediately and the Enter
 * is dropped. So each Enter is pressed on its own and the newline is awaited before typing on.
 */
export async function typeLines(page: Page, text: string): Promise<void> {
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      const before = (await docText(page)).split("\n").length;
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await docText(page)).split("\n").length).toBe(before + 1);
    }
    await page.keyboard.type(line);
  }
}

export async function focusEditorEnd(page: Page): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${await modKey(page)}+End`);
}

/** CodeMirror's "Mod" is Meta where it thinks it runs on Apple platforms (iPhone emulation), else Control. */
export async function modKey(page: Page): Promise<"Meta" | "Control"> {
  // CodeMirror's own rule (@codemirror/view): iOS Safari, or a platform string containing "Mac". The
  // user agent alone is not enough: Playwright's "Desktop Safari" claims a Mac UA on a Windows platform.
  const mac = await page.evaluate(() => {
    const safari = /Apple Computer/.test(navigator.vendor);
    const ios = safari && (/Mobile\/\w+/.test(navigator.userAgent) || navigator.maxTouchPoints > 2);
    return ios || /Mac/.test(navigator.platform);
  });
  return mac ? "Meta" : "Control";
}

/**
 * Pastes `text` at the cursor. Chromium and WebKit get a real paste event (CodeMirror's own paste
 * path). Firefox drops the data of synthetic paste events and Playwright can't grant it clipboard
 * access, so there the same change is dispatched as a CodeMirror "input.paste" transaction, which goes
 * through the same change filters (including the size limit). `{ ascii: n }` builds `asciiText(n)`
 * inside the page, so multi-megabyte pastes don't have to cross the Playwright protocol.
 */
export async function paste(page: Page, text: string | { ascii: number }): Promise<void> {
  await page.evaluate(
    ([spec, line]) => {
      const value =
        typeof spec === "string"
          ? spec
          : line.repeat(Math.ceil(spec.ascii / line.length)).slice(0, spec.ascii);
      const content = document.querySelector(".cm-content") as
        | (HTMLElement & {
            cmTile?: {
              view?: {
                state: { selection: { main: { from: number; to: number } } };
                dispatch(spec: unknown): void;
                focus(): void;
              };
            };
          })
        | null;
      const view = content?.cmTile?.view;
      if (content === null || view === undefined) {
        throw new Error("editor not found");
      }
      if (navigator.userAgent.includes("Firefox")) {
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: value },
          selection: { anchor: from + value.length },
          userEvent: "input.paste",
          scrollIntoView: true,
        });
        return;
      }
      const data = new DataTransfer();
      data.setData("text/plain", value);
      content.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    [text, ASCII_LINE] as const,
  );
}

/** Applies an edit as if typed or pasted by this user (used to script big edits quickly). */
export async function edit(
  page: Page,
  change: { from: number; to: number; insert: string },
): Promise<void> {
  await page.evaluate((spec) => {
    const content = document.querySelector(".cm-content") as
      (Element & { cmTile?: { view?: { dispatch(spec: unknown): void } } }) | null;
    content?.cmTile?.view?.dispatch({ changes: spec, userEvent: "input.paste" });
  }, change);
}

/** Opens the drawer when the sidebar is a phone drawer (no-op on wide screens). */
export async function openSidebar(page: Page): Promise<void> {
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.locator("#pad-sidebar")).toHaveClass(/drawer-open/);
  }
}

/** A sidebar button as a locator (also when the phone drawer is closed), to check its state without clicking. */
export function shareButton(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true, includeHidden: true });
}

export async function sidebarButton(page: Page, name: string): Promise<void> {
  await openSidebar(page);
  await page.getByRole("button", { name, exact: true }).click();
}

export async function expectScreen(page: Page, title: string, timeout?: number): Promise<void> {
  await expect(page.locator(".message-title")).toHaveText(
    title,
    timeout === undefined ? {} : { timeout },
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const TOO_LARGE = "That change is too large to sync";

const ASCII_LINE = "lorem ipsum dolor sit amet, consectetur adipiscing elit 1234\n";

/** `bytes` of ASCII text in lines of about 60 characters. */
export function asciiText(bytes: number): string {
  return ASCII_LINE.repeat(Math.ceil(bytes / ASCII_LINE.length)).slice(0, bytes);
}
