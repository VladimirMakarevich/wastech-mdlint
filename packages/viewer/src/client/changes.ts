import { onServerEvent } from "./live-reload.js";
import {
  changeLetter,
  changesCount,
  drawnByServer,
  markElement,
  reviewDot,
  type ChangeLetter,
  type ReviewStatus,
} from "./tree-marks.js";

// The branch's changes, shown wherever a reader is: a count on the header's Changes section, and a
// letter beside each changed file in the tree with a switch to show only those. With review marks,
// the count is what is left to review, a dot marks each changed file not yet reviewed, and a second
// switch shows only those. The server draws them into every page from the review it keeps, without
// asking git again, so no page but a document's own waits for git before it is drawn; they are asked
// for here when an event says they moved, and as the page opens when the server had none to draw or
// no watcher to say when they move.

type ChangedDocument = {
  path: string;
  oldPath?: string;
  status: ChangeLetter;
  review: { status: ReviewStatus } | null;
};

type Changes =
  | {
      status: "ready";
      documents: ChangedDocument[];
      review:
        | { state: "ready"; left: number; total: number }
        | { state: "unavailable" }
        | null;
    }
  | { status: "unavailable"; message: string };

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
  if (drawnByServer("changes")) {
    filterReady = true;
  } else {
    refresh();
  }
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
  if (data.status !== "ready") {
    return;
  }
  const review = data.review?.state === "ready" ? data.review : null;
  const count = changesCount(
    data.documents.length,
    review === null ? null : { left: review.left, total: review.total },
  );
  if (count !== undefined) {
    section.append(markElement(count));
  }
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
    if (entry !== undefined) {
      markFile(link, entry);
    }
  }
}

// The letter and the dot on one file's row, and the flags its row and every folder above it carry
// for the switches.
function markFile(link: HTMLAnchorElement, entry: ChangedDocument): void {
  const mark = markElement(changeLetter(entry));
  // Before a findings count, so the two read in the same place on every row that has both.
  const badge = link.querySelector(".tree-badge");
  if (badge === null) {
    link.append(mark);
  } else {
    badge.before(mark);
  }
  const dot = reviewDot(entry.review?.status ?? null);
  if (dot !== undefined) {
    mark.after(markElement(dot));
  }
  for (
    let item = link.closest("li");
    item !== null;
    item = item.parentElement?.closest(".sidebar li") ?? null
  ) {
    item.dataset.changed = "";
    if (dot !== undefined) {
      item.dataset.unreviewed = "";
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
