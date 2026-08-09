import type { LintMessage } from "./types.js";
import type { LintResult } from "./lint-files.js";

// Deterministic formatters for a LintResult. Messages are already sorted by lintFiles, so
// both renderers just project them.
//
// The JSON shape here is the **CLI's** contract, not one shape both hosts share — the claim this
// comment used to make. Four payloads carry lint findings and they are deliberately not one:
//
//   - CLI `lint --format json` — this wrapper: `{ summary, messages, files }`, where the finding
//     counts live under `summary.errors` / `summary.warnings`.
//   - CLI `impact --format json` — the raw `LintResult`, narrowed to the affected subgraph, under a
//     `lint` key (`cli/src/commands.ts`).
//   - MCP `lint-files` — the raw `LintResult` verbatim, so counts are top-level `errorCount` /
//     `warningCount`.
//   - MCP `lint` — a narrower `{ messages, errorCount, warningCount }`: an ad-hoc document is not a
//     corpus, so there is no `files` list to report.
//
// A typed client wants the record; a human report wants a summary. That divergence is documented for
// consumers, since each host puts the findings in a different place, rather than unified here,
// because unifying it would either strip `summary` from the CLI or wrap the record MCP callers type
// against.

/**
 * Flatten a value into something that can occupy part of one report line.
 *
 * The text report's grammar is positional: an unindented line is a file heading and an indented one
 * is a finding under it. Two of the four interpolated fields are free text rather than a closed
 * vocabulary — a message quotes source text (a checklist item, a matched pattern, a heading), and a
 * finding attributed to a config entry rather than to a location carries the path the *user* wrote.
 * Interpolated raw, a newline in either splits one row into a finding plus an unindented
 * continuation that reads as a file heading, and every finding after it is filed under a path that
 * does not exist. Counts stay right and JSON stays right, so nothing looks wrong.
 *
 * Whitespace runs collapse to a single space rather than the alternative of indenting the
 * continuation lines. Indenting would keep the grammar and keep the quoted text's line structure,
 * but a row spanning two lines still defeats everything that reads this format one line at a time —
 * a CI annotator, an editor problem matcher, a per-file count — which is the whole audience for the
 * human report. Collapsing runs rather than only line breaks also keeps the two-space field
 * separator unambiguous, so a row can be split back into its four fields.
 *
 * Nothing is lost from the product: the JSON payload carries `message` verbatim with the newline
 * escaped, and rules that quote source text keep the raw text in `data` (`CTX-002`'s `data.text`).
 */
function toReportLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatLocation(message: LintMessage): string {
  if (message.line <= 0) {
    // File-level finding (SIZE whole-file, absent section, missing file): no specific line.
    return "-";
  }
  return message.column === undefined
    ? `${message.line}`
    : `${message.line}:${message.column}`;
}

export function formatLintResultText(result: LintResult): string {
  if (result.messages.length === 0) {
    return "No problems found.\n";
  }

  const lines: string[] = [];
  let currentFile: string | undefined;

  for (const message of result.messages) {
    if (message.filePath !== currentFile) {
      // Grouping compares the raw path while the heading renders the flattened one, so two paths
      // that differ only in the whitespace being collapsed still produce two headings — the
      // heading count stays equal to the number of distinct files, which is the property the
      // format's readers depend on.
      currentFile = message.filePath;
      lines.push(toReportLine(currentFile));
    }
    lines.push(
      `  ${formatLocation(message)}  ${message.severity}  ${toReportLine(message.message)}  ${message.ruleId}`,
    );
  }

  const total = result.errorCount + result.warningCount;
  lines.push("");
  lines.push(
    `✖ ${total} problem${total === 1 ? "" : "s"} (${result.errorCount} error${
      result.errorCount === 1 ? "" : "s"
    }, ${result.warningCount} warning${result.warningCount === 1 ? "" : "s"})`,
  );

  return `${lines.join("\n")}\n`;
}

export function formatLintResultJson(result: LintResult): string {
  const payload = {
    summary: {
      files: result.files.length,
      errors: result.errorCount,
      warnings: result.warningCount,
    },
    messages: result.messages,
    files: result.files,
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}
