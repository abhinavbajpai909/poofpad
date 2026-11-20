import { createPad } from "../api";

const DEFAULT_TTL_SECONDS = 3600;

function rememberAdminToken(padId: string, adminToken: string): void {
  try {
    localStorage.setItem(`admin:${padId}`, adminToken);
  } catch {
    return;
  }
}

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

  button.addEventListener("click", () => {
    button.disabled = true;
    error.textContent = "";
    createPad(DEFAULT_TTL_SECONDS).then(
      ({ padId, adminToken }) => {
        rememberAdminToken(padId, adminToken);
        location.assign(`/p/${padId}`);
      },
      () => {
        button.disabled = false;
        error.textContent = "Could not create a pad. Please try again.";
      },
    );
  });

  page.append(title, button, error);
  root.replaceChildren(page);
}
