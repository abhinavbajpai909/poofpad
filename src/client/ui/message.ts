export function showMessage(root: HTMLElement, text: string): void {
  const page = document.createElement("section");
  page.className = "message";
  const heading = document.createElement("h1");
  heading.textContent = text;
  page.append(heading);
  root.replaceChildren(page);
}
