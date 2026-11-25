// Loaded in <head> as a classic, blocking script - like `tree-state.ts` after the tree, not a deferred
// module - because it has to run before the first paint. Applied any later, a page whose reader chose
// dark would flash light on every navigation, and a widened side column would snap back to its
// default width and then jump. It only reads what was stored; the header switch that writes the
// theme lives in `theme-toggle.ts`, the column edge handles that write the widths in
// `column-resize.ts` and the display settings panel in `display-settings.ts`, each with the same
// storage keys as here.
(() => {
  // Says that script runs here. The header's script-driven controls are rendered `hidden`, since
  // without script they could do nothing; the stylesheet lays them out under this mark from the very
  // first paint instead of waiting for the deferred module that wires them, which on a long page can
  // run after the bar is drawn and would then push the search box and the links aside on every page.
  document.documentElement.dataset.script = "";
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
    // The reader's display settings, as the custom properties the panel in `display-settings.ts`
    // computed from them and stored beside them. This script cannot import that module, so it takes
    // the finished values and sets only properties named like the panel's own - `--reader-…` - which
    // the stylesheet reads with its defaults as fallbacks. The key and the name pattern are
    // `STORAGE_KEY` and `VARIABLE_NAME` in `display-settings-model.ts`, and a test holds them equal.
    const display = JSON.parse(
      localStorage.getItem("wastech-mdlint-viewer:display") ?? "null",
    ) as { vars?: unknown } | null;
    const vars = display?.vars;
    if (typeof vars === "object" && vars !== null) {
      for (const [name, value] of Object.entries(vars)) {
        if (/^--reader-[a-z-]+$/.test(name) && typeof value === "string") {
          document.documentElement.style.setProperty(name, value);
        }
      }
    }
  } catch {
    // Storage can be blocked, or hold something that is not JSON; the page then uses the defaults:
    // the system theme, default widths and the stylesheet's own text settings.
  }
})();
