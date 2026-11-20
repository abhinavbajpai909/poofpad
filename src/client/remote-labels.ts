import type { Awareness } from "y-protocols/awareness";
import { sanitizeUser } from "./awareness-user";

const ACTIVE_MS = 2500;
const ACTIVE_CLASS = "cm-label-active";

function rgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
}

/**
 * y-codemirror.next draws each remote caret with a name label that only shows on hover. This also shows a
 * label for a couple of seconds after its owner types or moves. Carets carry no client id, so a label is
 * matched by its caret colour and name (a clash only makes two labels show together).
 */
export function trackActiveLabels(awareness: Awareness, editorRoot: HTMLElement): () => void {
  const activeUntil = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function refresh(): void {
    const now = Date.now();
    for (const [key, until] of activeUntil) {
      if (until <= now) {
        activeUntil.delete(key);
      }
    }
    for (const caret of editorRoot.querySelectorAll<HTMLElement>(".cm-ySelectionCaret")) {
      const label = caret.querySelector(".cm-ySelectionInfo");
      const key = `${caret.style.backgroundColor}|${label?.textContent ?? ""}`;
      label?.classList.toggle(ACTIVE_CLASS, activeUntil.has(key));
    }
    clearTimeout(timer);
    const next = Math.min(...activeUntil.values());
    if (Number.isFinite(next)) {
      timer = setTimeout(refresh, next - now + 20);
    }
  }

  function onChange({ added, updated }: { added: number[]; updated: number[] }): void {
    let moved = false;
    for (const id of [...added, ...updated]) {
      const state = awareness.getStates().get(id);
      if (id !== awareness.clientID && state?.cursor !== undefined) {
        const { name, color } = sanitizeUser(state.user);
        activeUntil.set(`${rgb(color)}|${name}`, Date.now() + ACTIVE_MS);
        moved = true;
      }
    }
    if (moved) {
      // After the editor has redrawn the carets for this change.
      requestAnimationFrame(refresh);
    }
  }

  awareness.on("change", onChange);
  return () => {
    awareness.off("change", onChange);
    clearTimeout(timer);
  };
}
