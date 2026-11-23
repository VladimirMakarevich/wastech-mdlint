import { describe, expect, it } from "vitest";

import {
  type DiffLine,
  diffText,
  lineCorrespondence,
  lineRangeKept,
  normalizeText,
  tableRowLines,
} from "../src/changes/text-diff.js";
import { parseDocument } from "../src/markdown/parse-document.js";

// The changed stretches of each paired line in a diff, which is what a reader's eye is drawn to.
function changedWords(lines: DiffLine[], kind: "removed" | "added") {
  return lines
    .filter((line) => line.kind === kind)
    .map((line) =>
      "segments" in line && line.segments !== undefined
        ? line.segments
            .filter((segment) => segment.changed)
            .map((segment) => segment.text.trim())
        : null,
    );
}

// Built from its code point: a literal byte order mark in source is invisible and easily lost.
const BOM = String.fromCharCode(0xfeff);

const allLines = (text: string) => diffText(text, text).hunks;

describe("normalizeText", () => {
  it("makes every line ending a line feed and drops a byte order mark", () => {
    expect(normalizeText(`${BOM}a\r\nb\rc\n`)).toBe("a\nb\nc\n");
  });
});

describe("diffText", () => {
  it("finds nothing between identical texts, or ones differing only in line endings or a BOM", () => {
    expect(allLines("a\nb\n")).toEqual([]);
    expect(diffText("a\r\nb\r\n", `${BOM}a\nb\n`)).toEqual({
      hunks: [],
      added: 0,
      removed: 0,
      newlineAtEndChanged: false,
    });
  });

  it("highlights the one changed word of a paragraph, Cyrillic included", () => {
    const diff = diffText(
      "# Заголовок\n\nТекст про кошку и собаку, который длинный.\n",
      "# Заголовок\n\nТекст про мышку и собаку, который длинный.\n",
    );
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    const lines = diff.hunks[0]?.lines ?? [];
    expect(changedWords(lines, "removed")).toEqual([["кошку"]]);
    expect(changedWords(lines, "added")).toEqual([["мышку"]]);
  });

  it("highlights a link's changed target, not the link around it", () => {
    const diff = diffText(
      "See [the guide](docs/guide.md) for the details.\n",
      "See [the guide](docs/intro.md) for the details.\n",
    );
    const lines = diff.hunks[0]?.lines ?? [];
    expect(changedWords(lines, "removed")).toEqual([["guide"]]);
    expect(changedWords(lines, "added")).toEqual([["intro"]]);
  });

  it("leaves a rewritten line whole rather than highlighting the few words it shares", () => {
    const diff = diffText(
      "The cache is rebuilt on every request.\n",
      "Requests never rebuild anything now; a worker does it.\n",
    );
    const lines = diff.hunks[0]?.lines ?? [];
    expect(changedWords(lines, "removed")).toEqual([null]);
    expect(changedWords(lines, "added")).toEqual([null]);
  });

  it("pairs a changed line with the most similar of several added ones", () => {
    const diff = diffText(
      "intro\nThe quick brown fox jumps over the dog.\noutro\n",
      "intro\nAn entirely new sentence goes first here.\nThe quick brown fox leaps over the dog.\noutro\n",
    );
    const lines = diff.hunks[0]?.lines ?? [];
    expect(changedWords(lines, "removed")).toEqual([["jumps"]]);
    expect(changedWords(lines, "added")).toEqual([null, ["leaps"]]);
  });

  it("compares table rows cell by cell, ignoring the padding a realigned column adds", () => {
    const base =
      "| Name | Value |\n| ---- | ----- |\n| a    | 1     |\n| b    | 2     |\n";
    const head =
      "| Name | Value  |\n| ---- | ------ |\n| a    | 1      |\n| b    | 200000 |\n";
    const diff = diffText(base, head, {
      baseTableRows: tableRowLines(
        parseDocument({ path: "t.md", content: base }),
      ),
      headTableRows: tableRowLines(
        parseDocument({ path: "t.md", content: head }),
      ),
    });
    const lines = diff.hunks[0]?.lines ?? [];
    expect(changedWords(lines, "removed")).toEqual([[], ["-----"], [], ["2"]]);
    expect(changedWords(lines, "added")).toEqual([
      [],
      ["------"],
      [],
      ["200000"],
    ]);
  });

  it("numbers lines on both sides and groups changes into hunks with three lines of context", () => {
    const base = Array.from(
      { length: 20 },
      (_, index) => `line ${String(index + 1)}`,
    );
    const twoApart = [...base];
    twoApart[1] = "line 2, edited";
    twoApart[17] = "line 18, edited";
    const apart = diffText(`${base.join("\n")}\n`, `${twoApart.join("\n")}\n`);
    expect(
      apart.hunks.map(({ baseStart, baseLines, headStart, headLines }) => ({
        baseStart,
        baseLines,
        headStart,
        headLines,
      })),
    ).toEqual([
      { baseStart: 1, baseLines: 5, headStart: 1, headLines: 5 },
      { baseStart: 15, baseLines: 6, headStart: 15, headLines: 6 },
    ]);
    expect(apart.hunks[0]?.lines[1]).toMatchObject({
      kind: "removed",
      baseLine: 2,
      text: "line 2",
    });

    const close = [...base];
    close[4] = "line 5, edited";
    close[10] = "line 11, edited";
    const merged = diffText(`${base.join("\n")}\n`, `${close.join("\n")}\n`);
    expect(merged.hunks).toHaveLength(1);
    expect(merged.hunks[0]).toMatchObject({ baseStart: 2, baseLines: 13 });
  });

  it("shows an added and a deleted file as one hunk with nothing on the other side", () => {
    expect(diffText("", "a\nb\n")).toEqual({
      hunks: [
        {
          baseStart: 0,
          baseLines: 0,
          headStart: 1,
          headLines: 2,
          lines: [
            { kind: "added", headLine: 1, text: "a" },
            { kind: "added", headLine: 2, text: "b" },
          ],
        },
      ],
      added: 2,
      removed: 0,
      newlineAtEndChanged: false,
    });
    expect(diffText("a\n", "")).toMatchObject({
      hunks: [{ baseStart: 1, baseLines: 1, headStart: 0, headLines: 0 }],
      removed: 1,
    });
  });

  it("reports a change to the final line break, which no line shows", () => {
    expect(diffText("a\nb\n", "a\nb")).toEqual({
      hunks: [],
      added: 0,
      removed: 0,
      newlineAtEndChanged: true,
    });
  });
});

describe("tableRowLines", () => {
  it("lists the header, the delimiter and every body row", () => {
    const document = parseDocument({
      path: "t.md",
      content: "# T\n\n| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\nAfter.\n",
    });
    expect(
      [...tableRowLines(document)].sort((left, right) => left - right),
    ).toEqual([3, 4, 5, 6]);
  });
});

describe("lineRangeKept", () => {
  const base = `${Array.from({ length: 10 }, (_, index) => `l${String(index + 1)}`).join("\n")}\n`;
  const edit = (change: (lines: string[]) => void) => {
    const lines = base.trimEnd().split("\n");
    change(lines);
    return lineCorrespondence(base, `${lines.join("\n")}\n`);
  };

  it("keeps a range nothing touched and nothing shifted", () => {
    const runs = edit((lines) => lines.push("l11"));
    expect(lineRangeKept(runs, 5, 6)).toBe(true);
  });

  it("loses a range whose lines were edited", () => {
    const runs = edit((lines) => {
      lines[4] = "l5, edited";
    });
    expect(lineRangeKept(runs, 5, 6)).toBe(false);
    expect(lineRangeKept(runs, 7, 8)).toBe(true);
  });

  it("loses a range a change above it shifted", () => {
    const runs = edit((lines) => lines.unshift("new first line"));
    expect(lineRangeKept(runs, 5, 6)).toBe(false);
  });

  it("keeps a range when changes above it cancel out", () => {
    const runs = edit((lines) => {
      lines.splice(1, 1);
      lines.unshift("new first line");
    });
    expect(lineRangeKept(runs, 5, 6)).toBe(true);
  });

  it("loses a range past the end of the file", () => {
    expect(lineRangeKept(lineCorrespondence(base, base), 9, 12)).toBe(false);
  });
});
