import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CloseCode } from "../../src/shared/codes";
import { FrameType, decodeInfo, decodeSyncAll, encodeFrame } from "../../src/shared/protocol";
import { type TestSocket, createPad, expectFrame, open, origin } from "./helpers";

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
