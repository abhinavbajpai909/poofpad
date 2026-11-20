import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CloseCode } from "../../src/shared/codes";
import {
  MAX_FRAME_BYTES,
  MAX_MESSAGES_PER_SECOND,
  MAX_PEERS_PER_PAD,
  MAX_STORED_BYTES_PER_PAD,
} from "../../src/shared/limits";
import { FrameType, decodeError, decodeInfo, encodeFrame } from "../../src/shared/protocol";
import { type TestSocket, bytes, createPad, nextOfType, open, storedRows } from "./helpers";

async function expectRejected(client: TestSocket, code: number): Promise<void> {
  expect(decodeError(await nextOfType(client, FrameType.Error))).toBe(code);
  expect(await client.closed).toBe(code);
}

describe("limits (test 9)", () => {
  it("refuses the 51st socket with 4009", async () => {
    const { padId } = await createPad();
    const clients: TestSocket[] = [];
    for (let i = 0; i < MAX_PEERS_PER_PAD; i += 1) {
      clients.push(await open(padId));
    }
    const last = clients.at(-1);
    if (last === undefined) {
      throw new Error("no clients");
    }
    await nextOfType(last, FrameType.SyncAll);
    expect(decodeInfo(await nextOfType(last, FrameType.Info))?.peers).toBe(MAX_PEERS_PER_PAD);

    const extra = await open(padId);
    await expectRejected(extra, CloseCode.PadFull);

    last.socket.close(1000);
    const first = clients[0];
    if (first === undefined) {
      throw new Error("no clients");
    }
    for (;;) {
      const info = decodeInfo(await nextOfType(first, FrameType.Info));
      if (info?.peers === MAX_PEERS_PER_PAD - 1) {
        break;
      }
    }
    const replacement = await open(padId);
    await nextOfType(replacement, FrameType.SyncAll);
    for (const client of [...clients.slice(0, -1), replacement]) {
      client.socket.close(1000);
    }
  });

  it("closes a flooding socket with 4008 and leaves others connected", async () => {
    const { padId } = await createPad();
    const flooder = await open(padId);
    const other = await open(padId);
    await nextOfType(other, FrameType.SyncAll);
    for (let i = 0; i <= MAX_MESSAGES_PER_SECOND; i += 1) {
      flooder.socket.send(encodeFrame(FrameType.Awareness, new Uint8Array([i])));
    }
    await expectRejected(flooder, CloseCode.RateLimited);

    const check = await open(padId);
    await nextOfType(check, FrameType.SyncAll);
    check.socket.send(encodeFrame(FrameType.Awareness, new Uint8Array([200])));
    const relayed: number[] = [];
    for (;;) {
      const value = (await nextOfType(other, FrameType.Awareness))[0] ?? -1;
      if (value === 200) {
        break;
      }
      relayed.push(value);
    }
    expect(relayed).toEqual(Array.from({ length: MAX_MESSAGES_PER_SECOND }, (_v, i) => i));
  });

  it("allows 40 messages per second", async () => {
    const { padId } = await createPad();
    const sender = await open(padId);
    const receiver = await open(padId);
    await nextOfType(receiver, FrameType.SyncAll);
    for (let i = 0; i < MAX_MESSAGES_PER_SECOND; i += 1) {
      sender.socket.send(encodeFrame(FrameType.Awareness, new Uint8Array([i])));
    }
    for (let i = 0; i < MAX_MESSAGES_PER_SECOND; i += 1) {
      expect(await nextOfType(receiver, FrameType.Awareness)).toEqual(new Uint8Array([i]));
    }
    expect(sender.frames.some((frame) => frame.type === FrameType.Error)).toBe(false);
  });

  it.each([
    ["a foreign origin", { Origin: "https://evil.test" }],
    ["a look-alike origin", { Origin: "https://poofpad.test.evil.test" }],
    ["a malformed origin", { Origin: "not a url" }],
    ["no origin", {}],
  ])("refuses %s with 4003", async (_name, headers) => {
    const { padId } = await createPad();
    const client = await open(padId, headers);
    await expectRejected(client, CloseCode.BadOrigin);
  });

  it("allows localhost origins in test mode", async () => {
    const { padId } = await createPad();
    const client = await open(padId, { Origin: "http://localhost:5173" });
    await nextOfType(client, FrameType.SyncAll);
    client.socket.close(1000);
  });

  it("accepts an update frame of exactly 1 MB and refuses a larger one with 4013", async () => {
    const { padId } = await createPad();
    const sender = await open(padId);
    const receiver = await open(padId);
    await nextOfType(receiver, FrameType.SyncAll);

    const atLimit = bytes(MAX_FRAME_BYTES - 1);
    sender.socket.send(encodeFrame(FrameType.Update, atLimit));
    expect((await nextOfType(receiver, FrameType.Update)).byteLength).toBe(atLimit.byteLength);

    sender.socket.send(encodeFrame(FrameType.Update, bytes(MAX_FRAME_BYTES)));
    await expectRejected(sender, CloseCode.TooLarge);
    expect((await storedRows(padId)).length).toBe(1);
  });

  it("refuses an update that would take the pad over 5 MB with 4013; others are unaffected", async () => {
    const { padId } = await createPad();
    const writer = await open(padId);
    const other = await open(padId);
    await nextOfType(other, FrameType.SyncAll);

    const chunk = MAX_FRAME_BYTES - 1;
    const fits = Math.floor(MAX_STORED_BYTES_PER_PAD / chunk);
    for (let i = 0; i < fits; i += 1) {
      writer.socket.send(encodeFrame(FrameType.Update, bytes(chunk, i)));
      await nextOfType(other, FrameType.Update);
    }
    writer.socket.send(encodeFrame(FrameType.Update, bytes(chunk, 99)));
    await expectRejected(writer, CloseCode.TooLarge);

    const rows = await storedRows(padId);
    expect(rows).toHaveLength(fits);
    expect(rows.reduce((sum, row) => sum + row.data.byteLength, 0)).toBeLessThanOrEqual(
      MAX_STORED_BYTES_PER_PAD,
    );

    const check = await open(padId);
    await nextOfType(check, FrameType.SyncAll);
    check.socket.send(encodeFrame(FrameType.Awareness, new Uint8Array([5])));
    expect(await nextOfType(other, FrameType.Awareness)).toEqual(new Uint8Array([5]));
  });

  it("sends ERROR 5 and closes with 4005 when a storage write fails (free-plan quota)", async () => {
    const { padId } = await createPad();
    const writer = await open(padId);
    const other = await open(padId);
    await nextOfType(other, FrameType.SyncAll);
    await runInDurableObject(env.PAD.getByName(padId), (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER simulate_quota BEFORE INSERT ON updates BEGIN SELECT RAISE(ABORT, 'quota exceeded'); END",
      );
    });

    writer.socket.send(encodeFrame(FrameType.Update, new Uint8Array([1, 2, 3])));
    const error = await nextOfType(writer, FrameType.Error);
    expect(Array.from(error)).toEqual([5]);
    expect(decodeError(error)).toBe(CloseCode.ServiceBusy);
    expect(await writer.closed).toBe(CloseCode.ServiceBusy);
    expect(other.frames.some((frame) => frame.type === FrameType.Update)).toBe(false);
    expect(await storedRows(padId)).toEqual([]);
  });
});
