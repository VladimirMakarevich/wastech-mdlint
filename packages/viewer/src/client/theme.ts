// Loaded in <head> as a classic, blocking script — the one script on the page that is not a deferred
// module — because it has to run before the first paint. Applied any later, a page whose reader chose
// dark would flash light on every navigation, and a widened side column would snap back to its
// default width and then jump. It only reads what was stored; the header switch that writes the
// theme lives in `theme-toggle.ts` and the column edge handles that write the widths in
// `column-resize.ts`, each with the same storage keys as here.
(() => {
  try {
    const stored = localStorage.getItem("wastech-mdlint-viewer:theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
    }
    for (const [key, variable] of [
      ["wastech-mdlint-viewer:sidebar-width", "--sidebar-width"],
      ["wastech-mdlint-viewer:rail-width", "--rail-width"],
    ] as const) {
      const width = Number(localStorage.getItem(key));
      if (width > 0) {
        // Capped by the window it opens in, which may be narrower than the one it was set in; at
        // two fifths each, both columns at their cap still leave the article a fifth of it.
        document.documentElement.style.setProperty(
          variable,
          `min(${width}px, 40vw)`,
        );
      }
    }
  } catch {
    // Storage can be blocked; the page then uses the defaults: the system theme and default widths.
  }
})();
