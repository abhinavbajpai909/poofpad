import { describe, expect, it } from "vitest";
import { CloseCode } from "../../src/shared/codes";
import { MAX_FRAME_BYTES, MAX_SNAPSHOT_FRAME_BYTES } from "../../src/shared/limits";
import { FrameType, decodeError, decodeInfo, encodeFrame } from "../../src/shared/protocol";
import {
  type TestSocket,
  bytes,
  createPad,
  nextOfType,
  open,
  storedRows,
  waitFor,
} from "./helpers";

async function expectRejected(client: TestSocket, code: number): Promise<void> {
  expect(decodeError(await nextOfType(client, FrameType.Error))).toBe(code);
  expect(await client.closed).toBe(code);
}

/** The peer count in the newest INFO this client has received. */
function latestPeers(client: TestSocket): number | undefined {
  const info = client.frames.filter((frame) => frame.type === FrameType.Info).at(-1);
  return info === undefined ? undefined : decodeInfo(info.payload)?.peers;
}

describe("worker edge cases", () => {
  it("sends the server clock in INFO", async () => {
    const before = Date.now();
    const { padId, expiresAt } = await createPad();
    const client = await open(padId);
    const info = decodeInfo(await nextOfType(client, FrameType.Info));
    expect(info?.expiresAt).toBe(expiresAt);
    expect(info?.now).toBeGreaterThanOrEqual(before);
    expect(info?.now).toBeLessThanOrEqual(Date.now());
    client.socket.close(1000);
  });

  it("refuses an awareness frame over 1 MB with 4013 and relays one at the limit", async () => {
    const { padId } = await createPad();
    const sender = await open(padId);
    const receiver = await open(padId);
    await nextOfType(receiver, FrameType.SyncAll);

    sender.socket.send(encodeFrame(FrameType.Awareness, bytes(MAX_FRAME_BYTES - 1)));
    expect((await nextOfType(receiver, FrameType.Awareness)).byteLength).toBe(MAX_FRAME_BYTES - 1);
    sender.socket.send(encodeFrame(FrameType.Awareness, bytes(MAX_FRAME_BYTES)));
    await expectRejected(sender, CloseCode.TooLarge);
    expect(await storedRows(padId)).toEqual([]);
  });

  it("refuses a SNAPSHOT frame over 5 MB + 5 bytes with 4013", async () => {
    const { padId } = await createPad();
    const client = await open(padId);
    await nextOfType(client, FrameType.SyncAll);
    client.socket.send(new Uint8Array(MAX_SNAPSHOT_FRAME_BYTES + 1).fill(FrameType.Snapshot));
    await expectRejected(client, CloseCode.TooLarge);
  });

  it("keeps peer counts right when 20 clients connect, all drop at once, and reconnect at once", async () => {
    const { padId } = await createPad();
    const first = await Promise.all(Array.from({ length: 20 }, () => open(padId)));
    await Promise.all(first.map((client) => nextOfType(client, FrameType.SyncAll)));
    await waitFor(() => first.every((client) => latestPeers(client) === 20));

    const watcher = await open(padId);
    await nextOfType(watcher, FrameType.SyncAll);
    for (const client of first) {
      client.socket.close(1001);
    }
    await waitFor(() => latestPeers(watcher) === 1);

    const second = await Promise.all(Array.from({ length: 20 }, () => open(padId)));
    await Promise.all(second.map((client) => nextOfType(client, FrameType.SyncAll)));
    await waitFor(() => latestPeers(watcher) === 21);
    for (const client of [...second, watcher]) {
      client.socket.close(1000);
    }
  });
});
