import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_COLOR,
  FALLBACK_NAME,
  activeUsers,
  guardRemoteUsers,
  sanitizeColor,
  sanitizeUser,
} from "../../src/client/awareness-user";
import { MAX_NAME_LENGTH, cleanName } from "../../src/client/name";

describe("cleanName", () => {
  it("strips control and bidi characters and trims", () => {
    expect(cleanName("  Al\u0000i‮ce​\n ")).toBe("Alice");
  });

  it("limits to 24 characters without splitting an emoji", () => {
    expect(cleanName("x".repeat(100))).toHaveLength(MAX_NAME_LENGTH);
    const emoji = cleanName("😀".repeat(30));
    expect(Array.from(emoji)).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe("sanitizeColor", () => {
  it("accepts #rrggbb only", () => {
    expect(sanitizeColor("#a1B2c3")).toBe("#a1B2c3");
    for (const bad of ["red", "#fff", "#12345g", "#123456; background:url(x)", "", 5, null]) {
      expect(sanitizeColor(bad)).toBe(FALLBACK_COLOR);
    }
  });
});

describe("sanitizeUser", () => {
  it("falls back for missing or wrongly typed fields", () => {
    expect(sanitizeUser(undefined)).toEqual({
      name: FALLBACK_NAME,
      color: FALLBACK_COLOR,
      colorLight: `${FALLBACK_COLOR}33`,
    });
    expect(sanitizeUser({ name: 5, color: {} }).name).toBe(FALLBACK_NAME);
  });

  it("derives colorLight itself instead of trusting the sender", () => {
    const user = sanitizeUser({ name: "A", color: "#112233", colorLight: "red; x:y" });
    expect(user.colorLight).toBe("#11223333");
  });
});

describe("remote awareness", () => {
  function setup() {
    const remoteDoc = new Y.Doc();
    const remote = new Awareness(remoteDoc);
    const localDoc = new Y.Doc();
    const local = new Awareness(localDoc);
    guardRemoteUsers(local);
    local.setLocalStateField("user", sanitizeUser({ name: "Me", color: "#112233" }));
    return { remote, local, remoteDoc };
  }

  it("cleans a hostile remote user before anyone reads it", () => {
    const { remote, local, remoteDoc } = setup();
    remote.setLocalStateField("user", {
      name: "Mal‮lory" + "x".repeat(50),
      color: "red;background:url(//evil)",
      colorLight: "expression(1)",
    });
    applyAwarenessUpdate(local, encodeAwarenessUpdate(remote, [remoteDoc.clientID]), "remote");

    const state = local.getStates().get(remoteDoc.clientID);
    expect(state?.user).toEqual({
      name: `Mallory${"x".repeat(17)}`,
      color: FALLBACK_COLOR,
      colorLight: `${FALLBACK_COLOR}33`,
    });
  });

  it("lists this client first, then the others", () => {
    const { remote, local, remoteDoc } = setup();
    remote.setLocalStateField("user", { name: "Zed", color: "#445566" });
    applyAwarenessUpdate(local, encodeAwarenessUpdate(remote, [remoteDoc.clientID]), "remote");
    const users = activeUsers(local);
    expect(users.map((user) => [user.name, user.self])).toEqual([
      ["Me", true],
      ["Zed", false],
    ]);
  });
});
