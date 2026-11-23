import { onServerEvent } from "./live-reload.js";

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

export function initDiagnostics(documentPath: string | undefined): void {
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
  article?.prepend(panel(data.findings));
}

function panel(findings: readonly Finding[]): HTMLElement {
  const errors = findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  const warnings = findings.length - errors;
  const details = document.createElement("details");
  details.className = errors > 0 ? "diagnostics has-errors" : "diagnostics";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = `wastech-mdlint: ${[
    errors > 0 ? plural(errors, "error") : "",
    warnings > 0 ? plural(warnings, "warning") : "",
  ]
    .filter(Boolean)
    .join(", ")}`;
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
    // closest place on the rendered page to send the reader.
    const where = document.createElement("a");
    where.className = "diagnostic-line";
    where.href =
      finding.anchor === undefined ? "#content" : `#${finding.anchor}`;
    // Line 0 is how a rule reports a finding about the file as a whole, such as its size.
    where.textContent =
      finding.line > 0 ? `line ${finding.line}` : "whole file";
    item.append(severity, rule, message, where);
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
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
