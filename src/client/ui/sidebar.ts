import type { ActiveUser } from "../awareness-user";
import type { Identity } from "../identity";
import { LANGUAGES, LANGUAGE_IDS, type LanguageId, isLanguageId } from "../languages";
import type { ConnectionStatus } from "../provider";
import { createCountdown } from "./countdown";
import { button, el } from "./dom";
import { createThemeToggle } from "./theme-toggle";
import { createUserList } from "./user-list";

export interface SidebarActions {
  onLanguage(id: LanguageId): void;
  /** Returns the name that was accepted (an empty or unchanged name is rejected). */
  onName(name: string): string;
  onCopyLink(): void;
  onCopyAll(): void;
  onQr(): void;
  /** Null when this browser is not the pad's creator. */
  onEnd: (() => void) | null;
}

export interface Sidebar {
  /** Left column on desktop, slide-in drawer on phones. */
  sidebar: HTMLElement;
  /** Phones only: hamburger, countdown and people count. */
  topbar: HTMLElement;
  /** Phones only: the dimmed area behind the open drawer. */
  backdrop: HTMLElement;
  setStatus(status: ConnectionStatus): void;
  setExpiry(expiresAt: number, serverNow: number): void;
  setLanguage(id: LanguageId): void;
  setUsers(users: readonly ActiveUser[]): void;
  stop(): void;
}

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  online: "Connected",
  offline: "Offline",
};

function section(heading?: string): HTMLElement {
  const element = el("section", "sidebar-section");
  if (heading !== undefined) {
    element.append(el("h2", "sidebar-heading", heading));
  }
  return element;
}

export function createSidebar(identity: Identity, actions: SidebarActions): Sidebar {
  const countdown = createCountdown();
  const theme = createThemeToggle();

  const sidebar = el("aside", "sidebar");
  sidebar.id = "pad-sidebar";
  sidebar.setAttribute("aria-label", "Pad controls");
  const backdrop = el("div", "backdrop");

  let drawerOpen = false;

  const closeButton = button("Close", "btn drawer-close", () => setDrawer(false));
  closeButton.setAttribute("aria-label", "Close menu");

  const head = el("div", "sidebar-head");
  head.append(el("h1", "sidebar-title", "PoofPad"), theme.element, closeButton);

  const statusRow = el("div", "status-row");
  const dot = el("span", "status-dot");
  dot.setAttribute("aria-hidden", "true");
  const statusText = el("span", undefined, STATUS_LABELS.connecting);
  statusText.setAttribute("role", "status");
  statusRow.append(dot, statusText);
  const expiryRow = el("div", "expiry-row");
  expiryRow.append(el("span", undefined, "Deletes in "), countdown.create("countdown-large"));
  const state = section();
  state.append(statusRow, expiryRow);
  if (actions.onEnd !== null) {
    const end = actions.onEnd;
    state.append(button("End now", "btn btn-danger", () => closeThen(end)));
  }

  const language = el("select", "control");
  language.id = "language-select";
  for (const id of LANGUAGE_IDS) {
    const option = el("option", undefined, LANGUAGES[id].label);
    option.value = id;
    language.append(option);
  }
  language.addEventListener("change", () => {
    if (isLanguageId(language.value)) {
      actions.onLanguage(language.value);
    }
  });
  const languageLabel = el("label", "sidebar-heading", "Language");
  languageLabel.htmlFor = language.id;
  const languageSection = section();
  languageSection.append(languageLabel, language);

  const share = section("Share");
  const copyLink = button("Copy link", "btn", () => closeThen(actions.onCopyLink));
  const qrCode = button("QR code", "btn", () => closeThen(actions.onQr));
  share.append(
    copyLink,
    button("Copy all", "btn", () => closeThen(actions.onCopyAll)),
    qrCode,
  );
  /**
   * The first row stored in a pad is its key check, written by the first client to sync. Sharing the link
   * before this client has synced would let someone with a different key write it first and lock the
   * creator out ("Wrong key"). So the link and the QR code wait for the first sync; after that they stay.
   */
  const shareHint = "Available once the pad is connected";
  let linkEnabled = false;
  for (const element of [copyLink, qrCode]) {
    element.disabled = true;
    element.title = shareHint;
  }

  const users = createUserList(identity, actions.onName);

  const privacy = el("a", "sidebar-link", "Privacy");
  privacy.href = "/privacy";
  privacy.target = "_blank";
  privacy.rel = "noopener noreferrer";

  sidebar.append(head, state, languageSection, share, users.element, privacy);

  const menuButton = button("☰", "btn menu-button", () => setDrawer(true));
  menuButton.setAttribute("aria-label", "Open menu");
  menuButton.setAttribute("aria-controls", sidebar.id);
  menuButton.setAttribute("aria-expanded", "false");
  const peers = el("span", "topbar-peers", "1 person");
  const topbar = el("header", "topbar");
  topbar.append(
    menuButton,
    el("strong", "topbar-title", "PoofPad"),
    countdown.create("countdown-top"),
    peers,
  );

  function setDrawer(open: boolean): void {
    drawerOpen = open;
    sidebar.classList.toggle("drawer-open", open);
    backdrop.classList.toggle("drawer-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    if (open) {
      closeButton.focus();
    }
  }

  /** Phone actions close the drawer so the result (toast, dialog) is visible. */
  function closeThen(action: () => void): void {
    if (drawerOpen) {
      setDrawer(false);
      menuButton.focus();
    }
    action();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && drawerOpen) {
      setDrawer(false);
      menuButton.focus();
    }
  }

  backdrop.addEventListener("click", () => setDrawer(false));
  document.addEventListener("keydown", onKeydown);

  return {
    sidebar,
    topbar,
    backdrop,
    setStatus(next) {
      statusText.textContent = STATUS_LABELS[next];
      statusRow.dataset.state = next;
      if (next === "online" && !linkEnabled) {
        linkEnabled = true;
        for (const element of [copyLink, qrCode]) {
          element.disabled = false;
          element.removeAttribute("title");
        }
      }
    },
    setExpiry: countdown.set,
    setLanguage(id) {
      language.value = id;
    },
    setUsers(list) {
      users.setUsers(list);
      peers.textContent = `${list.length} ${list.length === 1 ? "person" : "people"}`;
    },
    stop() {
      countdown.stop();
      theme.stop();
      document.removeEventListener("keydown", onKeydown);
    },
  };
}
