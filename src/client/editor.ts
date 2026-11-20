import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { EditorView, basicSetup } from "codemirror";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { type EditLimit, editLimitFilter, limitUndoManager } from "./edit-limit";

export function createEditor(
  parent: HTMLElement,
  text: Y.Text,
  awareness: Awareness,
  limit: EditLimit,
): EditorView {
  const undoManager = new Y.UndoManager(text);
  limitUndoManager(undoManager, limit);
  return new EditorView({
    parent,
    doc: text.toString(),
    extensions: [
      basicSetup,
      // Ahead of basicSetup's history, so undo/redo (keys and beforeinput) use the Yjs undo manager,
      // which only reverts this client's own edits.
      Prec.high([yCollab(text, awareness, { undoManager }), keymap.of(yUndoManagerKeymap)]),
      editLimitFilter(limit),
    ],
  });
}
