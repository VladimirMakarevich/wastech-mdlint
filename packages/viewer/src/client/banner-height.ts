// The line above a changed document stays pinned under the header while the text scrolls, so a jump
// to a heading has to land below both — and so does the outline's idea of which section is being
// read, which it takes from the same scroll padding. The stylesheet assumes the line stands on one
// row, its height at any width wide enough to pin it; at a narrower one its controls wrap onto a
// second row and a heading would land under it. This keeps the stylesheet's figure to the line's
// real height as it changes: wrapping as the window narrows, a baseline switch appearing once a
// review is marked. Without script the one-row figure still holds wherever the line fits on a row.

export function initBannerHeight(): void {
  const banner = document.querySelector<HTMLElement>(
    ".markdown-body > .changes-banner",
  );
  if (banner === null) {
    return;
  }
  const root = document.documentElement;
  let first = true;
  new ResizeObserver(() => {
    root.style.setProperty("--banner-height", `${banner.offsetHeight}px`);
    if (first) {
      first = false;
      // A page opened at a heading was scrolled to it before this script ran, by the one-row
      // figure; on a wrapped line that left the heading under it, so it is scrolled to again.
      const target = targetOfHash();
      if (
        target !== null &&
        target.getBoundingClientRect().top <
          banner.getBoundingClientRect().bottom
      ) {
        target.scrollIntoView();
      }
    }
  }).observe(banner);
}

function targetOfHash(): HTMLElement | null {
  const id = decodeURIComponent(location.hash.slice(1));
  return id === "" ? null : document.getElementById(id);
}
