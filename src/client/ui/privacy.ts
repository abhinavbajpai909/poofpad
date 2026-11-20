import { el } from "./dom";

const SECTIONS: readonly (readonly [heading: string, body: string])[] = [
  [
    "What PoofPad is",
    "PoofPad is a shared text pad. Whoever has the full link can read and edit it live. " +
      "The person who creates a pad chooses when it is deleted, up to 24 hours.",
  ],
  [
    "Encrypted end to end",
    "Your text is encrypted in your browser before it leaves your device. The key lives in the part " +
      "of the link after the # sign, which browsers never send to any server. The server only ever " +
      "holds encrypted data and cannot read your pads.",
  ],
  [
    "Anyone with the full link can read and edit",
    "There are no passwords or accounts. Treat the link like the pad itself: anyone who has it, " +
      "including the part after the #, can read and change the text. Share it only with people you trust.",
  ],
  [
    "What the server can see",
    "The server can see that a pad exists, when it was created, when it expires, how large it is, " +
      "and how many people are connected at a time. It cannot see the text, the key, or what anyone types.",
  ],
  [
    "Deletion",
    "When a pad reaches its expiry time, or its creator ends it, everything stored for it is deleted " +
      "and every open copy shows that the pad has expired. Nothing is kept afterwards.",
  ],
  [
    "No tracking",
    "PoofPad has no accounts, no cookies, no analytics and no third-party scripts, fonts or services. " +
      "Your browser stores a few settings locally on your device: your theme, your display name and " +
      "colour, and, for pads you created, a token that lets you end them early.",
  ],
];

export function showPrivacy(root: HTMLElement): void {
  document.title = "Privacy · PoofPad";
  const page = el("article", "prose");
  page.append(el("h1", undefined, "Privacy"));
  for (const [heading, body] of SECTIONS) {
    page.append(el("h2", undefined, heading), el("p", undefined, body));
  }
  const home = el("a", "btn btn-primary", "Back to PoofPad");
  home.href = "/";
  page.append(home);
  const scroller = el("div", "scroll-page");
  scroller.append(page);
  root.replaceChildren(scroller);
}
