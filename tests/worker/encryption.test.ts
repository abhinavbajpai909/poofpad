import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Purpose, decrypt, encrypt, generateKeyText, importKey } from "../../src/client/crypto";
import { FrameType, decodeSyncAll, encodeFrame } from "../../src/shared/protocol";
import { containsBytes, createPad, expectFrame, open, waitFor } from "./helpers";

const MARKER = "PoofPad-plaintext-marker-7f3a9c";

function storedValueBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new TextEncoder().encode(String(value));
}

describe("stored data is encrypted", () => {
  it("contains no plaintext in storage or relayed frames", async () => {
    const key = await importKey(generateKeyText());
    if (key === null) {
      throw new Error("key did not import");
    }
    const marker = new TextEncoder().encode(MARKER);
    const { padId } = await createPad();

    const writer = await open(padId);
    const reader = await open(padId);

    const doc = new Y.Doc();
    doc.getText("text").insert(0, `${MARKER} ${MARKER}`);
    const update = Y.encodeStateAsUpdate(doc);
    expect(containsBytes(update, marker)).toBe(true);

    writer.socket.send(encodeFrame(FrameType.Update, await encrypt(key, Purpose.Doc, update)));
    writer.socket.send(
      encodeFrame(FrameType.Awareness, await encrypt(key, Purpose.Awareness, marker)),
    );
    await waitFor(() => reader.frames.some((frame) => frame.type === FrameType.Awareness));

    for (const frame of reader.frames) {
      expect(containsBytes(frame.payload, marker)).toBe(false);
    }

    const stored = await runInDurableObject(env.PAD.getByName(padId), (_instance, state) => {
      const tables = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
        .toArray()
        .map((row) => row.name)
        .filter((name) => !name.startsWith("_cf_") && !name.startsWith("sqlite_"));
      return tables.flatMap((table) =>
        state.storage.sql
          .exec(`SELECT * FROM "${table}"`)
          .toArray()
          .flatMap((row) => Object.values(row).map(storedValueBytes)),
      );
    });
    expect(stored.length).toBeGreaterThan(0);
    for (const value of stored) {
      expect(containsBytes(value, marker)).toBe(false);
    }

    const late = await open(padId);
    const rows = decodeSyncAll(await expectFrame(late, FrameType.SyncAll)) ?? [];
    expect(rows).toHaveLength(1);
    const row = rows[0] ?? new Uint8Array();
    expect(containsBytes(row, marker)).toBe(false);
    expect(await decrypt(key, Purpose.Doc, row)).toEqual(update);

    writer.socket.close(1000);
    reader.socket.close(1000);
    late.socket.close(1000);
  });
});
