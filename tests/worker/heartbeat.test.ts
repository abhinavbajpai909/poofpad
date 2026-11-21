import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CloseCode } from "../../src/shared/codes";
import { MAX_MESSAGES_PER_SECOND } from "../../src/shared/limits";
import { FrameType, HEARTBEAT_PING, HEARTBEAT_PONG } from "../../src/shared/protocol";
import { createPad, expectFrame, open, waitFor } from "./helpers";

describe("heartbeat (WebSocket auto-response)", () => {
  it("answers a ping with a pong and nothing else", async () => {
    const { padId } = await createPad();
    const client = await open(padId);
    await expectFrame(client, FrameType.SyncAll);
    await expectFrame(client, FrameType.Info);
    client.socket.send(HEARTBEAT_PING);
    await waitFor(() => client.texts.length > 0);
    expect(client.texts).toEqual([HEARTBEAT_PONG]);
    expect(client.frames.map((frame) => frame.type)).toEqual([FrameType.SyncAll, FrameType.Info]);
  });

  it("is answered by the runtime: the object never sees it, so it is not rate limited", async () => {
    const { padId } = await createPad();
    const client = await open(padId);
    await expectFrame(client, FrameType.SyncAll);
    const count = MAX_MESSAGES_PER_SECOND * 3;
    for (let i = 0; i < count; i += 1) {
      client.socket.send(HEARTBEAT_PING);
    }
    await waitFor(() => client.texts.length === count);
    expect(client.texts.every((text) => text === HEARTBEAT_PONG)).toBe(true);
    // The socket is still open and usable, and the pings were never counted against the rate window.
    const stub = env.PAD.get(env.PAD.idFromName(padId));
    const auto = await runInDurableObject(stub, (_pad, state) => {
      const [socket] = state.getWebSockets();
      return {
        request: state.getWebSocketAutoResponse()?.request,
        answered: socket === undefined ? null : state.getWebSocketAutoResponseTimestamp(socket),
        hits: (socket?.deserializeAttachment() as { hits: number[] } | null)?.hits.length,
      };
    });
    expect(auto.request).toBe(HEARTBEAT_PING);
    expect(auto.answered).toBeInstanceOf(Date);
    expect(auto.hits).toBe(0);
  });

  it("any other text frame still closes the socket as unsupported", async () => {
    const { padId } = await createPad();
    const client = await open(padId);
    await expectFrame(client, FrameType.SyncAll);
    client.socket.send(`${HEARTBEAT_PING} `);
    expect(await client.closed).toBe(CloseCode.UnsupportedData);
    expect(client.texts).toEqual([]);
  });
});
