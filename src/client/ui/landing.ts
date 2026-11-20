import { rememberAdminToken } from "../admin-token";
import { createPad } from "../api";
import { generateKeyText } from "../crypto";
import { parsePadLink } from "../pad-link";
import { button, el } from "./dom";

const DEFAULT_TTL_SECONDS = 3600;

const EXPIRY_CHOICES: readonly (readonly [seconds: number, label: string])[] = [
  [600, "10 min"],
  [3600, "1 hour"],
  [21600, "6 hours"],
  [86400, "24 hours"],
];

function createExpiryPicker(): { element: HTMLFieldSetElement; selected: () => number } {
  const element = el("fieldset", "expiry");
  element.append(el("legend", "section-label", "Delete the pad after"));
  const options = el("div", "segmented");
  const inputs: HTMLInputElement[] = [];
  for (const [seconds, label] of EXPIRY_CHOICES) {
    const wrapper = el("label", "segment");
    const input = el("input");
    input.type = "radio";
    input.name = "expiry";
    input.value = String(seconds);
    input.checked = seconds === DEFAULT_TTL_SECONDS;
    inputs.push(input);
    wrapper.append(input, el("span", undefined, label));
    options.append(wrapper);
  }
  element.append(options);
  return {
    element,
    selected: () => Number(inputs.find((input) => input.checked)?.value ?? DEFAULT_TTL_SECONDS),
  };
}

export function showLanding(root: HTMLElement): void {
  document.title = "PoofPad";
  const page = el("section", "landing");
  page.append(
    el("h1", "landing-title", "PoofPad"),
    el(
      "p",
      "landing-blurb",
      "Why PoofPad? Share text with anyone who has the link, live, from any device. " +
        "It is encrypted in your browser, so the server cannot read it, " +
        "and it deletes itself at the time you choose.",
    ),
  );

  const picker = createExpiryPicker();
  const error = el("p", "form-error");
  error.setAttribute("role", "alert");

  const create = button("New pad", "btn btn-primary btn-large", () => {
    create.disabled = true;
    error.textContent = "";
    createPad(picker.selected()).then(
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

  function fail(busy: boolean): void {
    create.disabled = false;
    error.textContent = busy
      ? "PoofPad has reached its free daily limit. Please try again after 00:00 UTC."
      : "Could not create a pad. Please try again.";
  }

  const join = el("form", "join");
  join.noValidate = true;
  const joinInput = el("input", "control");
  joinInput.type = "text";
  joinInput.id = "join-link";
  joinInput.placeholder = "https://…/p/…#…";
  joinInput.autocomplete = "off";
  joinInput.spellcheck = false;
  joinInput.setAttribute("autocapitalize", "off");
  const joinLabel = el("label", "section-label", "Join with link");
  joinLabel.htmlFor = joinInput.id;
  const joinError = el("p", "form-error");
  joinError.setAttribute("role", "alert");
  const joinButton = el("button", "btn", "Join");
  joinButton.type = "submit";
  const joinRow = el("div", "join-row");
  joinRow.append(joinInput, joinButton);
  join.append(joinLabel, joinRow, joinError);
  join.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = parsePadLink(joinInput.value, location.origin);
    if (result.ok) {
      location.assign(result.path);
    } else {
      joinError.textContent = result.message;
      joinInput.focus();
    }
  });

  const privacy = el("a", "footer-link", "Privacy");
  privacy.href = "/privacy";

  page.append(picker.element, create, error, el("hr", "divider"), join, privacy);
  const centered = el("div", "centered");
  centered.append(page);
  root.replaceChildren(centered);
}
