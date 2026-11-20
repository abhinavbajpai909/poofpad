/**
 * Keeps `--app-height` equal to the visible viewport, so the on-screen keyboard (which iOS Safari
 * overlays instead of resizing the page) never covers the editor. Returns a function that stops it.
 */
export function trackVisualViewport(): () => void {
  const viewport = window.visualViewport;
  if (viewport === null) {
    return () => undefined;
  }
  const root = document.documentElement;
  function update(): void {
    if (viewport !== null) {
      root.style.setProperty("--app-height", `${viewport.height}px`);
      window.scrollTo(0, 0);
    }
  }
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    root.style.removeProperty("--app-height");
  };
}
