import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { CloseCode } from "../../shared/codes";
import { importKey } from "../crypto";
import { createEditor } from "../editor";
import { type ConnectionStatus, connectPad } from "../provider";
import { showMessage } from "./message";

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  online: "Connected",
  offline: "Offline, reconnecting…",
};

function closedText(code: number): string {
  switch (code) {
    case CloseCode.Expired:
      return "This pad has expired";
    case CloseCode.NotFound:
      return "Pad not found";
    default:
      return "Disconnected";
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

  const bar = document.createElement("header");
  bar.className = "pad-bar";
  const status = document.createElement("span");
  const peers = document.createElement("span");
  bar.append(status, peers);

  const editorHost = document.createElement("div");
  editorHost.className = "pad-editor";
  root.replaceChildren(bar, editorHost);

  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const view = createEditor(editorHost, doc.getText("text"), awareness);

  function teardown(): void {
    view.destroy();
    awareness.destroy();
    doc.destroy();
  }

  connectPad(padId, key, doc, awareness, {
    onStatus(next) {
      status.textContent = STATUS_LABELS[next];
    },
    onInfo(info) {
      peers.textContent = `${info.peers} connected`;
    },
    onClosed(code) {
      teardown();
      showMessage(root, closedText(code));
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
}
