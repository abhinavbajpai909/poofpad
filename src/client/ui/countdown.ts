import { SECOND_MS, formatRemaining } from "../format-remaining";
import { el } from "./dom";

export interface Countdown {
  /** A new element that follows this countdown (the sidebar and the phone top bar each have one). */
  create(className: string): HTMLElement;
  /**
   * `expiresAt` is the server's expiry and `serverNow` the server's clock when it said so (both ms since
   * epoch), so the value is right after any reload and on a device whose clock is wrong.
   */
  set(expiresAt: number, serverNow: number): void;
  stop(): void;
}

export function createCountdown(): Countdown {
  const elements: HTMLElement[] = [];
  let expiresAt = 0;
  /** Server clock minus device clock. */
  let clockOffset = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function render(): void {
    const remaining = expiresAt - (Date.now() + clockOffset);
    for (const element of elements) {
      element.textContent = remaining > 0 ? formatRemaining(remaining) : "Expiring…";
      element.classList.toggle("countdown-low", remaining <= 60 * SECOND_MS);
    }
  }

  return {
    create(className) {
      const element = el("span", `countdown ${className}`, "--:--");
      element.setAttribute("role", "timer");
      element.title = "Time until this pad is deleted";
      elements.push(element);
      return element;
    },
    set(next, serverNow) {
      expiresAt = next;
      clockOffset = serverNow - Date.now();
      render();
      timer ??= setInterval(render, SECOND_MS);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
