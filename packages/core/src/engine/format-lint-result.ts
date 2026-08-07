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
      currentFile = message.filePath;
      lines.push(currentFile);
    }
    lines.push(
      `  ${formatLocation(message)}  ${message.severity}  ${message.message}  ${message.ruleId}`,
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
