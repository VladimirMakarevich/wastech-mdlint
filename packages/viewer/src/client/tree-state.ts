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

  // The switches above the list — findings only, and changed files only where the repository has a
  // branch to review — are wired by modules that run after this script; shown only then, they would
  // push every row down by their height after the scroll had been restored. Showing them here leaves
  // nothing above the list to change size.
  for (const filter of tree.querySelectorAll<HTMLElement>(".tree-filter")) {
    filter.hidden = false;
  }

  // A switch the reader left on narrows the tree here, before the first paint, when the server drew
  // the marks it narrows to: narrowed only once its module had run, the whole tree showed first, the
  // switch slid on, and then most rows vanished under the restored scroll position. This repeats
  // what `applyTreeFilter` in `diagnostics.ts` and `applyFilter` in `changes.ts` do for the same
  // switches and storage keys, which a classic script cannot import; those modules take over from
  // here and leave this state as it is, since their data is the same.
  function storedOn(key: string): boolean {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  // Opens the folders on the way to the rows `attribute` flags, marked as `opener`'s, so turning the
  // switch off closes them again; says so when no row is flagged.
  function openTowardFlagged(
    scroller: HTMLElement,
    attribute: string,
    opener: "openedByFilter" | "openedByChangesFilter",
    empty: HTMLElement | null,
  ): void {
    for (const folder of scroller.querySelectorAll<HTMLDetailsElement>(
      "details",
    )) {
      if (
        folder.parentElement?.hasAttribute(attribute) === true &&
        !folder.open
      ) {
        folder.open = true;
        folder.dataset[opener] = "";
      }
    }
    if (empty !== null) {
      empty.hidden = scroller.querySelector(`li[${attribute}]`) !== null;
    }
  }

  function switchOf(scroller: HTMLElement, name: string) {
    return scroller.querySelector<HTMLInputElement>(
      `.tree-filter-${name} input`,
    );
  }

  function narrowToStoredSwitches(scroller: HTMLElement): void {
    const marked = (scroller.dataset.marked ?? "").split(" ");
    const findings = switchOf(scroller, "findings");
    if (
      marked.includes("findings") &&
      findings !== null &&
      storedOn("wastech-mdlint-viewer:tree-findings-only")
    ) {
      findings.checked = true;
      scroller.classList.add("only-findings");
      openTowardFlagged(
        scroller,
        "data-findings",
        "openedByFilter",
        scroller.querySelector(".tree-filter-findings-empty"),
      );
    }
    const changed = switchOf(scroller, "changes");
    if (!marked.includes("changes") || changed === null) {
      return;
    }
    const unreviewed = switchOf(scroller, "unreviewed");
    changed.checked = storedOn("wastech-mdlint-viewer:tree-changed-only");
    const leftOnly =
      unreviewed !== null &&
      storedOn("wastech-mdlint-viewer:tree-unreviewed-only");
    if (unreviewed !== null) {
      unreviewed.checked = leftOnly;
    }
    if (!changed.checked && !leftOnly) {
      return;
    }
    scroller.classList.add(leftOnly ? "only-unreviewed" : "only-changed");
    const empty = scroller.querySelector<HTMLElement>(
      ".tree-filter-changes-empty",
    );
    if (empty !== null) {
      empty.textContent = leftOnly
        ? "Nothing left to review."
        : "No document changed.";
    }
    openTowardFlagged(
      scroller,
      leftOnly ? "data-unreviewed" : "data-changed",
      "openedByChangesFilter",
      empty,
    );
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

  // Declared inside the wrapper rather than at the top level: in a classic script a top-level
  // function is a global, shared with every other classic script on the page.
  function readSaved(): Saved | undefined {
    try {
      const parsed = JSON.parse(
        sessionStorage.getItem(STORAGE_KEY) ?? "null",
      ) as Saved | null;
      if (
        parsed !== null &&
        Array.isArray(parsed.open) &&
        typeof parsed.scrolledIntoList === "number"
      ) {
        return parsed;
      }
    } catch {
      // Storage blocked or unreadable: the tree opens as the server drew it.
    }
    return undefined;
  }

  // Reached some other way — a link in an article, search, the graph — the document may lie outside
  // the restored view; then it is brought to the middle, leaving the tree alone when it is in sight.
  function centerCurrent(scroller: HTMLElement): void {
    const current = scroller.querySelector<HTMLElement>(
      'a[aria-current="page"]',
    );
    if (current === null) {
      return;
    }
    const view = scroller.getBoundingClientRect();
    const row = current.getBoundingClientRect();
    if (row.top < view.top || row.bottom > view.bottom) {
      scroller.scrollTop += row.top - view.top - (view.height - row.height) / 2;
    }
  }

  // Folders a switch opened are that switch's own and are left out, so turning it off still closes
  // them.
  function openFolders(scroller: HTMLElement): string[] {
    return [
      ...scroller.querySelectorAll<HTMLDetailsElement>("details[data-folder]"),
    ]
      .filter(
        (folder) =>
          folder.open &&
          folder.dataset.openedByFilter === undefined &&
          folder.dataset.openedByChangesFilter === undefined,
      )
      .map((folder) => folder.dataset.folder ?? "");
  }

  const saved = readSaved();
  if (saved !== undefined) {
    const open = new Set(saved.open);
    for (const folder of tree.querySelectorAll<HTMLDetailsElement>(
      "details[data-folder]",
    )) {
      if (open.has(folder.dataset.folder ?? "")) {
        folder.open = true;
      }
    }
  }
  // After the reader's own folders, so a folder they had open is not taken for one a switch opened,
  // and before the scroll, which was saved in the tree as narrowed.
  narrowToStoredSwitches(tree);
  if (saved !== undefined) {
    tree.scrollTop = listStart() + saved.scrolledIntoList;
  }

  centerCurrent(tree);

  // Saved as the page goes, which covers a click in the tree, any other link, a reload and the
  // back button alike.
  window.addEventListener("pagehide", () => {
    const open = openFolders(tree);
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
