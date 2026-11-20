import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { CloseCode } from "../../shared/codes";
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

export function showPad(root: HTMLElement, padId: string): void {
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

  connectPad(padId, doc, awareness, {
    onStatus(next) {
      status.textContent = STATUS_LABELS[next];
    },
    onInfo(info) {
      peers.textContent = `${info.peers} connected`;
    },
    onClosed(code) {
      view.destroy();
      awareness.destroy();
      doc.destroy();
      showMessage(root, closedText(code));
    },
  });
}
