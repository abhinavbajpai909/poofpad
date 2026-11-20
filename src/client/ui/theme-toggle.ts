import { type Theme, currentTheme, onThemeChange, toggleTheme } from "../theme";
import { button } from "./dom";

function label(theme: Theme): string {
  return theme === "dark" ? "Light theme" : "Dark theme";
}

/** Returns the button and a function that stops it following theme changes. */
export function createThemeToggle(): { element: HTMLButtonElement; stop: () => void } {
  const element = button(label(currentTheme()), "btn", toggleTheme);
  const stop = onThemeChange((theme) => {
    element.textContent = label(theme);
  });
  return { element, stop };
}
