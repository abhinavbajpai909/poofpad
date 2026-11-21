import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { compactState } from "../../src/client/snapshot";

const BIG = "x".repeat(200_000);

/** A document with an undo manager (as in the editor) in which BIG was pasted and deleted `times` times. */
function churnedDoc(times: number): { doc: Y.Doc; text: Y.Text; undo: Y.UndoManager } {
  const doc = new Y.Doc();
  const text = doc.getText("text");
  const undo = new Y.UndoManager(text, { captureTimeout: 0 });
  text.insert(0, "keep ");
  for (let i = 0; i < times; i += 1) {
    text.insert(text.length, BIG);
    text.delete(5, BIG.length);
  }
  return { doc, text, undo };
}

function captureUpdates(doc: Y.Doc, change: () => void): Uint8Array {
  const updates: Uint8Array[] = [];
  const record = (update: Uint8Array): void => {
    updates.push(update);
  };
  doc.on("update", record);
  change();
  doc.off("update", record);
  return Y.mergeUpdates(updates);
}

describe("compactState", () => {
  it("drops deleted text that the undo manager keeps in the live document", () => {
    const { doc } = churnedDoc(5);
    expect(Y.encodeStateAsUpdate(doc).byteLength).toBeGreaterThan(5 * BIG.length);
    const state = compactState(doc);
    expect(state.byteLength).toBeLessThan(1000);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, state);
    expect(restored.getText("text").toString()).toBe("keep ");
  });

  it("keeps the current text intact, including multi-byte characters", () => {
    const doc = new Y.Doc();
    doc.getText("text").insert(0, "héllo 👋 नमस्ते\r\nمرحبا");
    doc.getMap("meta").set("language", "python");
    const restored = new Y.Doc();
    Y.applyUpdate(restored, compactState(doc));
    expect(restored.getText("text").toString()).toBe("héllo 👋 नमस्ते\r\nمرحبا");
    expect(restored.getMap("meta").get("language")).toBe("python");
  });

  it("keeps the Yjs item ID of every character (no text is re-inserted as new items)", () => {
    const doc = new Y.Doc();
    const text = doc.getText("text");
    new Y.UndoManager(text, { captureTimeout: 0 });
    text.insert(0, "alpha gamma");
    text.insert(5, BIG);
    text.delete(5, BIG.length);
    text.insert(5, " beta");
    text.delete(0, 1);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, compactState(doc));
    const restoredText = restored.getText("text");
    expect(restoredText.toString()).toBe(text.toString());
    // A relative position names the item (client ID + clock) holding that character.
    for (let index = 0; index <= text.length; index += 1) {
      const original = Y.createRelativePositionFromTypeIndex(text, index);
      const copied = Y.createRelativePositionFromTypeIndex(restoredText, index);
      expect(copied.item, `character ${index}`).toEqual(original.item);
    }
    // The compacted state covers the same clock ranges, so nobody resends or re-creates items.
    expect(Y.encodeStateVector(restored)).toEqual(Y.encodeStateVector(doc));
  });

  it("converges when a full-history client and a snapshot joiner edit next to old and deleted text", () => {
    const a = new Y.Doc();
    const aText = a.getText("text");
    new Y.UndoManager(aText, { captureTimeout: 0 });
    aText.insert(0, "alpha gamma");
    aText.insert(5, BIG);
    aText.delete(5, BIG.length);

    const b = new Y.Doc();
    Y.applyUpdate(b, compactState(a));
    const bText = b.getText("text");
    expect(bText.toString()).toBe("alpha gamma");

    // Concurrent edits at the same spots: the boundary of the deleted (garbage-collected) run, both ends
    // of the text, and inside a word.
    const fromA = captureUpdates(a, () => {
      aText.insert(5, "[A5]");
      aText.insert(0, "[A0]");
      aText.insert(aText.length, "[Aend]");
      aText.insert(6, "[Amid]");
    });
    const fromB = captureUpdates(b, () => {
      bText.insert(5, "[B5]");
      bText.insert(0, "[B0]");
      bText.insert(bText.length, "[Bend]");
      bText.insert(6, "[Bmid]");
    });
    Y.applyUpdate(a, fromB);
    Y.applyUpdate(b, fromA);
    expect(aText.toString()).toBe(bText.toString());
    for (const mark of ["[A5]", "[B5]", "[A0]", "[B0]", "[Aend]", "[Bend]", "[Amid]", "[Bmid]"]) {
      expect(aText.toString()).toContain(mark);
    }

    // A third client from the full history agrees too.
    const c = new Y.Doc();
    Y.applyUpdate(c, Y.encodeStateAsUpdate(a));
    expect(c.getText("text").toString()).toBe(bText.toString());
  });

  it("merges with later updates, including an undo that restores deleted text", () => {
    const { doc, text, undo } = churnedDoc(2);
    const snapshot = compactState(doc);

    const later: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array) => later.push(update));
    undo.undo();
    expect(text.toString()).toBe("keep " + BIG);
    text.insert(0, ">");

    const joiner = new Y.Doc();
    Y.applyUpdate(joiner, Y.mergeUpdates([snapshot, ...later]));
    expect(joiner.getText("text").toString()).toBe(text.toString());

    // A peer that saw the full history converges with the joiner too.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(joiner));
    Y.applyUpdate(joiner, Y.encodeStateAsUpdate(peer));
    expect(peer.getText("text").toString()).toBe(joiner.getText("text").toString());
  });
});
