import { encode } from "uqr";
import { showDialog } from "./dialog";
import { el } from "./dom";

const SVG_NS = "http://www.w3.org/2000/svg";
const QUIET_ZONE_MODULES = 4;

/** One SVG path, built with DOM calls (no HTML parsing); always dark on white so phones can scan it. */
function qrSvg(text: string): SVGSVGElement {
  const { data, size } = encode(text, { border: 0 });
  let path = "";
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        path += `M${x + QUIET_ZONE_MODULES} ${y + QUIET_ZONE_MODULES}h1v1h-1z`;
      }
    });
  });
  const total = size + QUIET_ZONE_MODULES * 2;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${total} ${total}`);
  svg.setAttribute("class", "qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code of the pad link");
  svg.setAttribute("shape-rendering", "crispEdges");
  const background = document.createElementNS(SVG_NS, "rect");
  background.setAttribute("width", String(total));
  background.setAttribute("height", String(total));
  background.setAttribute("fill", "#ffffff");
  const modules = document.createElementNS(SVG_NS, "path");
  modules.setAttribute("d", path);
  modules.setAttribute("fill", "#000000");
  svg.append(background, modules);
  return svg;
}

export function showQrDialog(link: string): void {
  showDialog(
    "Scan to open this pad",
    [
      qrSvg(link),
      el("code", "qr-link", link),
      el(
        "p",
        "dialog-note",
        "Check that the address above matches. The code and link contain the key.",
      ),
    ],
    [{ label: "Close", primary: true }],
  );
}
