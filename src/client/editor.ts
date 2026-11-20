import { Compartment, Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { EditorView, basicSetup } from "codemirror";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { type EditLimit, editLimitFilter, limitUndoManager } from "./edit-limit";
import { darkTheme, highlighting, lightTheme } from "./editor-theme";
import { type LanguageId, loadLanguage } from "./languages";
import { type Theme } from "./theme";

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
