import { el } from "./dom";

/** Full-page notice used for every end state (expired, not found, wrong key, ...). */
export function showMessage(root: HTMLElement, text: string, detail?: string): void {
  const page = el("section", "message");
  page.append(el("h1", "message-title", text));
  if (detail !== undefined) {
    page.append(el("p", "message-detail", detail));
  }
  const home = el("a", "btn btn-primary", "Back to PoofPad");
  home.href = "/";
  page.append(home);
  const centered = el("div", "centered");
  centered.append(page);
  root.replaceChildren(centered);
  document.title = `${text} · PoofPad`;
  home.focus();
}
