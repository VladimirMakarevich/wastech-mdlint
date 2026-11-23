import { onServerEvent } from "./live-reload.js";
import { initPromptButtons, promptButton } from "./prompts.js";

// wastech-mdlint's findings, shown where they apply: a panel above the document they are about, and
// a count beside every file in the tree that has any. The server lints in the background after a
// change and announces a `diagnostics` event when new results are in, so both are fetched here
// rather than rendered into the page — a page would otherwise show findings for the text before
// the edit that triggered its reload.

type Finding = {
  ruleId: string;
  severity: "error" | "warning";
  message: string;
  line: number;
  anchor?: string;
  helpUri?: string;
};

type DocumentDiagnostics =
  | { status: "pending" }
  | { status: "ready"; findings: Finding[] };

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
  const refresh = () => {
    void refreshTree();
    if (documentPath !== undefined) {
      void refreshPanel(documentPath);
    }
  };
  refresh();
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

async function refreshPanel(documentPath: string): Promise<void> {
  const data = await fetchJson<DocumentDiagnostics>(
    `/api/diagnostics?path=${encodeURIComponent(documentPath)}`,
  );
  if (data === undefined || data.status !== "ready") {
    return;
  }
  document.querySelector(".diagnostics")?.remove();
  if (data.findings.length === 0) {
    return;
  }
  const article = document.querySelector(".markdown-body");
  const element = panel(documentPath, data.findings);
  article?.prepend(element);
  initPromptButtons(element);
}

function panel(
  documentPath: string,
  findings: readonly Finding[],
): HTMLElement {
  const errors = findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warnings = findings.length - errors;
  const details = document.createElement("details");
  details.className = errors > 0 ? "diagnostics has-errors" : "diagnostics";
  details.open = true;
  const summary = document.createElement("summary");
  // The count in a span of its own, which takes the row's free width and so puts the prompt button
  // for all findings at the row's right end, level with the per-finding buttons under it.
  const title = document.createElement("span");
  title.className = "diagnostics-title";
  title.textContent = `wastech-mdlint: ${[
    errors > 0 ? plural(errors, "error") : "",
    warnings > 0 ? plural(warnings, "warning") : "",
  ]
    .filter(Boolean)
    .join(", ")}`;
  summary.append(title);
  if (findings.length > 1) {
    summary.append(promptButton(documentPath));
  }
  const list = document.createElement("ul");
  for (const finding of findings) {
    const item = document.createElement("li");
    item.className = `diagnostic diagnostic-${finding.severity}`;
    const severity = document.createElement("span");
    severity.className = "diagnostic-severity";
    severity.textContent = finding.severity;
    const rule = document.createElement(
      finding.helpUri === undefined ? "span" : "a",
    );
    rule.className = "diagnostic-rule";
    rule.textContent = finding.ruleId;
    if (rule instanceof HTMLAnchorElement && finding.helpUri !== undefined) {
      rule.href = finding.helpUri;
      rule.target = "_blank";
      rule.rel = "noopener noreferrer";
    }
    const message = document.createElement("span");
    message.className = "diagnostic-message";
    message.textContent = finding.message;
    // Findings carry a source line, not an element; the nearest heading above that line is the
    // closest place on the rendered page to send the reader. Above the first heading, that is the
    // top of the main column, whose id (`viewer.content`, from `page.ts`) holds a `.` so no heading
    // slug can take it.
    const where = document.createElement("a");
    where.className = "diagnostic-line";
    where.href =
      finding.anchor === undefined ? "#viewer.content" : `#${finding.anchor}`;
    // Line 0 is how a rule reports a finding about the file as a whole, such as its size.
    where.textContent =
      finding.line > 0 ? `line ${finding.line}` : "whole file";
    item.append(
      severity,
      rule,
      message,
      where,
      promptButton(documentPath, finding),
    );
    list.append(item);
  }
  details.append(summary, list);
  return details;
}

async function refreshTree(): Promise<void> {
  const data = await fetchJson<Summary>("/api/diagnostics");
  if (data === undefined || data.status !== "ready") {
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
    const counts = data.files[relPath];
    if (counts === undefined) {
      continue;
    }
    const badge = document.createElement("span");
    badge.className =
      counts.errors > 0 ? "tree-badge tree-badge-error" : "tree-badge";
    badge.textContent = String(counts.errors + counts.warnings);
    badge.title = [
      counts.errors > 0 ? plural(counts.errors, "error") : "",
      counts.warnings > 0 ? plural(counts.warnings, "warning") : "",
    ]
      .filter(Boolean)
      .join(", ");
    link.append(badge);
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
  return document.querySelector<HTMLInputElement>(".tree-filter input");
}

function initTreeFilter(): void {
  const label = document.querySelector<HTMLElement>(".tree-filter");
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
  const empty = sidebar.querySelector<HTMLElement>(".tree-filter-empty");
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
