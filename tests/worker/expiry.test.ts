import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CloseCode } from "../../src/shared/codes";
import { FrameType, decodeError, encodeFrame } from "../../src/shared/protocol";
import { createPad, nextOfType, open, post, storedTables } from "./helpers";

describe("expiry (test 5)", () => {
  it("sets the alarm to expiresAt", async () => {
    const { padId, expiresAt } = await createPad(15);
    const alarm = await runInDurableObject(env.PAD.getByName(padId), (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBe(expiresAt);
  });

  it("closes every socket with 4001 and leaves storage empty", async () => {
    const { padId, adminToken } = await createPad(15);
    const a = await open(padId);
    const b = await open(padId);
    await nextOfType(b, FrameType.SyncAll);
    a.socket.send(encodeFrame(FrameType.Update, new Uint8Array([1, 2, 3])));
    await nextOfType(b, FrameType.Update);

    expect(await runDurableObjectAlarm(env.PAD.getByName(padId))).toBe(true);

    for (const client of [a, b]) {
      expect(decodeError(await nextOfType(client, FrameType.Error))).toBe(CloseCode.Expired);
      expect(await client.closed).toBe(CloseCode.Expired);
    }
    expect(await storedTables(padId)).toEqual([]);
    const alarm = await runInDurableObject(env.PAD.getByName(padId), (_instance, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBeNull();

    const late = await open(padId);
    expect(decodeError(await nextOfType(late, FrameType.Error))).toBe(CloseCode.NotFound);
    expect(await late.closed).toBe(CloseCode.NotFound);
    const endResponse = await post(`/api/pads/${padId}/end`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(endResponse.status).toBe(404);
    await endResponse.body?.cancel();
  });

  it("treats a pad past expires_at as gone even if the alarm has not fired", async () => {
    const { padId } = await createPad(15);
    const a = await open(padId);
    await nextOfType(a, FrameType.SyncAll);
    await runInDurableObject(env.PAD.getByName(padId), (_instance, state) => {
      state.storage.sql.exec("UPDATE meta SET expires_at = ?", Date.now() - 1);
    });

    a.socket.send(encodeFrame(FrameType.Update, new Uint8Array([1])));
    expect(await a.closed).toBe(CloseCode.Expired);
    expect(await storedTables(padId)).toEqual([]);

    const late = await open(padId);
    expect(await late.closed).toBe(CloseCode.NotFound);
  });
});
