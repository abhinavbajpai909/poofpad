import * as Y from "yjs";
import { FrameType, encodeFrame, encodeSnapshot } from "../shared/protocol";
import { Purpose, encrypt } from "./crypto";

/**
 * The answer to `COMPACT_REQUEST(upToSeq)`: the whole document, encrypted like every other document payload.
 * The state is captured before the first `await`, so it already contains every row up to `upToSeq`.
 */
export async function encodeSnapshotFrame(
  key: CryptoKey,
  doc: Y.Doc,
  upToSeq: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const data = await encrypt(key, Purpose.Doc, Y.encodeStateAsUpdate(doc));
  return encodeFrame(FrameType.Snapshot, encodeSnapshot({ upToSeq, data }));
}
