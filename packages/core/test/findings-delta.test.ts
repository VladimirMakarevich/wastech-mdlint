import { describe, expect, it } from "vitest";

import { compareFindings } from "../src/changes/findings-delta.js";
import type { LintMessage } from "../src/engine/types.js";

const finding = (
  filePath: string,
  line: number,
  message = "Problem.",
  severity: LintMessage["severity"] = "warning",
): LintMessage => ({ ruleId: "STR-001", severity, message, filePath, line });

describe("compareFindings", () => {
  it("matches findings as a multiset on file, rule, line, severity and message", () => {
    const before = [finding("a.md", 1), finding("a.md", 1), finding("b.md", 2)];
    const after = [
      finding("a.md", 1),
      finding("b.md", 2, "Problem.", "error"),
      finding("c.md", 3),
    ];
    const delta = compareFindings(before, after);
    expect(delta.added).toEqual([
      finding("b.md", 2, "Problem.", "error"),
      finding("c.md", 3),
    ]);
    expect(delta.removed).toEqual([finding("a.md", 1), finding("b.md", 2)]);
  });

  // Across a branch a paragraph inserted above a finding moves it down without changing it; located
  // where it is now, it matches its later self and is no change at all.
  it("moves earlier findings before matching, and removes those it cannot move", () => {
    const before = [
      finding("a.md", 3),
      finding("a.md", 7),
      finding("old.md", 1),
    ];
    const after = [finding("a.md", 5), finding("new.md", 1)];
    const delta = compareFindings(before, after, (message) =>
      message.filePath === "old.md"
        ? { filePath: "new.md", line: 1 }
        : message.line === 3
          ? { filePath: "a.md", line: 5 }
          : undefined,
    );
    expect(delta.added).toEqual([]);
    // Removed as the earlier run reported it, at its own line.
    expect(delta.removed).toEqual([finding("a.md", 7)]);
  });
});
