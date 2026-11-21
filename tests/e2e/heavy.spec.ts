import type { Page } from "@playwright/test";
import {
  TOO_LARGE,
  asciiText,
  createPad,
  docText,
  edit,
  expect,
  expectScreen,
  expectText,
  focusEditorEnd,
  newClient,
  openPad,
  paste,
  test,
  waitOnline,
} from "./helpers";
import { controlSocket } from "./network";

const SNAPSHOT_FRAME = 5;

/** A plausible Python file of `lines` lines (about 40 bytes per line). */
function pythonFile(lines: number): string {
  const out: string[] = [];
  for (let i = 0; out.length < lines; i += 1) {
    out.push(`def handler_${i}(request, value=${i}):`);
    out.push(`    """Handle request number ${i} and return its total."""`);
    out.push(`    total = value * ${i % 97} + len(request)`);
    out.push(`    # keep the total within the range 0..${i}`);
    out.push(`    return {"id": ${i}, "total": total}`);
  }
  return out.slice(0, lines).join("\n");
}

async function converged(pages: readonly Page[], timeout: number): Promise<string> {
  await expect
    .poll(async () => new Set(await Promise.all(pages.map(docText))).size, { timeout })
    .toBe(1);
  return docText(pages[0] as Page);
}

/** Wall-clock ms until `page`'s text equals `expected`. */
async function msUntil(page: Page, expected: string, start: number): Promise<number> {
  await expectText(page, expected, 120_000);
  return Date.now() - start;
}

/** Median in-page time (ms) for one typed character: CodeMirror update plus the next frame. */
function keystrokeMs(page: Page, samples: number): Promise<number> {
  return page.evaluate(async (count) => {
    const content = document.querySelector(".cm-content") as Element & {
      cmTile: {
        view: {
          state: { doc: { length: number } };
          dispatch(spec: unknown): void;
        };
      };
    };
    const view = content.cmTile.view;
    const times: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const start = performance.now();
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "x" },
        userEvent: "input.type",
      });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)] ?? 0;
  }, samples);
}

test.describe("@heavy large documents and many clients", () => {
  test.describe.configure({ timeout: 300_000 });

  test("edit-size boundary: the largest ASCII paste that still syncs, and one byte more is blocked", async ({
    page,
    browser,
    consoleGuard,
  }, testInfo) => {
    const tryPaste = async (bytes: number): Promise<"synced" | "blocked"> => {
      const pad = await createPad(page);
      await openPad(page, pad.url);
      await page.locator(".cm-content").click();
      await paste(page, asciiText(bytes));
      const length = (await docText(page)).length;
      if (length === 0) {
        await expect(page.locator(".toast")).toContainText(TOO_LARGE);
        return "blocked";
      }
      expect(length).toBe(bytes);
      return "synced";
    };
    // Binary search between a size that must fit (1 MB minus 8 KB) and one that must not (1 MB).
    let fits = 1024 * 1024 - 8192;
    let blocked = 1024 * 1024;
    expect(await tryPaste(fits)).toBe("synced");
    expect(await tryPaste(blocked)).toBe("blocked");
    while (blocked - fits > 1) {
      const middle = Math.floor((fits + blocked) / 2);
      if ((await tryPaste(middle)) === "synced") {
        fits = middle;
      } else {
        blocked = middle;
      }
    }

    // The largest allowed paste really goes through the server (not refused with 4013) and syncs.
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    const text = asciiText(fits);
    await page.locator(".cm-content").click();
    await paste(page, text);
    await expectText(other, text, 60_000);
    await expect(page.locator('.status-row[data-state="online"]')).toBeAttached();
    expect(await tryPaste(fits + 1)).toBe("blocked");
    testInfo.annotations.push({
      type: "measured",
      description: `largest ASCII paste that syncs: ${fits} bytes; ${fits + 1} is blocked`,
    });
  });

  for (const lines of [5000, 20000]) {
    test(`a ${lines}-line Python file syncs, a 500-line add/delete converges back`, async ({
      page,
      browser,
      consoleGuard,
    }, testInfo) => {
      const file = pythonFile(lines);
      const pad = await createPad(page);
      await openPad(page, pad.url);
      const other = await newClient(browser, consoleGuard);
      await openPad(other, pad.url);

      await page.locator(".cm-content").click();
      const pasteStart = Date.now();
      await paste(page, file);
      const blocked = (await docText(page)).length === 0;
      if (blocked) {
        await expect(page.locator(".toast")).toContainText(TOO_LARGE);
        testInfo.annotations.push({
          type: "measured",
          description: `${lines} lines (${file.length} bytes) is over the per-change limit: blocked`,
        });
        return;
      }
      const syncMs = await msUntil(other, file, pasteStart);

      // The second client adds 500 lines in the middle and deletes 500 lines near the end.
      const added = pythonFile(500).replace(/handler_/g, "added_") + "\n";
      const middle = file.indexOf("\n", Math.floor(file.length / 2)) + 1;
      await edit(other, { from: middle, to: middle, insert: added });
      const afterAdd = file.slice(0, middle) + added + file.slice(middle);
      const lineStarts = [0];
      for (let i = 0; i < afterAdd.length; i += 1) {
        if (afterAdd[i] === "\n") {
          lineStarts.push(i + 1);
        }
      }
      const delFrom = lineStarts[lineStarts.length - 700] ?? 0;
      const delTo = lineStarts[lineStarts.length - 200] ?? 0;
      const editStart = Date.now();
      await edit(other, { from: delFrom, to: delTo, insert: "" });
      const expected = afterAdd.slice(0, delFrom) + afterAdd.slice(delTo);
      const editSyncMs = await msUntil(page, expected, editStart);

      const localKeyMs = await keystrokeMs(page, 30);
      await focusEditorEnd(page);
      const typed = "# typed at the end";
      const typeStart = Date.now();
      await page.keyboard.type(typed);
      const typeMs = (Date.now() - typeStart) / typed.length;
      await expectText(other, expected + "x".repeat(30) + typed, 60_000);
      const remoteMs = Date.now() - typeStart;

      testInfo.annotations.push({
        type: "measured",
        description:
          `${lines} lines, ${file.length} bytes: paste→other client ${syncMs} ms; ` +
          `500-line add + 500-line delete→first client ${editSyncMs} ms; ` +
          `local keystroke (median, in-page) ${localKeyMs.toFixed(1)} ms; ` +
          `keyboard.type ${typeMs.toFixed(0)} ms/char; typed line visible remotely after ${remoteMs} ms`,
      });
    });
  }

  test("a 4 MB pad (four ~1 MB pastes) stays usable; where it degrades", async ({
    page,
    browser,
    consoleGuard,
  }, testInfo) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    const part = 1_000_000;
    for (let i = 1; i <= 4; i += 1) {
      await focusEditorEnd(page);
      await paste(page, { ascii: part });
      await expect
        .poll(async () => (await docText(other)).length, { timeout: 60_000 })
        .toBe(i * part);
    }
    const localKeyMs = await keystrokeMs(page, 30);
    const typeStart = Date.now();
    await focusEditorEnd(page);
    await page.keyboard.type("end");
    await expect
      .poll(async () => (await docText(other)).endsWith("x".repeat(30) + "end"), {
        timeout: 60_000,
      })
      .toBe(true);
    const remoteMs = Date.now() - typeStart;

    const late = await newClient(browser, consoleGuard);
    const loadStart = Date.now();
    await openPad(late, pad.url);
    await expect
      .poll(async () => (await docText(late)).length, { timeout: 60_000 })
      .toBe(4 * part + 33);
    const lateMs = Date.now() - loadStart;
    await expect(page.locator('.status-row[data-state="online"]')).toBeAttached();
    testInfo.annotations.push({
      type: "measured",
      description:
        `4,000,033-byte pad: local keystroke (median, in-page) ${localKeyMs.toFixed(1)} ms; ` +
        `typed text visible remotely after ${remoteMs} ms; late joiner fully loaded after ${lateMs} ms`,
    });
  });

  test("repeated ~900 KB paste and delete never hits the 5 MB limit: compaction keeps the pad small", async ({
    page,
    browser,
    consoleGuard,
  }, testInfo) => {
    const pad = await createPad(page);
    const control = await controlSocket(page);
    await openPad(page, pad.url);
    const other = await newClient(browser, consoleGuard);
    await openPad(other, pad.url);
    const chunk = asciiText(900 * 1024);
    const rounds = 8;
    for (let round = 0; round < rounds; round += 1) {
      await page.locator(".cm-content").click();
      await paste(page, chunk);
      await expectText(other, chunk, 60_000);
      await edit(page, { from: 0, to: chunk.length, insert: `round ${round}\n` });
      await expectText(other, `round ${round}\n`, 60_000);
      await edit(page, { from: 0, to: `round ${round}\n`.length, insert: "" });
      await expectText(other, "", 60_000);
    }
    await focusEditorEnd(page);
    await page.keyboard.type("still alive");
    await expectText(other, "still alive");
    await expect(page.locator('.status-row[data-state="online"]')).toBeAttached();
    const snapshots = control.sent.filter((type) => type === SNAPSHOT_FRAME).length;
    expect(snapshots).toBeGreaterThan(0);
    const late = await newClient(browser, consoleGuard);
    await openPad(late, pad.url);
    await expectText(late, "still alive");
    testInfo.annotations.push({
      type: "measured",
      description: `${rounds} × ${chunk.length} bytes pasted and deleted (${((rounds * chunk.length) / 1048576).toFixed(1)} MB total); ${snapshots} snapshots sent`,
    });
  });

  test("late joiner gets the full text after compaction (test 12)", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    const control = await controlSocket(page);
    await openPad(page, pad.url);
    // Compaction starts once the rows after the oldest one hold over 1 MB: three 600 KB pastes.
    const part = asciiText(600 * 1024);
    await page.locator(".cm-content").click();
    for (let i = 0; i < 3; i += 1) {
      await focusEditorEnd(page);
      await paste(page, part);
      await expectText(page, part.repeat(i + 1));
    }
    await expect.poll(() => control.received.includes(4), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => control.sent.includes(SNAPSHOT_FRAME), { timeout: 30_000 }).toBe(true);
    await focusEditorEnd(page);
    await page.keyboard.type("after compaction");
    const expected = part.repeat(3) + "after compaction";
    await expectText(page, expected);
    const late = await newClient(browser, consoleGuard);
    await openPad(late, pad.url);
    await expectText(late, expected, 60_000);
  });

  test("five clients random-edit for 30 s and converge (test 11)", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    const clients = [page];
    for (let i = 0; i < 4; i += 1) {
      const client = await newClient(browser, consoleGuard);
      await openPad(client, pad.url);
      clients.push(client);
    }
    const alphabet = "abcdefghijklmnopqrstuvwxyz \n";
    const end = Date.now() + 30_000;
    await Promise.all(
      clients.map(async (client, index) => {
        await client.locator(".cm-content").click();
        while (Date.now() < end) {
          const roll = Math.random();
          if (roll < 0.15) {
            await client.keyboard.press("Backspace");
          } else if (roll < 0.25) {
            await client.keyboard.press(
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"][
                Math.floor(Math.random() * 6)
              ] ?? "End",
            );
          } else {
            const char = alphabet[Math.floor(Math.random() * alphabet.length)] ?? "x";
            await client.keyboard.type(index === 0 ? char.toUpperCase() : char);
          }
        }
      }),
    );
    const text = await converged(clients, 30_000);
    expect(text.length).toBeGreaterThan(50);
  });

  test("the 51st person gets the pad-full screen; the pad keeps working", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    await openPad(page, pad.url);
    // 49 more connections from one page: same origin, real browser WebSockets.
    const opened = await page.evaluate(async (padId) => {
      const sockets = Array.from(
        { length: 49 },
        () => new WebSocket(`ws://${location.host}/ws/${padId}`),
      );
      Object.assign(window, { extraSockets: sockets });
      await Promise.all(
        sockets.map(
          (socket) =>
            new Promise((resolve) => {
              socket.addEventListener("open", resolve, { once: true });
              socket.addEventListener("close", resolve, { once: true });
            }),
        ),
      );
      return sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length;
    }, pad.padId);
    expect(opened).toBe(49);

    const fiftyFirst = await newClient(browser, consoleGuard);
    await fiftyFirst.goto(pad.url);
    await expectScreen(fiftyFirst, "This pad is full");

    await page.evaluate(() => {
      for (const socket of (window as unknown as { extraSockets: WebSocket[] }).extraSockets) {
        socket.close(1000);
      }
    });
    await focusEditorEnd(page);
    await page.keyboard.type("room again");
    const later = await newClient(browser, consoleGuard);
    await openPad(later, pad.url);
    await expectText(later, "room again");
  });

  test("ten clients dropped at the same moment all reconnect and converge", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    const clients: Page[] = [];
    const controls = [];
    for (let i = 0; i < 10; i += 1) {
      const client = i === 0 ? page : await newClient(browser, consoleGuard);
      controls.push(await controlSocket(client));
      await openPad(client, pad.url);
      clients.push(client);
    }
    await focusEditorEnd(page);
    await page.keyboard.type("start");
    await converged(clients, 20_000);

    await Promise.all(controls.map((control) => control.drop()));
    await Promise.all(clients.map((client) => expect(client.locator(".banner")).toBeVisible()));
    await Promise.all(
      clients.map(async (client, index) => {
        await focusEditorEnd(client);
        await client.keyboard.type(` c${index}`);
      }),
    );
    for (const control of controls) {
      control.reconnect();
    }
    await Promise.all(clients.map((client) => waitOnline(client)));
    const text = await converged(clients, 30_000);
    for (let index = 0; index < 10; index += 1) {
      expect(text).toContain(` c${index}`);
    }
    expect(text.startsWith("start")).toBe(true);
  });
});
