import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHeartbeat } from "../../src/client/heartbeat";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from "../../src/shared/limits";

function setup(visible = true) {
  const state = { visible, pings: 0, dead: 0 };
  const heartbeat = startHeartbeat({
    ping: () => {
      state.pings += 1;
    },
    onDead: () => {
      state.dead += 1;
    },
    isVisible: () => state.visible,
  });
  return { state, heartbeat };
}

describe("startHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings every interval and stays alive while pongs come back", () => {
    const { state, heartbeat } = setup();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1);
    expect(state.pings).toBe(0);
    vi.advanceTimersByTime(1);
    for (let i = 1; i <= 5; i += 1) {
      expect(state.pings).toBe(i);
      // The pong arrives just in time; the next ping is due one interval after this one.
      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1);
      heartbeat.pong();
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - (HEARTBEAT_TIMEOUT_MS - 1));
    }
    expect(state.pings).toBe(6);
    expect(state.dead).toBe(0);
    heartbeat.stop();
  });

  it("declares the connection dead when a pong is late, exactly once, and stops pinging", () => {
    const { state } = setup();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(state.pings).toBe(1);
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1);
    expect(state.dead).toBe(0);
    vi.advanceTimersByTime(1);
    expect(state.dead).toBe(1);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 10);
    expect(state.dead).toBe(1);
    expect(state.pings).toBe(1);
  });

  it("a pong for an earlier ping does not cover a later unanswered one", () => {
    const { state, heartbeat } = setup();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    heartbeat.pong();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(state.pings).toBe(2);
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    expect(state.dead).toBe(1);
  });

  it("does not ping while the tab is hidden, and pings at once when it becomes visible", () => {
    const { state, heartbeat } = setup(false);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 10);
    expect(state.pings).toBe(0);

    state.visible = true;
    heartbeat.visibilityChanged();
    expect(state.pings).toBe(1);
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    expect(state.dead).toBe(1);
  });

  it("hiding the tab pauses both the next ping and a pending pong deadline", () => {
    const { state, heartbeat } = setup();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(state.pings).toBe(1);
    state.visible = false;
    heartbeat.visibilityChanged();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 10);
    expect(state.pings).toBe(1);
    expect(state.dead).toBe(0);

    state.visible = true;
    heartbeat.visibilityChanged();
    expect(state.pings).toBe(2);
    heartbeat.pong();
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    expect(state.dead).toBe(0);
  });

  it("stop() ends all pings and timeouts", () => {
    const { state, heartbeat } = setup();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    heartbeat.stop();
    heartbeat.visibilityChanged();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 10);
    expect(state.pings).toBe(1);
    expect(state.dead).toBe(0);
  });
});
