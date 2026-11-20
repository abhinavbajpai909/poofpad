import { SECOND_MS, formatRemaining } from "../format-remaining";
import { el } from "./dom";

export interface Countdown {
  /** A new element that follows this countdown (the sidebar and the phone top bar each have one). */
  create(className: string): HTMLElement;
  /** `expiresAt` is the server's expiry (ms since epoch), so the value is right after any reload. */
  set(expiresAt: number): void;
  stop(): void;
}

export function createCountdown(): Countdown {
  const elements: HTMLElement[] = [];
  let expiresAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function render(): void {
    const remaining = expiresAt - Date.now();
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
    set(next) {
      expiresAt = next;
      render();
      timer ??= setInterval(render, SECOND_MS);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
