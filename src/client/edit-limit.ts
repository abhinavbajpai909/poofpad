import { EditorState, type Extension, type Transaction } from "@codemirror/state";
import { ySyncAnnotation } from "y-codemirror.next";
import * as Y from "yjs";
import { MAX_FRAME_BYTES } from "../shared/limits";
import { IV_BYTES, TAG_BYTES } from "./crypto";

/** Slack for the difference between our estimate and Yjs's real encoding. */
const SAFETY_MARGIN_BYTES = 4096;

/** Largest Yjs update that still fits one `UPDATE` frame after the type byte, IV and GCM tag. */
export const MAX_UPDATE_BYTES = MAX_FRAME_BYTES - 1 - IV_BYTES - TAG_BYTES - SAFETY_MARGIN_BYTES;

/** Upper bounds for Yjs's per-update header and per-inserted-run item header (ids, origins, lengths). */
const UPDATE_OVERHEAD_BYTES = 64;
const RUN_OVERHEAD_BYTES = 48;

type StackItem = Y.UndoManager["undoStack"][number];

export interface EditLimit {
  /** How many bytes of Yjs update the next local change may produce. */
  budget(): number;
  onBlocked(): void;
}

export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Upper bound on the size of the Yjs update a CodeMirror transaction turns into. */
export function estimateChangeBytes(tr: Transaction): number {
  let bytes = UPDATE_OVERHEAD_BYTES;
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    bytes += RUN_OVERHEAD_BYTES;
    const lines = inserted.iter();
    while (!lines.next().done) {
      bytes += utf8Length(lines.value);
    }
  });
  return bytes;
}

/**
 * Blocks local edits whose update would not fit in one frame, before they reach the Y.Doc, so this
 * client never holds text the others can't receive. Changes coming from the Y.Doc are never blocked.
 */
export function editLimitFilter(limit: EditLimit): Extension {
  return EditorState.changeFilter.of((tr) => {
    if (tr.annotation(ySyncAnnotation) !== undefined || estimateChangeBytes(tr) <= limit.budget()) {
      return true;
    }
    limit.onBlocked();
    return false;
  });
}

/** Upper bound on the size of the update produced by undoing (or redoing) `item`: the text it restores. */
export function estimateRestoreBytes(doc: Y.Doc, item: StackItem): number {
  let bytes = UPDATE_OVERHEAD_BYTES;
  doc.transact((tr) => {
    Y.iterateDeletedStructs(tr, item.deletions, (struct) => {
      bytes += RUN_OVERHEAD_BYTES;
      if (struct instanceof Y.Item && struct.content instanceof Y.ContentString) {
        bytes += utf8Length(struct.content.str);
      }
    });
  });
  return bytes;
}

/**
 * Undo/redo bypass CodeMirror's filters (the Yjs undo manager edits the Y.Doc directly), so the same
 * limit is applied to them here. A blocked step stays on its stack.
 */
export function limitUndoManager(manager: Y.UndoManager, limit: EditLimit): void {
  const undo = manager.undo.bind(manager);
  const redo = manager.redo.bind(manager);
  const allowed = (stack: readonly StackItem[]): boolean => {
    const item = stack.at(-1);
    if (item === undefined || estimateRestoreBytes(manager.doc, item) <= limit.budget()) {
      return true;
    }
    limit.onBlocked();
    return false;
  };
  manager.undo = () => (allowed(manager.undoStack) ? undo() : null);
  manager.redo = () => (allowed(manager.redoStack) ? redo() : null);
}
