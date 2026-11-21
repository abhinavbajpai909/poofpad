import { Compartment, EditorState, Prec } from "@codemirror/state";
import { highlightSpecialChars, keymap } from "@codemirror/view";
import { EditorView, basicSetup } from "codemirror";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { type EditLimit, editLimitFilter, limitUndoManager } from "./edit-limit";
import { darkTheme, highlighting, lightTheme } from "./editor-theme";
import { type LanguageId, loadLanguage } from "./languages";
import { type Theme } from "./theme";

/**
 * CodeMirror's default special characters minus U+000D (carriage return). With only "\n" as the line
 * separator, a "\r" from pasted Windows text stays in the document, so text round-trips exactly (CRLF
 * included); it is drawn as plain whitespace instead of a red placeholder. CodeMirror needs the g flag.
 */
const SPECIAL_CHARS_WITHOUT_CR =
  /[\u0000-\u0008\u000a-\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u2028\u2029\u202d\u202e\u2066\u2067\u2069\ufeff\ufff9-\ufffc]/gu;

export interface PadEditor {
  setLanguage(id: LanguageId): void;
  setTheme(theme: Theme): void;
  destroy(): void;
}

export function createEditor(
  parent: HTMLElement,
  text: Y.Text,
  awareness: Awareness,
  limit: EditLimit,
  initialTheme: Theme,
): PadEditor {
  const undoManager = new Y.UndoManager(text);
  limitUndoManager(undoManager, limit);
  const language = new Compartment();
  const theme = new Compartment();
  const view = new EditorView({
    parent,
    doc: text.toString(),
    extensions: [
      basicSetup,
      // Every client splits lines on "\n" only, so the CodeMirror text always equals the shared Y.Text.
      EditorState.lineSeparator.of("\n"),
      highlightSpecialChars({ specialChars: SPECIAL_CHARS_WITHOUT_CR }),
      EditorView.lineWrapping,
      highlighting,
      theme.of(initialTheme === "dark" ? darkTheme : lightTheme),
      language.of([]),
      // Ahead of basicSetup's history, so undo/redo (keys and beforeinput) use the Yjs undo manager,
      // which only reverts this client's own edits.
      Prec.high([yCollab(text, awareness, { undoManager }), keymap.of(yUndoManagerKeymap)]),
      editLimitFilter(limit),
    ],
  });

  let destroyed = false;
  let requested = 0;

  return {
    setLanguage(id) {
      requested += 1;
      const mine = requested;
      void loadLanguage(id).then(
        (extension) => {
          // A newer choice (or teardown) may have arrived while the package was downloading.
          if (!destroyed && mine === requested) {
            view.dispatch({ effects: language.reconfigure(extension) });
          }
        },
        () => undefined,
      );
    },
    setTheme(next) {
      view.dispatch({ effects: theme.reconfigure(next === "dark" ? darkTheme : lightTheme) });
    },
    destroy() {
      destroyed = true;
      view.destroy();
    },
  };
}
