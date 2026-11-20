import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Purpose, decrypt, encrypt, generateKeyText, importKey } from "../../src/client/crypto";
import { encodeSnapshotFrame } from "../../src/client/snapshot";
import { CloseCode } from "../../src/shared/codes";
import { MAX_FRAME_BYTES } from "../../src/shared/limits";
import {
  FrameType,
  decodeCompactRequest,
  decodeSyncAll,
  encodeFrame,
  encodeSnapshot,
} from "../../src/shared/protocol";
import {
  type TestSocket,
  bytes,
  containsBytes,
  createPad,
  expectFrame,
  nextOfType,
  open,
  storedRows,
} from "./helpers";

const BIG = 600 * 1024;

async function sendUpdate(from: TestSocket, to: TestSocket, payload: Uint8Array): Promise<void> {
  from.socket.send(encodeFrame(FrameType.Update, payload));
  expect(await nextOfType(to, FrameType.Update)).toEqual(payload);
}

function sendSnapshot(client: TestSocket, upToSeq: number, data: Uint8Array<ArrayBuffer>): void {
  client.socket.send(encodeFrame(FrameType.Snapshot, encodeSnapshot({ upToSeq, data })));
}

/** A round trip through the DO, so every frame sent before it has been handled. */
async function settle(client: TestSocket, peer: TestSocket): Promise<void> {
  await sendUpdate(client, peer, new Uint8Array([0xee]));
}

function allowCompactRequestNow(padId: string): Promise<void> {
  return runInDurableObject(env.PAD.getByName(padId), (instance) => {
    (instance as unknown as { lastCompactRequestAt: number }).lastCompactRequestAt = 0;
  });
}

async function twoClients(): Promise<{ padId: string; a: TestSocket; b: TestSocket }> {
  const { padId } = await createPad();
  const a = await open(padId);
  const b = await open(padId);
  await nextOfType(b, FrameType.SyncAll);
  return { padId, a, b };
}

describe("compaction (test 7)", () => {
  it("replaces rows up to upToSeq and keeps rows that arrived meanwhile", async () => {
    const { padId, a, b } = await twoClients();
    await sendUpdate(a, b, bytes(10, 1));
    await sendUpdate(a, b, bytes(BIG, 2));
    expect(a.frames.some((frame) => frame.type === FrameType.CompactRequest)).toBe(false);
    await sendUpdate(a, b, bytes(BIG, 3));
    expect(decodeCompactRequest(await nextOfType(a, FrameType.CompactRequest))).toBe(3);

    const meanwhile = bytes(20, 4);
    await sendUpdate(b, a, meanwhile);
    expect(b.frames.some((frame) => frame.type === FrameType.CompactRequest)).toBe(false);

    const snapshot = bytes(50, 5);
    sendSnapshot(a, 3, snapshot);
    await settle(a, b);
    expect(await storedRows(padId)).toEqual([
      { seq: 3, data: snapshot },
      { seq: 4, data: meanwhile },
      { seq: 5, data: new Uint8Array([0xee]) },
    ]);

    const late = await open(padId);
    expect(decodeSyncAll(await expectFrame(late, FrameType.SyncAll))).toEqual([
      snapshot,
      meanwhile,
      new Uint8Array([0xee]),
    ]);
  });

  it("ignores duplicate, unsolicited and stale snapshots", async () => {
    const { padId, a, b } = await twoClients();
    await sendUpdate(a, b, bytes(10, 1));
    await sendUpdate(a, b, bytes(BIG, 2));
    await sendUpdate(a, b, bytes(BIG, 3));
    expect(decodeCompactRequest(await nextOfType(a, FrameType.CompactRequest))).toBe(3);

    await allowCompactRequestNow(padId);
    await sendUpdate(b, a, bytes(BIG, 4));
    expect(decodeCompactRequest(await nextOfType(b, FrameType.CompactRequest))).toBe(4);

    const fromB = bytes(40, 7);
    sendSnapshot(b, 4, fromB);
    await settle(b, a);
    const afterB = await storedRows(padId);
    expect(afterB.map((row) => row.seq)).toEqual([4, 5]);

    sendSnapshot(a, 3, bytes(40, 8));
    sendSnapshot(b, 4, bytes(40, 9));
    sendSnapshot(a, 5, bytes(40, 10));
    await settle(a, b);
    const rows = await storedRows(padId);
    expect(rows.slice(0, 2)).toEqual(afterB);
    expect(rows[0]?.data).toEqual(fromB);
  });

  it("closes the socket on a malformed snapshot", async () => {
    const { a } = await twoClients();
    a.socket.send(encodeFrame(FrameType.Snapshot, new Uint8Array([0, 0, 0, 1])));
    expect(await a.closed).toBe(CloseCode.UnsupportedData);
  });

  it("compacts real encrypted Yjs updates into an encrypted snapshot larger than one frame", async () => {
    const imported = await importKey(generateKeyText());
    if (imported === null) {
      throw new Error("key did not import");
    }
    const key: CryptoKey = imported;
    const { padId, a, b } = await twoClients();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const marker = "compaction-marker-91c2";

    async function edit(
      doc: Y.Doc,
      peerDoc: Y.Doc,
      from: TestSocket,
      to: TestSocket,
      text: string,
    ) {
      const before = Y.encodeStateVector(doc);
      const ytext = doc.getText("text");
      ytext.insert(ytext.length, text);
      const update = Y.encodeStateAsUpdate(doc, before);
      await sendUpdate(from, to, await encrypt(key, Purpose.Doc, update));
      Y.applyUpdate(peerDoc, update);
    }

    await edit(docA, docB, a, b, `${marker} start `);
    await edit(docA, docB, a, b, "a".repeat(BIG));
    await edit(docA, docB, a, b, "c".repeat(BIG));
    const upToSeq = decodeCompactRequest(await nextOfType(a, FrameType.CompactRequest));
    expect(upToSeq).toBe(3);

    await edit(docB, docA, b, a, " meanwhile");
    const snapshotFrame = await encodeSnapshotFrame(key, docA, upToSeq ?? 0);
    expect(snapshotFrame.byteLength).toBeGreaterThan(MAX_FRAME_BYTES);
    a.socket.send(snapshotFrame);
    await settle(a, b);

    const rows = await storedRows(padId);
    expect(rows.map((row) => row.seq)).toEqual([3, 4, 5]);
    expect(containsBytes(rows[0]?.data ?? new Uint8Array(), new TextEncoder().encode(marker))).toBe(
      false,
    );

    const late = await open(padId);
    const synced = decodeSyncAll(await expectFrame(late, FrameType.SyncAll)) ?? [];
    expect(synced).toHaveLength(3);
    const lateDoc = new Y.Doc();
    const first = await decrypt(key, Purpose.Doc, synced[0] ?? new Uint8Array());
    expect(first).not.toBeNull();
    for (const row of synced) {
      const plain = await decrypt(key, Purpose.Doc, row);
      if (plain !== null) {
        Y.applyUpdate(lateDoc, plain);
      }
    }
    const expected = `${marker} start ${"a".repeat(BIG)}${"c".repeat(BIG)} meanwhile`;
    expect(docA.getText("text").toString()).toBe(expected);
    expect(lateDoc.getText("text").toString()).toBe(expected);
  });
});
