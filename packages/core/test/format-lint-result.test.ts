import os from "node:os";

import { describe, expect, it } from "vitest";

import {
  formatLintResultJson,
  formatLintResultText,
} from "../src/engine/format-lint-result.js";
import { lintContent } from "../src/engine/lint-content.js";
import type { LintResult } from "../src/engine/lint-corpus.js";
import { ruleRegistry } from "../src/engine/rules/index.js";
import type { LintMessage } from "../src/engine/types.js";
import { readLintFindingLines } from "./support/output-parity.js";

// The human report's grammar is positional: an unindented line names a file and an indented line is a
// finding under it. Nothing else in the format carries that information, so any interpolated value
// that can hold a line break can invent a file — and the summary counts, which come from the
// structured result rather than from the text, stay correct while it happens.

function message(overrides: Partial<LintMessage> = {}): LintMessage {
  return {
    ruleId: "CTX-002",
    severity: "warning",
    message: "Checklist item is not checked.",
    filePath: "a.md",
    line: 1,
    ...overrides,
  };
}

function result(messages: LintMessage[]): LintResult {
  return {
    messages,
    files: [...new Set(messages.map((entry) => entry.filePath))],
    errorCount: messages.filter((entry) => entry.severity === "error").length,
    warningCount: messages.filter((entry) => entry.severity === "warning")
      .length,
  };
}

// The lines a reader of the format would take for file headings: everything unindented except the
// blank separator and the totals line. Deliberately *not* the renderer's own notion of a heading —
// the claim under test is what a consumer sees, not what the renderer believed it emitted.
function headingLines(text: string): string[] {
  return text
    .split("\n")
    .filter(
      (line) => line !== "" && !line.startsWith(" ") && !line.startsWith("✖"),
    );
}

describe("formatLintResultText line grammar", () => {
  it("keeps a finding whose message spans source lines on one line", () => {
    const text = formatLintResultText(
      result([
        message({
          message: 'Checklist item is not checked: "wrapped\nonto a second".',
          line: 3,
        }),
        message({
          message: 'Checklist item is not checked: "plain".',
          line: 6,
        }),
      ]),
    );

    expect(headingLines(text)).toEqual(["a.md"]);
    // Both findings survive the round trip, in order, with the newline flattened rather than the
    // first row being dropped for no longer matching the format it is supposed to be in.
    expect(readLintFindingLines(text)).toEqual([
      {
        filePath: "a.md",
        location: "3",
        severity: "warning",
        message: 'Checklist item is not checked: "wrapped onto a second".',
        ruleId: "CTX-002",
      },
      {
        filePath: "a.md",
        location: "6",
        severity: "warning",
        message: 'Checklist item is not checked: "plain".',
        ruleId: "CTX-002",
      },
    ]);
  });

  it("emits one heading per distinct file even when a path carries a line break", () => {
    // A finding attributed to a config entry rather than to a location reports the path the *user*
    // wrote, unnormalized — a missing STR-001 required file, an unresolvable SEC-003 template. That
    // makes the heading a user-supplied string on the one line the whole grammar rests on.
    const messages = [
      message({ filePath: "docs/a.md" }),
      message({ filePath: "docs/needed\nfile.md", ruleId: "STR-001" }),
      message({ filePath: "docs/b.md" }),
    ];
    const text = formatLintResultText(result(messages));

    expect(headingLines(text)).toHaveLength(
      new Set(messages.map((entry) => entry.filePath)).size,
    );
    expect(readLintFindingLines(text)).toHaveLength(messages.length);
  });

  it("renders the clean report without any heading", () => {
    const text = formatLintResultText(result([]));

    expect(text).toBe("No problems found.\n");
    expect(headingLines(text)).toEqual(["No problems found."]);
    expect(readLintFindingLines(text)).toEqual([]);
  });

  it("flattens a real rule's quoted source text while JSON keeps it verbatim", () => {
    // The reproduction the format's readers cannot manufacture: a soft line break inside a checklist
    // item survives into the text CTX-002 quotes, so the message really does carry a newline by the
    // time either formatter sees it. Rendering and serialization must disagree about it on purpose.
    const lint = lintContent({
      path: "content.md",
      content:
        "# A\n\n- [ ] wrapped item that continues\n  onto a second source line\n",
      rules: [{ rule: ruleRegistry.resolveRule("CTX-002", {}) }],
      rootDir: os.tmpdir(),
    });

    expect(lint.messages[0]!.message).toContain("\n");
    expect(readLintFindingLines(formatLintResultText(lint))).toEqual([
      {
        filePath: "content.md",
        location: "3",
        severity: "warning",
        message:
          'Checklist item is not checked: "wrapped item that continues onto a second source line".',
        ruleId: "CTX-002",
      },
    ]);
    expect(
      (JSON.parse(formatLintResultJson(lint)) as { messages: LintMessage[] })
        .messages[0]!.message,
    ).toBe(lint.messages[0]!.message);
  });
});
