import type { ActiveUser } from "../awareness-user";
import type { Identity } from "../identity";
import { MAX_NAME_LENGTH } from "../name";
import { el } from "./dom";

export interface UserList {
  element: HTMLElement;
  /** Also the source of the people count shown elsewhere. */
  setUsers(users: readonly ActiveUser[]): void;
}

function dot(color: string): HTMLElement {
  const element = el("span", "user-dot");
  element.style.backgroundColor = color;
  element.setAttribute("aria-hidden", "true");
  return element;
}

/**
 * Your own row is created once, so editing your name is never interrupted by a rebuild; only the other
 * people's rows are replaced when the list changes. Names are only ever set through textContent / value,
 * and colours reaching here are already validated (awareness-user.ts).
 */
export function createUserList(identity: Identity, onName: (name: string) => string): UserList {
  const element = el("section", "sidebar-section");
  const heading = el("h2", "sidebar-heading", "Active users (1)");
  const list = el("ul", "user-list");

  const own = el("li", "user-row");
  const name = el("input", "control user-name");
  name.type = "text";
  name.value = identity.name;
  name.maxLength = MAX_NAME_LENGTH;
  name.autocomplete = "off";
  name.spellcheck = false;
  name.setAttribute("aria-label", "Your name (you)");
  name.addEventListener("change", () => {
    name.value = onName(name.value);
  });
  const ownDot = dot(identity.color);
  own.append(ownDot, name, el("span", "user-you", "(you)"));

  list.append(own);
  element.append(heading, list);

  return {
    element,
    setUsers(users) {
      heading.textContent = `Active users (${users.length})`;
      const rows: HTMLElement[] = [];
      for (const user of users) {
        if (!user.self) {
          const row = el("li", "user-row");
          row.append(dot(user.color), el("span", "user-label", user.name));
          rows.push(row);
        }
      }
      list.replaceChildren(own, ...rows);
    },
  };
}
