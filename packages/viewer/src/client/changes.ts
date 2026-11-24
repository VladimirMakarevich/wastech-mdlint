import { onServerEvent } from "./live-reload.js";

// The branch's changes, shown wherever a reader is: a count on the header's Changes section, and a
// letter beside each changed file in the tree with a switch to show only those. With review marks,
// the count is what is left to review, a dot marks each changed file not yet reviewed, and a second
// switch shows only those. Fetched, like the
// findings, because every page shows them and none but a document's own page should wait for git to
// answer before it is drawn. A changed document's page, which does wait, is marked on the server:
// the line above its text, its changed blocks and its outline.

type ReviewStatus = "unreviewed" | "reviewed" | "changed";

type ChangedDocument = {
  path: string;
  oldPath?: string;
  status: "A" | "M" | "D" | "R";
  review: { status: ReviewStatus } | null;
};

type Changes =
  | {
      status: "ready";
      documents: ChangedDocument[];
      review: { state: "ready"; left: number; total: number } | null;
    }
  | { status: "unavailable"; message: string };

const REVIEW_NAMES: Record<Exclude<ReviewStatus, "reviewed">, string> = {
  unreviewed: "Not reviewed yet",
  changed: "Changed since your review",
};

const STATUS_NAMES: Record<ChangedDocument["status"], string> = {
  A: "Added in this branch",
  M: "Modified in this branch",
  D: "Deleted in this branch",
  R: "Renamed in this branch",
};

// Remembered for this address, like the findings switch.
const FILTER_KEY = "wastech-mdlint-viewer:tree-changed-only";
const UNREVIEWED_KEY = "wastech-mdlint-viewer:tree-unreviewed-only";

export function initChanges(): void {
  // Drawn by the server only in a git work tree; without it there is nothing to review.
  const section = document.querySelector<HTMLAnchorElement>(
    '.section-nav a[href="/changes"]',
  );
  if (section === null) {
    return;
  }
  initFilter();
  const refresh = () => {
    void load(section);
  };
  refresh();
  onServerEvent("change", refresh);
  // A mark saved on any page changes what is left everywhere, and a commit, a checkout or a fetch
  // can change what changed at all.
  onServerEvent("review", refresh);
  onServerEvent("git", refresh);
}

async function load(section: HTMLAnchorElement): Promise<void> {
  let data: Changes;
  try {
    data = (await (await fetch("/api/changes")).json()) as Changes;
  } catch {
    // The server is restarting; the next change event or page load tries again.
    return;
  }
  const changed =
    data.status === "ready"
      ? new Map(data.documents.map((entry) => [entry.path, entry]))
      : new Map<string, ChangedDocument>();
  markSection(section, data);
  markTree(changed);
  filterReady = true;
  applyFilter();
}

function markSection(section: HTMLAnchorElement, data: Changes): void {
  section.querySelector(".segment-count")?.remove();
  const count = data.status === "ready" ? data.documents.length : 0;
  if (count === 0) {
    return;
  }
  const badge = document.createElement("span");
  badge.className = "segment-count";
  const review = data.status === "ready" ? data.review : null;
  if (review?.state !== "ready") {
    badge.textContent = String(count);
    badge.title = `${count} changed ${count === 1 ? "document" : "documents"}`;
  } else {
    // What is left, against everything that changed: the queue a reviewer works down.
    badge.textContent = `${review.left}/${review.total}`;
    badge.title = `${review.left} of ${review.total} changed ${review.total === 1 ? "document" : "documents"} left to review`;
    badge.classList.toggle("is-done", review.left === 0);
  }
  section.append(badge);
}

function markTree(changed: Map<string, ChangedDocument>): void {
  for (const mark of document.querySelectorAll(
    ".tree-change, .tree-review-dot",
  )) {
    mark.remove();
  }
  for (const item of document.querySelectorAll(
    ".sidebar li[data-changed], .sidebar li[data-unreviewed]",
  )) {
    item.removeAttribute("data-changed");
    item.removeAttribute("data-unreviewed");
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    '.sidebar a[href^="/doc/"]',
  )) {
    const relPath = decodeURIComponent(
      link.getAttribute("href")!.slice("/doc/".length),
    );
    const entry = changed.get(relPath);
    if (entry === undefined) {
      continue;
    }
    const mark = document.createElement("span");
    mark.className = `tree-change tree-change-${entry.status}`;
    mark.textContent = entry.status;
    mark.title =
      entry.oldPath === undefined
        ? STATUS_NAMES[entry.status]
        : `${STATUS_NAMES[entry.status]}, from ${entry.oldPath}`;
    // Before a findings count, so the two read in the same place on every row that has both.
    const badge = link.querySelector(".tree-badge");
    if (badge === null) {
      link.append(mark);
    } else {
      badge.before(mark);
    }
    const left =
      entry.review !== null && entry.review.status !== "reviewed"
        ? entry.review.status
        : undefined;
    if (left !== undefined) {
      const dot = document.createElement("span");
      dot.className = `tree-review-dot tree-review-${left}`;
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", REVIEW_NAMES[left]);
      dot.title = REVIEW_NAMES[left];
      mark.after(dot);
    }
    for (
      let item = link.closest("li");
      item !== null;
      item = item.parentElement?.closest(".sidebar li") ?? null
    ) {
      item.dataset.changed = "";
      if (left !== undefined) {
        item.dataset.unreviewed = "";
      }
    }
  }
}

// Set once the first answer is in: before that "not changed" only means "not asked yet", and the
// filter would hide the whole tree.
let filterReady = false;

function filterInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(".tree-filter-changes input");
}

// Drawn only where review marks are on.
function unreviewedInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    ".tree-filter-unreviewed input",
  );
}

function initFilter(): void {
  const switches: [HTMLInputElement | null, string][] = [
    [filterInput(), FILTER_KEY],
    [unreviewedInput(), UNREVIEWED_KEY],
  ];
  for (const [input, key] of switches) {
    const label = input?.closest<HTMLElement>(".tree-filter");
    if (input === null || label === null || label === undefined) {
      continue;
    }
    label.hidden = false;
    input.checked = readStored(key) === "1";
    input.addEventListener("change", () => {
      writeStored(key, input.checked ? "1" : "0");
      applyFilter();
    });
  }
}

/**
 * Show only the changed files — or only those left to review, which are among them — and open the
 * folders on the way to them. A folder this opened is marked as the changes filters' own — apart
 * from the findings filter's — so turning them off closes exactly what they opened, whatever the
 * other switch is doing.
 */
function applyFilter(): void {
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  const input = filterInput();
  if (sidebar === null || input === null) {
    return;
  }
  const unreviewed = unreviewedInput()?.checked === true && filterReady;
  const active = (input.checked || unreviewed) && filterReady;
  const attribute = unreviewed ? "data-unreviewed" : "data-changed";
  sidebar.classList.toggle("only-changed", active && !unreviewed);
  sidebar.classList.toggle("only-unreviewed", unreviewed);
  syncFilterFolders(sidebar, active, attribute);
  const empty = sidebar.querySelector<HTMLElement>(
    ".tree-filter-changes-empty",
  );
  if (empty !== null) {
    empty.textContent = unreviewed
      ? "Nothing left to review."
      : "No document changed.";
    empty.hidden =
      !active || sidebar.querySelector(`li[${attribute}]`) !== null;
  }
}

/**
 * Open the folders leading to a marked file while a filter is on, and close again only those the
 * filter itself opened once it is off, so a folder the reader opened by hand stays as they left it.
 */
function syncFilterFolders(
  sidebar: HTMLElement,
  active: boolean,
  attribute: string,
): void {
  for (const details of sidebar.querySelectorAll<HTMLDetailsElement>(
    "details",
  )) {
    const leadsToChange =
      details.parentElement?.hasAttribute(attribute) === true;
    if (active && leadsToChange && !details.open) {
      details.open = true;
      details.dataset.openedByChangesFilter = "";
    } else if (!active && details.dataset.openedByChangesFilter !== undefined) {
      details.open = false;
      delete details.dataset.openedByChangesFilter;
    }
  }
}

// Storage can be unavailable (private windows, blocked site data); the filter then starts off.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice holds for this page only.
  }
}
