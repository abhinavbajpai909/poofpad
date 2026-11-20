// Runs before first paint (see index.html) so the page never flashes the wrong theme.
// Keep the storage key in sync with src/client/theme.ts.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("theme");
  } catch {
    theme = null;
  }
  if (theme !== "dark" && theme !== "light") {
    theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.dataset.theme = theme;
})();
