import { onServerEvent } from "./live-reload.js";

// The branch's changes, shown wherever a reader is: a count on the header's Changes section, a
// letter beside each changed file in the tree with a switch to show only those, and on a changed
// document a line above its text leading to its diff. The Changes page itself is rendered on the
// server; these are fetched, like the findings, because every page shows them and none should wait
// for git to answer before it is drawn.

type ChangedDocument = {
  path: string;
  oldPath?: string;
  status: "A" | "M" | "D" | "R";
  added: number;
  removed: number;
  anchor: string;
};

type Changes =
  | { status: "ready"; documents: ChangedDocument[] }
  | { status: "unavailable"; message: string };

const STATUS_NAMES: Record<ChangedDocument["status"], string> = {
  A: "Added in this branch",
  M: "Modified in this branch",
  D: "Deleted in this branch",
  R: "Renamed in this branch",
};

// Remembered for this address, like the findings switch.
const FILTER_KEY = "wastech-mdlint-viewer:tree-changed-only";

export function initChanges(documentPath: string | undefined): void {
  // Drawn by the server only in a git work tree; without it there is nothing to review.
  const section = document.querySelector<HTMLAnchorElement>(
    '.section-nav a[href="/changes"]',
  );
  if (section === null) {
    return;
  }
  initFilter();
  const refresh = () => {
    void load(section, documentPath);
  };
  refresh();
  onServerEvent("change", refresh);
}

async function load(
  section: HTMLAnchorElement,
  documentPath: string | undefined,
): Promise<void> {
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
  markSection(section, data.status === "ready" ? data.documents.length : 0);
  markTree(changed);
  markDocument(documentPath, changed);
  filterReady = true;
  applyFilter();
}

function markSection(section: HTMLAnchorElement, count: number): void {
  section.querySelector(".segment-count")?.remove();
  if (count === 0) {
    return;
  }
  const badge = document.createElement("span");
  badge.className = "segment-count";
  badge.textContent = String(count);
  badge.title = `${count} changed ${count === 1 ? "document" : "documents"}`;
  section.append(badge);
}

function markTree(changed: Map<string, ChangedDocument>): void {
  for (const mark of document.querySelectorAll(".tree-change")) {
    mark.remove();
  }
  for (const item of document.querySelectorAll(".sidebar li[data-changed]")) {
    item.removeAttribute("data-changed");
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
    for (
      let item = link.closest("li");
      item !== null;
      item = item.parentElement?.closest(".sidebar li") ?? null
    ) {
      item.dataset.changed = "";
    }
  }
}

function markDocument(
  documentPath: string | undefined,
  changed: Map<string, ChangedDocument>,
): void {
  document.querySelector(".changes-banner")?.remove();
  const entry =
    documentPath === undefined ? undefined : changed.get(documentPath);
  const article = document.querySelector(".markdown-body");
  if (entry === undefined || article === null) {
    return;
  }
  const banner = document.createElement("p");
  banner.className = "changes-banner";
  const label = document.createElement("span");
  label.className = `tree-change tree-change-${entry.status}`;
  label.textContent = entry.status;
  const text = document.createElement("span");
  text.textContent =
    entry.oldPath === undefined
      ? `${STATUS_NAMES[entry.status]} · +${entry.added} −${entry.removed}`
      : `${STATUS_NAMES[entry.status]}, from ${entry.oldPath} · +${entry.added} −${entry.removed}`;
  const link = document.createElement("a");
  link.href = `/changes#${entry.anchor}`;
  link.textContent = "View diff";
  banner.append(label, text, link);
  article.prepend(banner);
}

// Set once the first answer is in: before that "not changed" only means "not asked yet", and the
// filter would hide the whole tree.
let filterReady = false;

function filterInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(".tree-filter-changes input");
}

function initFilter(): void {
  const label = document.querySelector<HTMLElement>(".tree-filter-changes");
  const input = filterInput();
  if (label === null || input === null) {
    return;
  }
  label.hidden = false;
  input.checked = readStored() === "1";
  input.addEventListener("change", () => {
    writeStored(input.checked ? "1" : "0");
    applyFilter();
  });
}

/**
 * Show only the changed files, and open the folders on the way to them. A folder this opened is
 * marked as the changes filter's own — apart from the findings filter's — so turning this one off
 * closes exactly what it opened, whatever the other switch is doing.
 */
function applyFilter(): void {
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  const input = filterInput();
  if (sidebar === null || input === null) {
    return;
  }
  const active = input.checked && filterReady;
  sidebar.classList.toggle("only-changed", active);
  for (const details of sidebar.querySelectorAll<HTMLDetailsElement>(
    "details",
  )) {
    const leadsToChange =
      details.parentElement?.hasAttribute("data-changed") === true;
    if (active && leadsToChange && !details.open) {
      details.open = true;
      details.dataset.openedByChangesFilter = "";
    } else if (!active && details.dataset.openedByChangesFilter !== undefined) {
      details.open = false;
      delete details.dataset.openedByChangesFilter;
    }
  }
  const empty = sidebar.querySelector<HTMLElement>(
    ".tree-filter-changes-empty",
  );
  if (empty !== null) {
    empty.hidden =
      !active || sidebar.querySelector("li[data-changed]") !== null;
  }
}

// Storage can be unavailable (private windows, blocked site data); the filter then starts off.
function readStored(): string | null {
  try {
    return localStorage.getItem(FILTER_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string): void {
  try {
    localStorage.setItem(FILTER_KEY, value);
  } catch {
    // The choice holds for this page only.
  }
}
