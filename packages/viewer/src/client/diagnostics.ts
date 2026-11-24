import { onServerEvent } from "./live-reload.js";
import { initPromptButtons } from "./prompts.js";
import { drawnByServer, findingsBadge, markElement } from "./tree-marks.js";

// wastech-mdlint's findings, shown where they apply: a panel above the document they are about, and
// a count beside every file in the tree that has any. The server draws both into the page once its
// first lint is in, and lints again after every change, announcing a `diagnostics` event when the new
// results are in; only then are they asked for here and drawn again. A page served before the first
// lint finished has neither, and asks as it opens.
//
// A page reloaded after a save has its findings right: the server lints on the same turn it tells
// the pages of the change, so the reload is answered after the lint.

type Summary =
  | { status: "pending" }
  | {
      status: "ready";
      files: Record<string, { errors: number; warnings: number }>;
    };

// Remembered for this address, like the theme and the column widths.
const TREE_FILTER_KEY = "wastech-mdlint-viewer:tree-findings-only";

export function initDiagnostics(documentPath: string | undefined): void {
  initTreeFilter();
  // The panel's buttons as the server drew them.
  const drawn = document.querySelector(".diagnostics");
  if (drawn !== null) {
    initPromptButtons(drawn);
  }
  const refresh = () => {
    void refreshTree();
    if (documentPath !== undefined) {
      void refreshPanel(documentPath);
    }
  };
  if (drawnByServer("findings")) {
    treeFilterReady = true;
  } else {
    refresh();
  }
  onServerEvent("diagnostics", refresh);
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    return (await (await fetch(url)).json()) as T;
  } catch {
    // The server is restarting; the next `diagnostics` event or page load tries again.
    return undefined;
  }
}

/**
 * Put the server's panel for the document in place of the one shown, keeping it folded if the
 * reader folded it. Nothing changes while the server's first lint is still running (`204`), and the
 * panel goes when the document has no findings left (an empty answer).
 */
async function refreshPanel(documentPath: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `/api/diagnostics/panel?path=${encodeURIComponent(documentPath)}`,
    );
  } catch {
    return;
  }
  if (response.status !== 200) {
    return;
  }
  const html = await response.text();
  const next = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector<HTMLDetailsElement>("details.diagnostics");
  const shown = document.querySelector<HTMLDetailsElement>(".diagnostics");
  if (next === null) {
    shown?.remove();
    return;
  }
  const placed = document.importNode(next, true);
  if (shown === null) {
    document.querySelector(".markdown-body")?.prepend(placed);
  } else {
    placed.open = shown.open;
    shown.replaceWith(placed);
  }
  initPromptButtons(placed);
}

async function refreshTree(): Promise<void> {
  const data = await fetchJson<Summary>("/api/diagnostics");
  if (data?.status !== "ready") {
    return;
  }
  for (const badge of document.querySelectorAll(".tree-badge")) {
    badge.remove();
  }
  for (const item of document.querySelectorAll(".sidebar li[data-findings]")) {
    item.removeAttribute("data-findings");
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    '.sidebar a[href^="/doc/"]',
  )) {
    const relPath = decodeURIComponent(
      link.getAttribute("href")!.slice("/doc/".length),
    );
    const counts = Object.hasOwn(data.files, relPath)
      ? data.files[relPath]
      : undefined;
    if (counts === undefined) {
      continue;
    }
    link.append(markElement(findingsBadge(counts)));
    // The file's row and every folder above it, so the filter below can keep the way to it open.
    for (
      let item = link.closest("li");
      item !== null;
      item = item.parentElement?.closest(".sidebar li") ?? null
    ) {
      item.dataset.findings = "";
    }
  }
  treeFilterReady = true;
  applyTreeFilter();
}

// Set once the first findings are in: before that "no findings" only means "not checked yet", and the
// filter would hide the whole tree.
let treeFilterReady = false;

function treeFilterInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    ".tree-filter-findings input",
  );
}

function initTreeFilter(): void {
  const label = document.querySelector<HTMLElement>(".tree-filter-findings");
  const input = treeFilterInput();
  if (label === null || input === null) {
    return;
  }
  // Rendered hidden by the server: without this script the switch could do nothing.
  label.hidden = false;
  input.checked = readStored() === "1";
  input.addEventListener("change", () => {
    writeStored(input.checked ? "1" : "0");
    applyTreeFilter();
  });
}

/**
 * Show only the files with findings, and open the folders on the way to them. A folder this opened is
 * marked, so turning the filter off closes it again and leaves the tree as the reader had it.
 */
function applyTreeFilter(): void {
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  const input = treeFilterInput();
  if (sidebar === null || input === null) {
    return;
  }
  const active = input.checked && treeFilterReady;
  sidebar.classList.toggle("only-findings", active);
  for (const details of sidebar.querySelectorAll<HTMLDetailsElement>(
    "details",
  )) {
    const leadsToFindings =
      details.parentElement?.hasAttribute("data-findings") === true;
    if (active && leadsToFindings && !details.open) {
      details.open = true;
      details.dataset.openedByFilter = "";
    } else if (!active && details.dataset.openedByFilter !== undefined) {
      details.open = false;
      delete details.dataset.openedByFilter;
    }
  }
  const empty = sidebar.querySelector<HTMLElement>(
    ".tree-filter-findings-empty",
  );
  if (empty !== null) {
    empty.hidden =
      !active || sidebar.querySelector("li[data-findings]") !== null;
  }
}

// Storage can be unavailable (private windows, blocked site data); the filter then starts off.
function readStored(): string | null {
  try {
    return localStorage.getItem(TREE_FILTER_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string): void {
  try {
    localStorage.setItem(TREE_FILTER_KEY, value);
  } catch {
    // The choice holds for this page only.
  }
}
