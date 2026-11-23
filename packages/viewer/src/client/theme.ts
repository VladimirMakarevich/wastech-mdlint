// Loaded in <head> as a classic, blocking script — the one script on the page that is not a deferred
// module — because it has to run before the first paint. Applied any later, a page whose reader chose
// dark would flash light on every navigation. It only reads the stored choice; the header switch
// that writes it lives in `theme-toggle.ts`, which uses the same storage key.
(() => {
  try {
    const stored = localStorage.getItem("wastech-mdlint-viewer:theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
    }
  } catch {
    // Storage can be blocked; the page then follows the system theme, which is the default anyway.
  }
})();
