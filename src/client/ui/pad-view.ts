import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { CloseCode } from "../../shared/codes";
import { forgetAdminToken, readAdminToken } from "../admin-token";
import { activeUsers, guardRemoteUsers, sanitizeUser } from "../awareness-user";
import { endPad } from "../api";
import { importKey } from "../crypto";
import { createEditor } from "../editor";
import { loadIdentity, saveName } from "../identity";
import { DEFAULT_LANGUAGE, isLanguageId } from "../languages";
import { connectPad } from "../provider";
import { trackActiveLabels } from "../remote-labels";
import { currentTheme, onThemeChange } from "../theme";
import { trackVisualViewport } from "../viewport";
import { showDialog } from "./dialog";
import { el } from "./dom";
import { showMessage } from "./message";
import { showQrDialog } from "./qr";
import { createSidebar } from "./sidebar";

const NOTICE_MS = 6000;

const TOO_LARGE_EDIT =
  "That change is too large to sync (about 1 MB per change). Paste it in smaller parts.";

function closedScreen(code: number): [title: string, detail?: string] {
  switch (code) {
    case CloseCode.Expired:
      return ["This pad has expired", "Its text has been deleted."];
    case CloseCode.NotFound:
      return ["Pad not found", "It may have expired or been ended by its creator."];
    case CloseCode.PadFull:
      return ["This pad is full", "50 people are already connected. Try again later."];
    case CloseCode.TooLarge:
      return [
        "This pad is full",
        "It has reached its 5 MB size limit, so your last change was not saved.",
      ];
    case CloseCode.ServiceBusy:
      return [
        "PoofPad is busy",
        "The service has reached its free daily limit. Try again after 00:00 UTC.",
      ];
    default:
      return ["Disconnected", "The connection to this pad was closed."];
  }
}

function showIncompleteLink(root: HTMLElement): void {
  showMessage(
    root,
    "This link is incomplete",
    "The part after # holds the key that unlocks this pad. Ask for the full link and open it again.",
  );
}

export async function showPad(root: HTMLElement, padId: string): Promise<void> {
  const key = await importKey(location.hash.slice(1));
  if (key === null) {
    showIncompleteLink(root);
    return;
  }

  let identity = loadIdentity();
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  // First listener on purpose: remote names and colours are cleaned before the editor or list see them.
  guardRemoteUsers(awareness);
  const meta = doc.getMap<unknown>("meta");
  const text = doc.getText("text");

  function publishIdentity(): void {
    awareness.setLocalStateField("user", sanitizeUser(identity));
  }
  publishIdentity();

  const toast = el("div", "toast");
  toast.setAttribute("role", "status");
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function notify(message: string): void {
    toast.textContent = message;
    toast.classList.add("toast-visible");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => toast.classList.remove("toast-visible"), NOTICE_MS);
  }

  function copy(value: string, done: string): void {
    navigator.clipboard.writeText(value).then(
      () => notify(done),
      () => notify("Could not copy. Your browser blocked clipboard access."),
    );
  }

  function confirmEnd(adminToken: string): void {
    showDialog(
      "End this pad now?",
      [el("p", undefined, "Its text is deleted for everyone and the link stops working.")],
      [
        { label: "Cancel" },
        {
          label: "End pad now",
          primary: true,
          onClick: () => {
            void endPad(padId, adminToken).then((result) => {
              switch (result) {
                case "ended":
                  forgetAdminToken(padId);
                  return;
                case "unauthorized":
                case "notFound":
                  forgetAdminToken(padId);
                  notify("Only the creator of this pad can end it.");
                  return;
                case "busy":
                case "failed":
                  notify("Could not end the pad. Please try again.");
              }
            });
          },
        },
      ],
    );
  }

  const adminToken = readAdminToken(padId);
  const sidebar = createSidebar(identity, {
    onLanguage: (id) => meta.set("language", id),
    onName: (name) => {
      identity = saveName(identity, name);
      publishIdentity();
      return identity.name;
    },
    onCopyLink: () => copy(location.href, "Link copied."),
    onCopyAll: () => copy(text.toString(), "Text copied."),
    onQr: () => showQrDialog(location.href),
    onEnd: adminToken === null ? null : () => confirmEnd(adminToken),
  });

  const banner = el(
    "div",
    "banner",
    "You are offline. Reconnecting… Your edits are kept and will sync when you are back.",
  );
  banner.setAttribute("role", "status");
  banner.hidden = true;

  const editorHost = el("div", "pad-editor");
  const main = el("div", "pad-main");
  main.append(sidebar.topbar, banner, editorHost);
  const layout = el("div", "pad-layout");
  layout.append(sidebar.sidebar, sidebar.backdrop, main);
  root.replaceChildren(layout, toast);
  document.title = "Pad · PoofPad";

  const stopViewport = trackVisualViewport();
  let teardown = (): void => undefined;

  const connection = connectPad(padId, key, doc, awareness, {
    onStatus(next) {
      sidebar.setStatus(next);
      banner.hidden = next !== "offline";
    },
    onInfo(info) {
      sidebar.setExpiry(info.expiresAt, info.now);
    },
    onClosed(code) {
      teardown();
      if (code === CloseCode.Expired || code === CloseCode.NotFound) {
        forgetAdminToken(padId);
      }
      const [title, detail] = closedScreen(code);
      showMessage(root, title, detail);
    },
    onWrongKey() {
      teardown();
      showMessage(
        root,
        "Wrong key",
        "This link's key can't unlock this pad. Check that you copied the whole link.",
      );
    },
  });

  const editor = createEditor(
    editorHost,
    text,
    awareness,
    { budget: () => connection.editBudget(), onBlocked: () => notify(TOO_LARGE_EDIT) },
    currentTheme(),
  );

  function applySharedLanguage(): void {
    const shared = meta.get("language");
    const id = isLanguageId(shared) ? shared : DEFAULT_LANGUAGE;
    sidebar.setLanguage(id);
    editor.setLanguage(id);
  }
  meta.observe(applySharedLanguage);
  function renderUsers(): void {
    sidebar.setUsers(activeUsers(awareness));
  }
  awareness.on("change", renderUsers);
  renderUsers();
  const stopLabels = trackActiveLabels(awareness, editorHost);
  const stopTheme = onThemeChange((theme) => editor.setTheme(theme));

  teardown = () => {
    clearTimeout(noticeTimer);
    stopTheme();
    stopViewport();
    stopLabels();
    sidebar.stop();
    editor.destroy();
    awareness.destroy();
    doc.destroy();
  };
}
