import { rememberAdminToken } from "../admin-token";
import { createPad } from "../api";
import { generateKeyText } from "../crypto";

const DEFAULT_TTL_SECONDS = 3600;

export function showLanding(root: HTMLElement): void {
  const page = document.createElement("section");
  page.className = "landing";

  const title = document.createElement("h1");
  title.textContent = "PoofPad";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "New pad";

  const error = document.createElement("p");
  error.className = "landing-error";

  function fail(busy: boolean): void {
    button.disabled = false;
    error.textContent = busy
      ? "PoofPad has reached its free daily limit. Please try again after 00:00 UTC."
      : "Could not create a pad. Please try again.";
  }

  button.addEventListener("click", () => {
    button.disabled = true;
    error.textContent = "";
    createPad(DEFAULT_TTL_SECONDS).then(
      (result) => {
        if (!result.ok) {
          fail(result.busy);
          return;
        }
        rememberAdminToken(result.pad.padId, result.pad.adminToken);
        location.assign(`/p/${result.pad.padId}#${generateKeyText()}`);
      },
      () => fail(false),
    );
  });

  page.append(title, button, error);
  root.replaceChildren(page);
}
