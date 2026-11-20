import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import { type Frame, decodeFrame } from "../../src/shared/protocol";

export const origin = "https://poofpad.test";

export interface CreatedPad {
  padId: string;
  adminToken: string;
  expiresAt: number;
}

export interface TestSocket {
  socket: WebSocket;
  /** Every frame received so far, in order. */
  frames: Frame[];
  next(): Promise<Frame>;
  closed: Promise<number>;
}

export function post(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(new Request(origin + path, { method: "POST", ...init }));
}

export async function createPad(ttl = 3600): Promise<CreatedPad> {
  const response = await post("/api/pads", { body: JSON.stringify({ ttl }) });
  expect(response.status).toBe(201);
  return response.json();
}

export async function open(
  padId: string,
  headers: Record<string, string> = { Origin: origin },
): Promise<TestSocket> {
  const response = await exports.default.fetch(
    new Request(`${origin}/ws/${padId}`, { headers: { Upgrade: "websocket", ...headers } }),
  );
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("no websocket");
  }
  socket.binaryType = "arraybuffer";
  const frames: Frame[] = [];
  const queue: Frame[] = [];
  const waiters: ((frame: Frame) => void)[] = [];
  let resolveClosed: (code: number) => void = () => undefined;
  const closed = new Promise<number>((resolve) => {
    resolveClosed = resolve;
  });
  socket.addEventListener("message", (event) => {
    if (!(event.data instanceof ArrayBuffer)) {
      throw new Error("expected binary frame");
    }
    const frame = decodeFrame(event.data, Number.POSITIVE_INFINITY);
    if (frame === null) {
      throw new Error("bad frame");
    }
    frames.push(frame);
    const waiter = waiters.shift();
    if (waiter) {
      waiter(frame);
    } else {
      queue.push(frame);
    }
  });
  socket.addEventListener("close", (event) => resolveClosed(event.code));
  socket.accept();
  return {
    socket,
    frames,
    closed,
    next: () => {
      const frame = queue.shift();
      return frame ? Promise.resolve(frame) : new Promise((resolve) => waiters.push(resolve));
    },
  };
}

export async function expectFrame(client: TestSocket, type: number): Promise<Uint8Array> {
  const frame = await client.next();
  expect(frame.type).toBe(type);
  return frame.payload;
}

/** Skips frames until one of `type` arrives. */
export async function nextOfType(client: TestSocket, type: number): Promise<Uint8Array> {
  for (;;) {
    const frame = await client.next();
    if (frame.type === type) {
      return frame.payload;
    }
  }
}

export async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !condition(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
}

export interface StoredRow {
  seq: number;
  data: Uint8Array;
}

export function storedRows(padId: string): Promise<StoredRow[]> {
  return runInDurableObject(env.PAD.getByName(padId), (_instance, state) =>
    state.storage.sql
      .exec<{ seq: number; data: ArrayBuffer }>("SELECT seq, data FROM updates ORDER BY seq")
      .toArray()
      .map((row) => ({ seq: row.seq, data: new Uint8Array(row.data) })),
  );
}

/** User tables in the pad's SQLite database (empty once the pad has been deleted). */
export function storedTables(padId: string): Promise<string[]> {
  return runInDurableObject(env.PAD.getByName(padId), (_instance, state) =>
    state.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((row) => row.name)
      .filter((name) => !name.startsWith("_cf_") && !name.startsWith("sqlite_")),
  );
}

export function bytes(length: number, fill = 1): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(fill);
}

export function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
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
