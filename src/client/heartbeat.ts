import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from "../shared/limits";

export interface HeartbeatOptions {
  /** Sends one ping on the connection. */
  ping(): void;
  /** No pong arrived in time: the connection is dead even though it never closed (half-open). */
  onDead(): void;
  isVisible(): boolean;
}

export interface Heartbeat {
  /** A pong arrived. */
  pong(): void;
  /** Call when the tab's visibility changes. Hidden: paused. Visible again: pings at once. */
  visibilityChanged(): void;
  stop(): void;
}

/**
 * Pings every HEARTBEAT_INTERVAL_MS while the tab is visible and declares the connection dead if a pong
 * takes longer than HEARTBEAT_TIMEOUT_MS. Only a pong counts: other frames could still arrive on a
 * connection whose upload direction is dead. Hidden tabs don't ping, so idle background tabs cost nothing.
 */
export function startHeartbeat({ ping, onDead, isVisible }: HeartbeatOptions): Heartbeat {
  let nextPing: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function clearDeadline(): void {
    if (deadline !== undefined) {
      clearTimeout(deadline);
      deadline = undefined;
    }
  }

  function pause(): void {
    if (nextPing !== undefined) {
      clearTimeout(nextPing);
      nextPing = undefined;
    }
    clearDeadline();
  }

  function sendPing(): void {
    nextPing = setTimeout(sendPing, HEARTBEAT_INTERVAL_MS);
    if (deadline === undefined) {
      deadline = setTimeout(() => {
        pause();
        stopped = true;
        onDead();
      }, HEARTBEAT_TIMEOUT_MS);
    }
    ping();
  }

  function schedule(): void {
    if (!stopped && isVisible()) {
      nextPing = setTimeout(sendPing, HEARTBEAT_INTERVAL_MS);
    }
  }

  schedule();
  return {
    pong: clearDeadline,
    visibilityChanged() {
      if (stopped) {
        return;
      }
      pause();
      if (isVisible()) {
        // Coming back (e.g. a phone waking up) is when a connection is most likely to have died.
        sendPing();
      }
    },
    stop() {
      stopped = true;
      pause();
    },
  };
}
