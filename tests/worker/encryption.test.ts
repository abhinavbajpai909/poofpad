import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Purpose, decrypt, encrypt, generateKeyText, importKey } from "../../src/client/crypto";
import { FrameType, decodeFrame, decodeSyncAll, encodeFrame } from "../../src/shared/protocol";

const origin = "https://poofpad.test";
const MARKER = "PoofPad-plaintext-marker-7f3a9c";

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.byteLength <= haystack.byteLength; i += 1) {
    for (let j = 0; j < needle.byteLength; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

function storedValueBytes(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new TextEncoder().encode(String(value));
}

async function createPad(): Promise<string> {
  const response = await exports.default.fetch(
    new Request(`${origin}/api/pads`, { method: "POST", body: JSON.stringify({ ttl: 3600 }) }),
  );
  expect(response.status).toBe(201);
  const { padId } = await response.json<{ padId: string }>();
  return padId;
}

async function openSocket(padId: string): Promise<{ socket: WebSocket; frames: Uint8Array[] }> {
  const response = await exports.default.fetch(
    new Request(`${origin}/ws/${padId}`, { headers: { Upgrade: "websocket" } }),
  );
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("no websocket");
  }
  socket.binaryType = "arraybuffer";
  const frames: Uint8Array[] = [];
  socket.addEventListener("message", (event) => {
    if (event.data instanceof ArrayBuffer) {
      frames.push(new Uint8Array(event.data));
    }
  });
  socket.accept();
  return { socket, frames };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
}

describe("stored data is encrypted", () => {
  it("contains no plaintext in storage or relayed frames", async () => {
    const key = await importKey(generateKeyText());
    if (key === null) {
      throw new Error("key did not import");
    }
    const marker = new TextEncoder().encode(MARKER);
    const padId = await createPad();

    const writer = await openSocket(padId);
    const reader = await openSocket(padId);

    const doc = new Y.Doc();
    doc.getText("text").insert(0, `${MARKER} ${MARKER}`);
    const update = Y.encodeStateAsUpdate(doc);
    expect(containsBytes(update, marker)).toBe(true);

    writer.socket.send(encodeFrame(FrameType.Update, await encrypt(key, Purpose.Doc, update)));
    writer.socket.send(
      encodeFrame(FrameType.Awareness, await encrypt(key, Purpose.Awareness, marker)),
    );
    await waitFor(() =>
      reader.frames.some(
        (frame) => decodeFrame(frame.slice().buffer, Infinity)?.type === FrameType.Awareness,
      ),
    );

    for (const frame of reader.frames) {
      expect(containsBytes(frame, marker)).toBe(false);
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

    const late = await openSocket(padId);
    await waitFor(() => late.frames.length > 0);
    const syncAll = decodeFrame(late.frames[0]?.slice().buffer ?? new ArrayBuffer(0), Infinity);
    expect(syncAll?.type).toBe(FrameType.SyncAll);
    const rows = decodeSyncAll(syncAll?.payload ?? new Uint8Array()) ?? [];
    expect(rows).toHaveLength(1);
    const row = rows[0] ?? new Uint8Array();
    expect(containsBytes(row, marker)).toBe(false);
    expect(await decrypt(key, Purpose.Doc, row)).toEqual(update);

    writer.socket.close(1000);
    reader.socket.close(1000);
    late.socket.close(1000);
  });
});
