// Keeps the document tree where the reader left it from one page to the next. Every page is a full
// load whose server-rendered tree opens only the folders on the way to the page's own document and
// starts scrolled to the top, so a reader stepping through the files of one folder deep in the tree
// had to scroll back down to it after every click.
//
// A classic, blocking script placed right after the tree, like `theme.ts` in the head: it has to run
// before the tree is first painted, or the tree would show at the top and then jump. It restores the
// folders that were open and the tree's scroll position, which together put every row back where it
// was; the document just opened, already marked by the server, therefore stays under the pointer
// that clicked it. Kept per tab, since two tabs on two parts of the tree are two places.
(() => {
  const STORAGE_KEY = "wastech-mdlint-viewer:tree";
  const tree = document.querySelector<HTMLElement>(".sidebar");
  const list = tree?.querySelector<HTMLElement>(
    ":scope > .sidebar-disclosure > .tree",
  );
  if (tree === null || list === null || list === undefined) {
    return;
  }

  // On a phone the tree folds behind its "Documents" row, closed on every page so the article is what
  // a page opens on; closed here, before the first paint, it never shows open and then collapses. The
  // width is the stylesheet's narrow-screen breakpoint, where the row is drawn at all. A window
  // widened past it opens the tree again, since there the row that would reopen it is not drawn.
  const disclosure = list.parentElement as HTMLDetailsElement;
  const narrow = matchMedia("(max-width: 800px)");
  if (narrow.matches) {
    disclosure.open = false;
  }
  narrow.addEventListener("change", () => {
    if (!narrow.matches) {
      disclosure.open = true;
    }
  });

  // The findings-only switch above the list is shown by the module that wires it, which runs after
  // this script; shown only then, it would push every row down by its height after the scroll had
  // been restored. Showing it here leaves nothing above the list to change size.
  const filter = tree.querySelector<HTMLElement>(".tree-filter");
  if (filter !== null) {
    filter.hidden = false;
  }

  // The scroll is kept as the distance into the list rather than into the column, so anything that
  // is above the list on one page and not on the next cannot shift the rows.
  type Saved = { open: string[]; scrolledIntoList: number };

  // Where the list starts within the tree's scrolled content, measured on screen rather than with
  // `offsetTop`, whose reference is whichever ancestor happens to be positioned.
  const listStart = () =>
    list.getBoundingClientRect().top -
    tree.getBoundingClientRect().top +
    tree.scrollTop;

  let saved: Saved | undefined;
  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Saved | null;
    if (
      parsed !== null &&
      Array.isArray(parsed.open) &&
      typeof parsed.scrolledIntoList === "number"
    ) {
      saved = parsed;
    }
  } catch {
    // Storage blocked or unreadable: the tree opens as the server drew it.
  }

  if (saved !== undefined) {
    const open = new Set(saved.open);
    for (const folder of tree.querySelectorAll<HTMLDetailsElement>(
      "details[data-folder]",
    )) {
      if (open.has(folder.dataset.folder ?? "")) {
        folder.open = true;
      }
    }
    tree.scrollTop = listStart() + saved.scrolledIntoList;
  }

  // Reached some other way — a link in an article, search, the graph — the document may lie outside
  // the restored view; then it is brought to the middle, leaving the tree alone when it is in sight.
  const current = tree.querySelector<HTMLElement>('a[aria-current="page"]');
  if (current !== null) {
    const view = tree.getBoundingClientRect();
    const row = current.getBoundingClientRect();
    if (row.top < view.top || row.bottom > view.bottom) {
      tree.scrollTop += row.top - view.top - (view.height - row.height) / 2;
    }
  }

  // Saved as the page goes, which covers a click in the tree, any other link, a reload and the
  // back button alike. Folders the findings-only switch opened are its own and are left out, so
  // turning the switch off still closes them.
  window.addEventListener("pagehide", () => {
    const open = [
      ...tree.querySelectorAll<HTMLDetailsElement>("details[data-folder]"),
    ]
      .filter(
        (folder) => folder.open && folder.dataset.openedByFilter === undefined,
      )
      .map((folder) => folder.dataset.folder ?? "");
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          open,
          scrolledIntoList: tree.scrollTop - listStart(),
        } satisfies Saved),
      );
    } catch {
      // Nothing is kept; the next page opens the tree as the server drew it.
    }
  });
})();
