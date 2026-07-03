import type { LintMessage } from "./types.js";
import type { LintResult } from "./lint-files.js";

// Deterministic formatters for a LintResult (P2.07). Messages are already sorted by lintFiles, so
// both renderers just project them; the JSON shape is the structured contract MCP reuses (P7).

function formatLocation(message: LintMessage): string {
  if (message.line <= 0) {
    // File-level finding (SIZE whole-file, absent section, missing file): no specific line.
    return "-";
  }
  return message.column === undefined ? `${message.line}` : `${message.line}:${message.column}`;
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
    lines.push(`  ${formatLocation(message)}  ${message.severity}  ${message.message}  ${message.ruleId}`);
  }

  const total = result.errorCount + result.warningCount;
  lines.push("");
  lines.push(
    `✖ ${total} problem${total === 1 ? "" : "s"} (${result.errorCount} error${
      result.errorCount === 1 ? "" : "s"
    }, ${result.warningCount} warning${result.warningCount === 1 ? "" : "s"})`
  );

  return `${lines.join("\n")}\n`;
}

export function formatLintResultJson(result: LintResult): string {
  const payload = {
    summary: {
      files: result.files.length,
      errors: result.errorCount,
      warnings: result.warningCount
    },
    messages: result.messages,
    files: result.files
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}
