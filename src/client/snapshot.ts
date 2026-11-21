import * as Y from "yjs";
import { FrameType, encodeFrame, encodeSnapshot } from "../shared/protocol";
import { Purpose, encrypt } from "./crypto";

/**
 * The document's state without the content of deleted text. The live document can't drop it: the undo
 * manager keeps deleted items so they can be restored. Copying the state into a fresh document lets Yjs
 * garbage-collect them there, so a pad whose text was pasted and deleted many times compacts to the size
 * of its current text. Clients that still hold the deleted items merge with this state normally.
 */
export function compactState(doc: Y.Doc): Uint8Array {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  const state = Y.encodeStateAsUpdate(copy);
  copy.destroy();
  return state;
}

/**
 * The answer to `COMPACT_REQUEST(upToSeq)`: the whole document, encrypted like every other document payload.
 * The state is captured before the first `await`, so it already contains every row up to `upToSeq`.
 */
export async function encodeSnapshotFrame(
  key: CryptoKey,
  doc: Y.Doc,
  upToSeq: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const data = await encrypt(key, Purpose.Doc, compactState(doc));
  return encodeFrame(FrameType.Snapshot, encodeSnapshot({ upToSeq, data }));
}
