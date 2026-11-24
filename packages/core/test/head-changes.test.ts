import { describe, expect, it } from "vitest";

import {
  baseLineMap,
  changedSections,
  headChanges,
  introductionChanged,
} from "../src/changes/head-changes.js";
import { diffText } from "../src/changes/text-diff.js";
import { parseDocument } from "../src/markdown/parse-document.js";

const changesOf = (base: string, head: string) =>
  headChanges(diffText(base, head));

describe("headChanges", () => {
  it("calls a line paired with the one it replaced edited, and removes nothing", () => {
    const changes = changesOf(
      "# T\n\nWrite in the present tense.\n",
      "# T\n\nWrite in the past tense.\n",
    );
    expect([...changes.lines]).toEqual([[3, { kind: "edited", hunk: 0 }]]);
    expect(changes.removals).toEqual([]);
  });

  it("calls an inserted line added", () => {
    const changes = changesOf("a\n\nb\n", "a\n\nnew\n\nb\n");
    expect(changes.lines.get(3)).toEqual({ kind: "added", hunk: 0 });
    expect(changes.removals).toEqual([]);
  });

  // Too little in common to pair: the old line left and a new one came, so the page can show the
  // old paragraph removed beside the new one rather than one paragraph "edited" beyond recognition.
  it("reads a rewrite as a removal where the old line stood and an added line", () => {
    const changes = changesOf(
      "# T\n\nThe quick brown fox.\n\nEnd.\n",
      "# T\n\nNothing alike here at all.\n\nEnd.\n",
    );
    expect(changes.lines.get(3)).toEqual({ kind: "added", hunk: 0 });
    expect(changes.removals).toEqual([{ after: 2, baseLines: [3], hunk: 0 }]);
  });

  it("places lines removed above the first line after line 0", () => {
    const changes = changesOf("gone\nkept\n", "kept\n");
    expect(changes.removals).toEqual([{ after: 0, baseLines: [1], hunk: 0 }]);
  });

  // Lines are paired in order, so a line removed between two edited ones stood after the first of
  // them on the head side, not at the top of the block.
  it("places a removed line after the edited counterpart of the line above it", () => {
    const changes = changesOf(
      "alpha one two\ngone entirely\nbeta three four\n",
      "alpha one TWO\nbeta three FOUR\n",
    );
    expect(changes.lines.get(1)?.kind).toBe("edited");
    expect(changes.lines.get(2)?.kind).toBe("edited");
    expect(changes.removals).toEqual([{ after: 1, baseLines: [2], hunk: 0 }]);
  });

  it("numbers each change with the hunk that shows it", () => {
    const base = `${Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n")}\n`;
    const head = base
      .replace("line 1\n", "line 1 changed\n")
      .replace("line 18\n", "");
    const changes = changesOf(base, head);
    expect(changes.lines.get(2)).toEqual({ kind: "edited", hunk: 0 });
    expect(changes.removals).toEqual([{ after: 18, baseLines: [19], hunk: 1 }]);
  });

  it("finds nothing in an unchanged text", () => {
    const changes = changesOf("# T\n\nSame.\n", "# T\r\n\r\nSame.\r\n");
    expect(changes.lines.size).toBe(0);
    expect(changes.removals).toEqual([]);
  });
});

describe("baseLineMap", () => {
  const lines = (...text: string[]) => `${text.join("\n")}\n`;

  it("moves an unchanged line by the lines added and removed above it", () => {
    const map = baseLineMap(
      diffText(
        lines("a", "b", "c", "d", "e", "f", "g", "h", "i", "j"),
        lines("new", "a", "b", "c", "d", "e", "f", "g", "i", "j"),
      ),
    );
    expect(map(1)).toBe(2);
    // Past the hunk around the insertion, and past the removal of `h` further down.
    expect(map(7)).toBe(8);
    expect(map(8)).toBeUndefined();
    expect(map(10)).toBe(10);
  });

  // A finding that survives an edit to its paragraph stays on the line that replaced it.
  it("follows an edited line to its counterpart, and a whole-file finding stays on line 0", () => {
    const map = baseLineMap(
      diffText(
        lines("# T", "", "Write in the present tense."),
        lines("# T", "", "Intro.", "", "Write in the past tense."),
      ),
    );
    expect(map(3)).toBe(5);
    expect(map(0)).toBe(0);
  });

  it("loses a line removed without a counterpart", () => {
    const map = baseLineMap(diffText(lines("a", "gone", "b"), lines("a", "b")));
    expect(map(2)).toBeUndefined();
    expect(map(3)).toBe(2);
  });
});

describe("changedSections", () => {
  const head = [
    "# Title", // 1
    "", // 2
    "## One", // 3
    "", // 4
    "Unchanged.", // 5
    "", // 6
    "## Two", // 7
    "", // 8
    "### Two point one", // 9
    "", // 10
    "Edited here.", // 11
    "", // 12
    "## Three", // 13
    "", // 14
    "Last.", // 15
    "",
  ].join("\n");
  const headings = parseDocument({ path: "doc.md", content: head }).headings;
  const slugs = (base: string) =>
    changedSections(headings, changesOf(base, head)).map(
      (heading) => heading.slug,
    );

  // The outline lists only the upper levels, so the section above a changed subsection is marked
  // as well, and so is the title whose section is the whole document.
  it("marks the section holding a change and every section around it", () => {
    expect(slugs(head.replace("Edited here.", "Edited there."))).toEqual([
      "title",
      "two",
      "two-point-one",
    ]);
  });

  it("marks the section removed lines stood at the end of, not the next one", () => {
    const base = head.replace("Unchanged.\n", "Unchanged.\n\nRemoved.\n");
    expect(slugs(base)).toEqual(["title", "one"]);
  });

  it("marks nothing when nothing changed", () => {
    expect(slugs(head)).toEqual([]);
  });
});

describe("introductionChanged", () => {
  const head = [
    "# Title", // 1
    "", // 2
    "Opening words.", // 3
    "", // 4
    "## One", // 5
    "", // 6
    "Body.", // 7
    "",
  ].join("\n");
  const document = parseDocument({ path: "doc.md", content: head });
  const changed = (base: string) =>
    introductionChanged(document, changesOf(base, head));

  it("sees an edit to the text before the first section", () => {
    expect(changed(head.replace("Opening words.", "Opening lines."))).toBe(
      true,
    );
  });

  // The title's own section is the whole document, so `changedSections` marks it for any change;
  // the introduction is only the text above the first section.
  it("does not see a change inside a section", () => {
    expect(changed(head.replace("Body.", "Text."))).toBe(false);
  });

  it("sees lines removed above the first line and right before the first section", () => {
    expect(changed(`Gone.\n\n${head}`)).toBe(true);
    expect(
      changed(head.replace("Opening words.\n", "Opening words.\n\nGone.\n")),
    ).toBe(true);
  });

  it("is false when nothing changed", () => {
    expect(changed(head)).toBe(false);
  });
});
