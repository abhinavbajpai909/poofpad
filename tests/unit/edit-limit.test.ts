import { EditorState } from "@codemirror/state";
import { YSyncConfig, ySyncAnnotation } from "y-codemirror.next";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  MAX_UPDATE_BYTES,
  editLimitFilter,
  estimateChangeBytes,
  limitUndoManager,
  utf8Length,
} from "../../src/client/edit-limit";
import { IV_BYTES, TAG_BYTES } from "../../src/client/crypto";
import { MAX_FRAME_BYTES } from "../../src/shared/limits";

function limited(budget = MAX_UPDATE_BYTES) {
  let blocked = 0;
  const limit = {
    budget: () => budget,
    onBlocked: () => {
      blocked += 1;
    },
  };
  return { limit, blockedCount: () => blocked };
}

describe("utf8Length", () => {
  it.each([
    "",
    "plain ascii",
    "é ß ñ",
    "हिन्दी देवनागरी",
    "العربية",
    "emoji 😀👩‍💻 zwj",
    "tabs\tand\r\nCRLF",
  ])("matches TextEncoder for %j", (text) => {
    expect(utf8Length(text)).toBe(new TextEncoder().encode(text).byteLength);
  });

  it("counts a lone surrogate as 3 bytes, like TextEncoder's replacement character", () => {
    expect(utf8Length("\ud800x")).toBe(new TextEncoder().encode("\ud800x").byteLength);
  });
});

describe("edit size limit in the editor", () => {
  it("leaves room in a frame for the type byte, IV and tag", () => {
    expect(MAX_UPDATE_BYTES + 1 + IV_BYTES + TAG_BYTES).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  });

  it("lets a 500 KB paste through", () => {
    const { limit, blockedCount } = limited();
    const state = EditorState.create({ extensions: [editLimitFilter(limit)] });
    const text = "x".repeat(500 * 1024);
    const next = state.update({ changes: { from: 0, insert: text } }).state;
    expect(next.doc.length).toBe(text.length);
    expect(blockedCount()).toBe(0);
  });

  it("blocks a 6 MB paste before it reaches the document and reports it", () => {
    const { limit, blockedCount } = limited();
    const state = EditorState.create({ doc: "keep", extensions: [editLimitFilter(limit)] });
    const next = state.update({ changes: { from: 4, insert: "y".repeat(6 * 1024 * 1024) } }).state;
    expect(next.doc.toString()).toBe("keep");
    expect(blockedCount()).toBe(1);
  });

  it("measures multi-byte text in UTF-8, not UTF-16 units", () => {
    const { limit, blockedCount } = limited();
    const state = EditorState.create({ extensions: [editLimitFilter(limit)] });
    const hindi = "ह".repeat(Math.ceil(MAX_UPDATE_BYTES / 3));
    const next = state.update({ changes: { from: 0, insert: hindi } }).state;
    expect(hindi.length).toBeLessThan(MAX_UPDATE_BYTES);
    expect(next.doc.length).toBe(0);
    expect(blockedCount()).toBe(1);
  });

  it("estimates at least the real Yjs update size", () => {
    const state = EditorState.create({ doc: "abc\ndef" });
    const tr = state.update({
      changes: [
        { from: 1, insert: "😀 one" },
        { from: 5, to: 6, insert: "two\nthree" },
      ],
    });
    const doc = new Y.Doc();
    const text = doc.getText("text");
    text.insert(0, "abc\ndef");
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
        if (toA > fromA) {
          text.delete(fromB, toA - fromA);
        }
        text.insert(fromB, inserted.toString());
      });
    });
    expect(text.toString()).toBe(tr.state.doc.toString());
    expect(estimateChangeBytes(tr)).toBeGreaterThanOrEqual(
      Y.encodeStateAsUpdate(doc, before).byteLength,
    );
  });

  it("never blocks changes that come from the Y.Doc", () => {
    const { limit, blockedCount } = limited(0);
    const state = EditorState.create({ extensions: [editLimitFilter(limit)] });
    const conf = new YSyncConfig(new Y.Doc().getText("text"), null);
    const next = state.update({
      changes: { from: 0, insert: "remote" },
      annotations: [ySyncAnnotation.of(conf)],
    }).state;
    expect(next.doc.toString()).toBe("remote");
    expect(blockedCount()).toBe(0);
  });

  it("uses the budget at the time of the change", () => {
    let budget = MAX_UPDATE_BYTES;
    const limit = { budget: () => budget, onBlocked: () => undefined };
    const state = EditorState.create({ extensions: [editLimitFilter(limit)] });
    budget = 150;
    expect(state.update({ changes: { from: 0, insert: "z".repeat(200) } }).state.doc.length).toBe(
      0,
    );
    expect(state.update({ changes: { from: 0, insert: "z" } }).state.doc.length).toBe(1);
  });
});

describe("edit size limit on undo/redo", () => {
  const CHUNK = 400 * 1024;

  function setup() {
    const doc = new Y.Doc();
    const text = doc.getText("text");
    const manager = new Y.UndoManager(text, { captureTimeout: 0 });
    const { limit, blockedCount } = limited();
    limitUndoManager(manager, limit);
    return { text, manager, blockedCount };
  }

  it("blocks an undo that would restore more than one frame of text", () => {
    const { text, manager, blockedCount } = setup();
    for (let i = 0; i < 3; i += 1) {
      text.insert(text.length, "q".repeat(CHUNK));
    }
    text.delete(0, text.length);
    expect(manager.undo()).toBeNull();
    expect(text.length).toBe(0);
    expect(blockedCount()).toBe(1);
    expect(manager.undoStack.length).toBe(4);
  });

  it("allows undo and redo within the limit", () => {
    const { text, manager, blockedCount } = setup();
    text.insert(0, "q".repeat(CHUNK));
    text.delete(0, CHUNK);
    expect(manager.undo()).not.toBeNull();
    expect(text.length).toBe(CHUNK);
    expect(manager.redo()).not.toBeNull();
    expect(text.length).toBe(0);
    expect(manager.undo()).not.toBeNull();
    expect(manager.undo()).not.toBeNull();
    expect(text.length).toBe(0);
    expect(blockedCount()).toBe(0);
  });

  it("blocks a redo that would restore more than one frame of text", () => {
    const { text, manager, blockedCount } = setup();
    text.insert(0, "q".repeat(3 * CHUNK));
    expect(manager.undo()).not.toBeNull();
    expect(text.length).toBe(0);
    expect(manager.redo()).toBeNull();
    expect(text.length).toBe(0);
    expect(blockedCount()).toBe(1);
    expect(manager.redoStack.length).toBe(1);
  });
});
