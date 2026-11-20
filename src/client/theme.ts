export type Theme = "dark" | "light";

const STORAGE_KEY = "theme";

const listeners = new Set<(theme: Theme) => void>();

/** The theme was already applied to <html> by theme-init.js before first paint. */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not remembered; the theme still applies for this visit.
  }
  for (const listener of listeners) {
    listener(theme);
  }
}

export function toggleTheme(): void {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
}

export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
