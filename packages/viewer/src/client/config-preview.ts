import { element, paragraph } from "./config-dom.js";
import type { Finding, OkPreview } from "./config-types.js";

// The preview's content: what the server's answer says the change would do to the lint run. Built
// from the answer alone, so what is shown is core's verdict, never a judgment made on this page.

/** Why the linter would not load the config, line by line as core reported it. */
export function invalidPreview(errors: readonly string[]): HTMLElement[] {
  const list = element("ul", "config-errors");
  for (const line of errors) {
    const item = element("li");
    item.textContent = line.replace(/^- /, "");
    list.append(item);
  }
  return [
    paragraph("The linter would not load this config:", "config-invalid"),
    list,
  ];
}

/** The findings before and after, which rules' counts move, and the file as it would be written. */
export function okPreview(preview: OkPreview, filePath: string): HTMLElement[] {
  const { before, after } = preview.findings;
  const parts: HTMLElement[] = [
    paragraph(
      `Now: ${counts(before)}. With this config: ${counts(after)} — ${preview.addedCount} new, ${preview.removedCount} gone.`,
      "config-summary",
    ),
  ];
  if (preview.documents.before !== preview.documents.after) {
    parts.push(
      paragraph(
        `The linted corpus would hold ${preview.documents.after} documents instead of ${preview.documents.before}.`,
      ),
    );
  }
  const changedRules = preview.byRule.filter(
    (rule) => rule.before !== rule.after,
  );
  if (changedRules.length > 0) {
    parts.push(byRuleTable(changedRules));
  }
  parts.push(
    findingList("New findings", preview.added, preview.addedCount),
    findingList("Gone findings", preview.removed, preview.removedCount),
  );
  const file = document.createElement("details");
  file.className = "config-result";
  const fileSummary = document.createElement("summary");
  fileSummary.textContent = `${filePath} with this change`;
  const pre = document.createElement("pre");
  pre.textContent = preview.text;
  file.append(fileSummary, pre);
  parts.push(file);
  return parts;
}

function byRuleTable(rules: OkPreview["byRule"]): HTMLElement {
  const table = element("table", "config-by-rule");
  const head = element("tr");
  for (const title of ["Rule", "Now", "With this config"]) {
    const cell = element("th");
    cell.textContent = title;
    head.append(cell);
  }
  table.append(head);
  for (const rule of rules) {
    const row = element("tr");
    for (const text of [rule.ruleId, String(rule.before), String(rule.after)]) {
      const cell = element("td");
      cell.textContent = text;
      row.append(cell);
    }
    table.append(row);
  }
  return table;
}

function findingList(
  title: string,
  findings: Finding[],
  total: number,
): HTMLElement {
  const details = document.createElement("details");
  details.className = "config-findings";
  const summary = document.createElement("summary");
  summary.textContent = `${title} (${total})`;
  const list = element("ul");
  for (const finding of findings) {
    const item = element(
      "li",
      `config-finding config-finding-${finding.severity}`,
    );
    const where = element("code");
    where.textContent =
      finding.line > 0
        ? `${finding.filePath}:${finding.line}`
        : finding.filePath;
    const rule = element("span", "config-finding-rule");
    rule.textContent = `${finding.ruleId} ${finding.severity}`;
    const message = element("span");
    message.textContent = finding.message;
    item.append(where, " ", rule, " ", message);
    list.append(item);
  }
  if (total > findings.length) {
    const more = element("li", "config-hint");
    more.textContent = `…and ${total - findings.length} more.`;
    list.append(more);
  }
  details.append(summary, list);
  return details;
}

export function counts(side: { errors: number; warnings: number }): string {
  return `${side.errors} error${side.errors === 1 ? "" : "s"}, ${side.warnings} warning${side.warnings === 1 ? "" : "s"}`;
}
