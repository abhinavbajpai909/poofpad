import type { Page } from "@playwright/test";
import {
  asciiText,
  createPad,
  docText,
  edit,
  expect,
  expectText,
  focusEditorEnd,
  newClient,
  openPad,
  test,
} from "./helpers";
import { controlSocket } from "./network";

const COMPACT_REQUEST_FRAME = 4;
const SYNC_ALL_FRAME = 3;
const SNAPSHOT_FRAME = 5;

/**
 * Inserts `text` right after the first occurrence of `anchor`, finding and inserting in one step inside
 * the page, so a remote change arriving in between can't shift the position.
 */
async function insertAfter(page: Page, anchor: string, text: string): Promise<void> {
  const found = await page.evaluate(
    ({ find, insert }) => {
      const content = document.querySelector(".cm-content") as
        | (Element & {
            cmTile?: {
              view?: {
                state: { doc: { toString(): string } };
                dispatch(spec: unknown): void;
              };
            };
          })
        | null;
      const view = content?.cmTile?.view;
      const at = view?.state.doc.toString().indexOf(find) ?? -1;
      if (view === undefined || at < 0) {
        return false;
      }
      const from = at + find.length;
      view.dispatch({ changes: { from, to: from, insert }, userEvent: "input.type" });
      return true;
    },
    { find: anchor, insert: text },
  );
  expect(found, `"${anchor}" in the text`).toBe(true);
}

test.describe("compaction", () => {
  test("a client connected through compaction and a client joining after it edit next to old text and converge", async ({
    page,
    browser,
    consoleGuard,
  }) => {
    const pad = await createPad(page);
    const control = await controlSocket(page);
    await openPad(page, pad.url);
    await focusEditorEnd(page);
    await page.keyboard.type("alpha gamma");

    // Compaction starts once the rows after the oldest one hold over 1 MB. Each big paste is deleted
    // again, so the snapshot holds garbage-collected runs right next to the old text.
    const big = asciiText(600 * 1024);
    for (let i = 0; i < 2; i += 1) {
      await edit(page, { from: 5, to: 5, insert: big });
      await edit(page, { from: 5, to: 5 + big.length, insert: "" });
      await page.keyboard.type(` d${i}`);
    }
    await expect
      .poll(() => control.received.includes(COMPACT_REQUEST_FRAME), { timeout: 30_000 })
      .toBe(true);
    await expect.poll(() => control.sent.includes(SNAPSHOT_FRAME), { timeout: 30_000 }).toBe(true);
    // Still typing, still connected, after the snapshot.
    await focusEditorEnd(page);
    await page.keyboard.type(" epsilon");
    const beforeJoin = "alpha gamma d0 d1 epsilon";
    await expectText(page, beforeJoin);

    const late = await newClient(browser, consoleGuard);
    const lateControl = await controlSocket(late);
    await openPad(late, pad.url);
    await expectText(late, beforeJoin);
    // The server really replaced the rows: without compaction, the joiner would download both deleted
    // 600 KB pastes again.
    const syncAll = lateControl.receivedBytes[lateControl.received.indexOf(SYNC_ALL_FRAME)];
    expect(syncAll).toBeLessThan(64 * 1024);

    // Both edit at once at the same spots: where the deleted pastes were, both ends, inside a word.
    await Promise.all([
      (async () => {
        await insertAfter(page, "alpha", "[A]");
        await edit(page, { from: 0, to: 0, insert: "[A0]" });
        await insertAfter(page, "gam", "[Am]");
        await focusEditorEnd(page);
        await page.keyboard.type("[Aend]");
      })(),
      (async () => {
        await insertAfter(late, "alpha", "[B]");
        await edit(late, { from: 0, to: 0, insert: "[B0]" });
        await insertAfter(late, "gam", "[Bm]");
        await focusEditorEnd(late);
        await late.keyboard.type("[Bend]");
      })(),
    ]);
    await expect.poll(async () => (await docText(page)) === (await docText(late))).toBe(true);
    const final = await docText(page);
    for (const mark of ["[A]", "[B]", "[A0]", "[B0]", "[Am]", "[Bm]", "[Aend]", "[Bend]"]) {
      expect(final).toContain(mark);
    }
    expect(final.replace(/\[[AB](0|m|end)?\]/g, "")).toBe(beforeJoin);

    // A third client loads the same text from storage.
    const third = await newClient(browser, consoleGuard);
    await openPad(third, pad.url);
    await expectText(third, final);
  });
});
