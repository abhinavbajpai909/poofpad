import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CloseCode } from "../../src/shared/codes";
import {
  type Frame,
  FrameType,
  decodeFrame,
  decodeInfo,
  decodeSyncAll,
  encodeFrame,
} from "../../src/shared/protocol";

const origin = "https://poofpad.test";

interface TestSocket {
  socket: WebSocket;
  next(): Promise<Frame>;
  closed: Promise<number>;
}

async function createPad(): Promise<{ padId: string; expiresAt: number }> {
  const response = await exports.default.fetch(
    new Request(`${origin}/api/pads`, { method: "POST", body: JSON.stringify({ ttl: 3600 }) }),
  );
  expect(response.status).toBe(201);
  return response.json();
}

async function open(padId: string): Promise<TestSocket> {
  const response = await exports.default.fetch(
    new Request(`${origin}/ws/${padId}`, { headers: { Upgrade: "websocket" } }),
  );
  const socket = response.webSocket;
  if (socket === null) {
    throw new Error("no websocket");
  }
  socket.binaryType = "arraybuffer";
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
    closed,
    next: () => {
      const frame = queue.shift();
      return frame ? Promise.resolve(frame) : new Promise((resolve) => waiters.push(resolve));
    },
  };
}

async function expectFrame(client: TestSocket, type: FrameType): Promise<Uint8Array> {
  const frame = await client.next();
  expect(frame.type).toBe(type);
  return frame.payload;
}

async function expectPeers(client: TestSocket, peers: number): Promise<void> {
  expect(decodeInfo(await expectFrame(client, FrameType.Info))?.peers).toBe(peers);
}

describe("pad sync", () => {
  it("relays and stores updates, and sends them to late joiners via SYNC_ALL", async () => {
    const { padId, expiresAt } = await createPad();

    const a = await open(padId);
    expect(decodeSyncAll(await expectFrame(a, FrameType.SyncAll))).toEqual([]);
    const firstInfo = decodeInfo(await expectFrame(a, FrameType.Info));
    expect(firstInfo).toEqual({ peers: 1, expiresAt });

    const b = await open(padId);
    expect(decodeSyncAll(await expectFrame(b, FrameType.SyncAll))).toEqual([]);
    await expectPeers(a, 2);
    await expectPeers(b, 2);

    const update1 = new Uint8Array([1, 2, 3]);
    const update2 = new Uint8Array([4, 5]);
    a.socket.send(encodeFrame(FrameType.Update, update1));
    expect(await expectFrame(b, FrameType.Update)).toEqual(update1);
    b.socket.send(encodeFrame(FrameType.Update, update2));
    expect(await expectFrame(a, FrameType.Update)).toEqual(update2);

    const awareness = new Uint8Array([9]);
    a.socket.send(encodeFrame(FrameType.Awareness, awareness));
    expect(await expectFrame(b, FrameType.Awareness)).toEqual(awareness);

    const c = await open(padId);
    expect(decodeSyncAll(await expectFrame(c, FrameType.SyncAll))).toEqual([update1, update2]);
    await expectPeers(c, 3);
    await expectPeers(a, 3);
    await expectPeers(b, 3);

    c.socket.close(1000);
    await expectPeers(a, 2);
    await expectPeers(b, 2);

    a.socket.close(1000);
    b.socket.close(1000);
  });

  it("does not store awareness frames", async () => {
    const { padId } = await createPad();
    const a = await open(padId);
    await expectFrame(a, FrameType.SyncAll);
    await expectFrame(a, FrameType.Info);
    const b = await open(padId);
    await expectFrame(b, FrameType.SyncAll);
    await expectPeers(b, 2);

    a.socket.send(encodeFrame(FrameType.Awareness, new Uint8Array([7])));
    a.socket.send(encodeFrame(FrameType.Update, new Uint8Array([8])));
    await expectFrame(b, FrameType.Awareness);
    await expectFrame(b, FrameType.Update);

    const c = await open(padId);
    expect(decodeSyncAll(await expectFrame(c, FrameType.SyncAll))).toEqual([new Uint8Array([8])]);
    a.socket.close(1000);
    b.socket.close(1000);
    c.socket.close(1000);
  });

  it("closes an unknown pad with 4004", async () => {
    const client = await open("AAAAAAAAAAAAAAAAAAAAAA");
    expect(await client.closed).toBe(CloseCode.NotFound);
  });

  it.each([
    ["a text frame", "hello"],
    ["an unknown frame type", new Uint8Array([99, 1]).buffer],
    ["a server-only frame type", new Uint8Array([FrameType.SyncAll]).buffer],
  ])("closes the socket on %s", async (_name, message) => {
    const { padId } = await createPad();
    const client = await open(padId);
    await expectFrame(client, FrameType.SyncAll);
    client.socket.send(message);
    expect(await client.closed).toBe(CloseCode.UnsupportedData);
  });

  it("requires a WebSocket upgrade", async () => {
    const { padId } = await createPad();
    const response = await exports.default.fetch(new Request(`${origin}/ws/${padId}`));
    expect(response.status).toBe(426);
    await response.body?.cancel();
  });
});
