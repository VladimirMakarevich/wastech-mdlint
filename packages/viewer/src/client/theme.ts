// Loaded in <head> as a classic, blocking script — the one script on the page that is not a deferred
// module — because it has to run before the first paint. Applied any later, a page whose reader chose
// dark would flash light on every navigation, and a widened document tree would snap back to the
// default width and then jump. It only reads what was stored; the header switch that writes the
// theme lives in `theme-toggle.ts` and the tree's edge handle that writes the width in
// `sidebar-resize.ts`, each with the same storage key as here.
(() => {
  try {
    const stored = localStorage.getItem("wastech-mdlint-viewer:theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
    }
    const width = Number(
      localStorage.getItem("wastech-mdlint-viewer:sidebar-width"),
    );
    if (width > 0) {
      // Capped by the window it opens in, which may be narrower than the one it was set in.
      document.documentElement.style.setProperty(
        "--sidebar-width",
        `min(${width}px, 50vw)`,
      );
    }
  } catch {
    // Storage can be blocked; the page then uses the defaults: the system theme and the default width.
  }
})();
