export function showMessage(root: HTMLElement, text: string, detail?: string): void {
  const page = document.createElement("section");
  page.className = "message";
  const heading = document.createElement("h1");
  heading.textContent = text;
  page.append(heading);
  if (detail !== undefined) {
    const paragraph = document.createElement("p");
    paragraph.textContent = detail;
    page.append(paragraph);
  }
  root.replaceChildren(page);
}
