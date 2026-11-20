import type { Awareness } from "y-protocols/awareness";
import { cleanName } from "./name";

export interface AwarenessUser {
  name: string;
  color: string;
  colorLight: string;
}

export interface ActiveUser {
  clientId: number;
  name: string;
  color: string;
  self: boolean;
}

export const FALLBACK_COLOR = "#808080";
export const FALLBACK_NAME = "Anonymous";

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function sanitizeColor(value: unknown): string {
  return typeof value === "string" && COLOR_PATTERN.test(value) ? value : FALLBACK_COLOR;
}

/** Awareness data comes from other clients, so name and colour are checked before anything uses them. */
export function sanitizeUser(value: unknown): AwarenessUser {
  const { name, color } = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const cleaned = typeof name === "string" ? cleanName(name) : "";
  const safeColor = sanitizeColor(color);
  return {
    name: cleaned === "" ? FALLBACK_NAME : cleaned,
    color: safeColor,
    colorLight: `${safeColor}33`,
  };
}

/**
 * Rewrites every remote `user` to its sanitized form as soon as it arrives. Register it before anything
 * else listens (the editor, the user list), because listeners run in registration order.
 */
export function guardRemoteUsers(awareness: Awareness): void {
  awareness.on("change", ({ added, updated }: { added: number[]; updated: number[] }) => {
    for (const id of [...added, ...updated]) {
      const state = awareness.getStates().get(id);
      if (id !== awareness.clientID && state?.user !== undefined) {
        state.user = sanitizeUser(state.user);
      }
    }
  });
}

/** Everyone with a published identity: this client first, then the others in join order. */
export function activeUsers(awareness: Awareness): ActiveUser[] {
  const users: ActiveUser[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (state.user !== undefined) {
      const { name, color } = sanitizeUser(state.user);
      users.push({ clientId, name, color, self: clientId === awareness.clientID });
    }
  }
  return users.sort((a, b) => Number(b.self) - Number(a.self) || a.clientId - b.clientId);
}
