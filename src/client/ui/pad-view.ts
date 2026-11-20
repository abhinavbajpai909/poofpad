import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { CloseCode } from "../../shared/codes";
import { forgetAdminToken, readAdminToken } from "../admin-token";
import { endPad } from "../api";
import { importKey } from "../crypto";
import { createEditor } from "../editor";
import { type ConnectionStatus, connectPad } from "../provider";
import { showMessage } from "./message";

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  online: "Connected",
  offline: "Offline, reconnecting…",
};

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
      return ["Disconnected"];
  }
}

function showIncompleteLink(root: HTMLElement): void {
  showMessage(
    root,
    "This link is incomplete",
    "The part after # holds the key that unlocks this pad. Ask for the full link and open it again.",
  );
}

function createEndButton(padId: string, adminToken: string, notify: (text: string) => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "End now";
  button.addEventListener("click", () => {
    if (!confirm("End this pad now? Its text is deleted for everyone.")) {
      return;
    }
    button.disabled = true;
    void endPad(padId, adminToken).then((result) => {
      switch (result) {
        case "ended":
          forgetAdminToken(padId);
          return;
        case "unauthorized":
        case "notFound":
          forgetAdminToken(padId);
          button.remove();
          notify("Only the creator of this pad can end it.");
          return;
        case "busy":
        case "failed":
          button.disabled = false;
          notify("Could not end the pad. Please try again.");
      }
    });
  });
  return button;
}

export async function showPad(root: HTMLElement, padId: string): Promise<void> {
  const key = await importKey(location.hash.slice(1));
  if (key === null) {
    showIncompleteLink(root);
    return;
  }

  const bar = document.createElement("header");
  bar.className = "pad-bar";
  const status = document.createElement("span");
  const peers = document.createElement("span");
  const notice = document.createElement("span");
  notice.className = "pad-notice";
  notice.setAttribute("role", "status");
  bar.append(status, peers, notice);

  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function notify(text: string): void {
    notice.textContent = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.textContent = "";
    }, NOTICE_MS);
  }

  const adminToken = readAdminToken(padId);
  if (adminToken !== null) {
    bar.append(createEndButton(padId, adminToken, notify));
  }

  const editorHost = document.createElement("div");
  editorHost.className = "pad-editor";
  root.replaceChildren(bar, editorHost);

  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  let teardown = (): void => undefined;

  const connection = connectPad(padId, key, doc, awareness, {
    onStatus(next) {
      status.textContent = STATUS_LABELS[next];
    },
    onInfo(info) {
      peers.textContent = `${info.peers} connected`;
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

  const view = createEditor(editorHost, doc.getText("text"), awareness, {
    budget: () => connection.editBudget(),
    onBlocked: () => notify(TOO_LARGE_EDIT),
  });

  teardown = () => {
    clearTimeout(noticeTimer);
    view.destroy();
    awareness.destroy();
    doc.destroy();
  };
}
