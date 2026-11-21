import { afterEach, describe, expect, it, vi } from "vitest";
import { createSerialQueue } from "../../src/client/serial-queue";

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createSerialQueue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs tasks one at a time in queue order, even when earlier ones are slower", async () => {
    const queue = createSerialQueue();
    const log: string[] = [];
    let running = 0;
    const task = (name: string, ms: number) => async () => {
      running += 1;
      expect(running).toBe(1);
      log.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`end ${name}`);
      running -= 1;
    };
    queue(task("a", 20));
    queue(task("b", 0));
    queue(task("c", 5));
    // Wait for the queue itself (a last task), not a fixed time that a busy machine can overrun.
    await new Promise<void>((resolve) => {
      queue(async () => resolve());
    });
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("keeps going after a failed task and logs only a generic message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const queue = createSerialQueue();
    const done: string[] = [];
    queue(() => Promise.reject(new Error("secret pad text and key")));
    queue(async () => {
      done.push("after");
    });
    await settle();
    await settle();
    expect(done).toEqual(["after"]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("internal error");
  });
});
