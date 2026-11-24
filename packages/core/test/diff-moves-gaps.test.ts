import { describe, expect, it } from "vitest";

import { contextGaps, diffText } from "../src/changes/text-diff.js";

const lines = (count: number, prefix = "Line") =>
  Array.from({ length: count }, (_, index) => `${prefix} ${String(index + 1)}`);

describe("moved lines", () => {
  it("marks a paragraph cut from one place and pasted in another as a move, both ways", () => {
    const base = [
      "# Title",
      "",
      "A paragraph that will move further down.",
      "",
      "## Section",
      "",
      "Text that stays.",
      "",
    ].join("\n");
    const head = [
      "# Title",
      "",
      "## Section",
      "",
      "Text that stays.",
      "",
      "A paragraph that will move further down.",
      "",
    ].join("\n");
    const changed = diffText(base, head).hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.kind !== "context"),
    );
    expect(changed).toContainEqual({
      kind: "removed",
      baseLine: 3,
      text: "A paragraph that will move further down.",
      movedTo: 7,
    });
    expect(changed).toContainEqual({
      kind: "added",
      headLine: 7,
      text: "A paragraph that will move further down.",
      movedFrom: 3,
    });
  });

  it("leaves short lines and edited lines as removals and additions", () => {
    const base = "- one\n\nThe first sentence of it.\n\nlast\n";
    const head = "last\n\nThe first sentence of it, edited.\n\n- one\n";
    const changed = diffText(base, head).hunks.flatMap((hunk) => hunk.lines);
    for (const line of changed) {
      expect(line).not.toHaveProperty("movedTo");
      expect(line).not.toHaveProperty("movedFrom");
    }
  });
});

describe("contextGaps", () => {
  it("returns the unchanged lines before, between and after the hunks, numbered on both sides", () => {
    const base = [...lines(20), ""].join("\n");
    const headLines = lines(20);
    headLines[4] = "Line 5, edited";
    headLines.splice(14, 1);
    const head = [...headLines, ""].join("\n");
    const diff = diffText(base, head);
    expect(diff.hunks).toHaveLength(2);

    const gaps = contextGaps(diff, head);
    expect(gaps.map((gap) => gap.before)).toEqual([0, 1, 2]);
    expect(gaps[0]?.lines.map((line) => line.headLine)).toEqual([1]);
    // Between the edit at line 5 and the removed line 15: lines 9 to 11 on both sides.
    expect(gaps[1]?.lines).toEqual(
      [9, 10, 11].map((line) => ({
        baseLine: line,
        headLine: line,
        text: `Line ${String(line)}`,
      })),
    );
    // After the removal the head is one line behind the base.
    expect(gaps[2]?.lines[0]).toEqual({
      baseLine: 19,
      headLine: 18,
      text: "Line 19",
    });
    expect(gaps[2]?.lines.at(-1)).toEqual({
      baseLine: 20,
      headLine: 19,
      text: "Line 20",
    });
  });

  it("has no gaps for a diff with no hunks, or one that shows the whole text", () => {
    expect(contextGaps(diffText("same\n", "same\n"), "same\n")).toEqual([]);
    const small = diffText("a\nb\n", "a\nc\n");
    expect(contextGaps(small, "a\nc\n")).toEqual([]);
  });
});
