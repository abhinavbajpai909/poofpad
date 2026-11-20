import { button, el } from "./dom";

export interface DialogAction {
  label: string;
  primary?: boolean;
  /** Return false to keep the dialog open. */
  onClick?: () => boolean | void;
}

/** A modal dialog; the browser handles focus trapping, Escape and inertness of the page behind it. */
export function showDialog(
  title: string,
  body: readonly Node[],
  actions: readonly DialogAction[],
): void {
  const dialog = el("dialog", "dialog");
  const heading = el("h2", "dialog-title", title);
  heading.id = "dialog-title";
  dialog.setAttribute("aria-labelledby", heading.id);

  const buttons = el("div", "dialog-actions");
  for (const action of actions) {
    buttons.append(
      button(action.label, action.primary === true ? "btn btn-primary" : "btn", () => {
        if (action.onClick?.() !== false) {
          dialog.close();
        }
      }),
    );
  }

  dialog.append(heading, ...body, buttons);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
