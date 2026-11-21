import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LOG_MAX_BYTES, createLocalLog } from "../../src/client/local-log";

const MAX = 100_000;

/** A client whose own updates are logged, as the provider does. */
function client() {
  const doc = new Y.Doc();
  const log = createLocalLog();
  doc.on("update", (update: Uint8Array) => log.add(update));
  return { doc, log, text: doc.getText("text") };
}

/** A random-looking string, so Yjs's update stays about as big as the text. */
function filler(length: number, seed: number): string {
  let out = "";
  let value = seed;
  while (out.length < length) {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    out += String.fromCharCode(97 + (value % 26));
  }
  return out;
}

describe("local log", () => {
  it("resends an update lost in flight together with an offline edit, in frames that each fit", () => {
    const { doc, log, text } = client();
    text.insert(0, "base");
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));

    text.insert(4, filler(MAX * 0.8, 1)); // sent, but lost in flight: the server never got it
    text.insert(0, filler(MAX * 0.8, 2)); // typed offline
    const diff = Y.encodeStateAsUpdate(doc, Y.encodeStateVector(server));
    expect(diff.byteLength).toBeGreaterThan(MAX);

    const frames = log.missingFrom(server, MAX);
    expect(frames).not.toBeNull();
    expect(frames?.length).toBe(2);
    for (const frame of frames ?? []) {
      expect(frame.byteLength).toBeLessThanOrEqual(MAX);
      Y.applyUpdate(server, frame);
    }
    expect(server.getText("text").toString()).toBe(text.toString());
    expect(Y.equalSnapshots(Y.snapshot(server), Y.snapshot(doc))).toBe(true);
  });

  it("includes deletions the server lacks", () => {
    const { doc, log, text } = client();
    text.insert(0, "hello world");
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    text.delete(0, 6);
    for (const frame of log.missingFrom(server, MAX) ?? []) {
      Y.applyUpdate(server, frame);
    }
    expect(server.getText("text").toString()).toBe("world");
  });

  it("does not resend what the server already has", () => {
    const { doc, log, text } = client();
    text.insert(0, filler(MAX * 0.5, 3));
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    expect(log.missingFrom(server, MAX)).toEqual([]);
    text.insert(0, filler(MAX * 0.5, 4));
    expect(log.missingFrom(server, MAX)?.length).toBe(1);
  });

  it("packs several small entries into one frame and keeps every update separate when they are large", () => {
    const { doc, log, text } = client();
    const server = new Y.Doc();
    for (let i = 0; i < 20; i += 1) {
      text.insert(0, filler(40_000, i + 10));
    }
    const frames = log.missingFrom(server, MAX) ?? [];
    expect(frames.length).toBeGreaterThanOrEqual(8);
    for (const frame of frames) {
      expect(frame.byteLength).toBeLessThanOrEqual(MAX);
      Y.applyUpdate(server, frame);
    }
    expect(server.getText("text").toString()).toBe(doc.getText("text").toString());
  });

  it("merges tiny neighbouring updates (typing) into few entries, costing about 10 bytes a keystroke", () => {
    const { log, text } = client();
    for (let i = 0; i < 2000; i += 1) {
      text.insert(text.length, "x");
    }
    const frames = log.missingFrom(new Y.Doc(), MAX) ?? [];
    expect(frames.length).toBe(1);
    expect(frames[0]?.byteLength).toBeLessThan(2000 * 12);
  });

  it("prune forgets what the server has, and keeps what it lacks", () => {
    const { doc, log, text } = client();
    text.insert(0, "one");
    const server = new Y.Doc();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    text.insert(3, filler(MAX * 0.5, 5));
    log.prune(server);
    expect(log.missingFrom(server, MAX)?.length).toBe(1);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    log.prune(server);
    expect(log.missingFrom(server, MAX)).toEqual([]);
  });

  it("returns null once old entries were dropped, until the server is known to have everything", () => {
    const { doc, log, text } = client();
    const server = new Y.Doc();
    const piece = 500_000;
    const count = Math.ceil(LOG_MAX_BYTES / piece) + 2;
    for (let i = 0; i < count; i += 1) {
      text.insert(0, filler(piece, i + 100));
    }
    expect(log.missingFrom(server, 1024 * 1024)).toBeNull();
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
    log.clear();
    text.insert(0, "x");
    expect(log.missingFrom(server, 1024 * 1024)?.length).toBe(1);
  });
});
