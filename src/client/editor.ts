import { EditorView, basicSetup } from "codemirror";
import { yCollab } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

export function createEditor(parent: HTMLElement, text: Y.Text, awareness: Awareness): EditorView {
  return new EditorView({
    parent,
    doc: text.toString(),
    extensions: [basicSetup, yCollab(text, awareness, { undoManager: new Y.UndoManager(text) })],
  });
}
