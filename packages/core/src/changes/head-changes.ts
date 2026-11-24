import type {
  ParsedDocument,
  ParsedHeading,
} from "../markdown/document-types.js";
import { documentSections } from "./sections.js";
import type { DiffLine, TextDiff } from "./text-diff.js";

// A diff restated in the head side's own line numbers: which lines of the current text are new or
// edited, and where lines that left the base used to stand. A page showing the current text — its
// blocks, its outline — can then say where each change sits without reading the hunks itself, and
// every host that ever shows changes in place reads them the same way.

/**
 * How one head line differs from the base. `edited` lines were paired with the base line they
 * replace, so only some of their words changed; `added` lines were compared with nothing — new text,
 * or a rewrite too different from what it replaced to pair with it. `hunk` indexes `TextDiff.hunks`.
 */
export type HeadLineChange = { kind: "added" | "edited"; hunk: number };

/**
 * Base lines that left without a counterpart on the head side. They stood after head line `after`
 * (0 when above the first line); `baseLines` are their numbers on the base side, ascending.
 */
export type HeadRemoval = { after: number; baseLines: number[]; hunk: number };

export type HeadChanges = {
  lines: ReadonlyMap<number, HeadLineChange>;
  removals: readonly HeadRemoval[];
};

type RemovedLine = Extract<DiffLine, { kind: "removed" }>;
type AddedLine = Extract<DiffLine, { kind: "added" }>;

export function headChanges(diff: TextDiff): HeadChanges {
  const lines = new Map<number, HeadLineChange>();
  const removals: HeadRemoval[] = [];
  diff.hunks.forEach((hunk, hunkIndex) => {
    // The head line the next change follows. A hunk that shows no head line at all sits after
    // `headStart`; otherwise `headStart` is its own first head line.
    let lastHead = hunk.headLines > 0 ? hunk.headStart - 1 : hunk.headStart;
    let index = 0;
    while (index < hunk.lines.length) {
      const line = hunk.lines[index] as DiffLine;
      if (line.kind === "context") {
        lastHead = line.headLine;
        index += 1;
        continue;
      }
      // One change block: its removed lines, then its added ones, as `diffText` lays a block out.
      const removed: RemovedLine[] = [];
      const added: AddedLine[] = [];
      while (index < hunk.lines.length) {
        const entry = hunk.lines[index] as DiffLine;
        if (entry.kind === "context") {
          break;
        }
        if (entry.kind === "removed") {
          removed.push(entry);
        } else {
          added.push(entry);
        }
        index += 1;
      }

      // Lines are paired in order, so the n-th paired removed line became the n-th paired added
      // one. A removed line left unpaired stood after the counterpart of the last paired line above
      // it — or, with none above it, where the block starts.
      const editedHeads = added
        .filter((entry) => entry.segments !== undefined)
        .map((entry) => entry.headLine);
      let pairedAbove = 0;
      let group: HeadRemoval | undefined;
      for (const entry of removed) {
        if (entry.segments !== undefined) {
          pairedAbove += 1;
          group = undefined;
          continue;
        }
        if (group === undefined) {
          group = {
            after:
              pairedAbove === 0
                ? lastHead
                : (editedHeads[pairedAbove - 1] as number),
            baseLines: [],
            hunk: hunkIndex,
          };
          removals.push(group);
        }
        group.baseLines.push(entry.baseLine);
      }
      for (const entry of added) {
        lines.set(entry.headLine, {
          kind: entry.segments === undefined ? "added" : "edited",
          hunk: hunkIndex,
        });
      }
      lastHead = added.at(-1)?.headLine ?? lastHead;
    }
  });
  return { lines, removals };
}

/**
 * Where each base line is in the head: an unchanged line wherever the lines added and removed above
 * it moved it, an edited line where its paired counterpart is, and a line removed without a
 * counterpart nowhere. Line 0, which findings about a whole file use, stays 0.
 *
 * Edited lines are followed too, so a finding that survives an edit to its paragraph — the same
 * rule, the same message, on the line that replaced it — matches its earlier self instead of reading
 * as one finding removed and another added.
 */
export function baseLineMap(
  diff: TextDiff,
): (line: number) => number | undefined {
  const inHunks = new Map<number, number | undefined>();
  // From base line `from` on, a line outside every hunk moved by `offset`. The last entry at or
  // before a line applies to it.
  const shifts: { from: number; offset: number }[] = [{ from: 1, offset: 0 }];
  for (const hunk of diff.hunks) {
    let removed: number[] = [];
    let added: number[] = [];
    // Lines are paired in order within a change block, so the n-th paired removed line became the
    // n-th paired added one.
    const pair = () => {
      removed.forEach((baseLine, index) => {
        inHunks.set(baseLine, added[index]);
      });
      removed = [];
      added = [];
    };
    for (const line of hunk.lines) {
      if (line.kind === "context") {
        pair();
        inHunks.set(line.baseLine, line.headLine);
      } else if (line.kind === "removed") {
        inHunks.set(line.baseLine, undefined);
        if (line.segments !== undefined) {
          removed.push(line.baseLine);
        }
      } else if (line.segments !== undefined) {
        added.push(line.headLine);
      }
    }
    pair();
    // A side the hunk shows no line of has its start at the line after which its lines would sit.
    const baseEnd =
      hunk.baseLines > 0 ? hunk.baseStart + hunk.baseLines - 1 : hunk.baseStart;
    const headEnd =
      hunk.headLines > 0 ? hunk.headStart + hunk.headLines - 1 : hunk.headStart;
    shifts.push({ from: baseEnd + 1, offset: headEnd - baseEnd });
  }
  return (line) => {
    if (line === 0) {
      return 0;
    }
    if (inHunks.has(line)) {
      return inHunks.get(line);
    }
    let offset = 0;
    for (const shift of shifts) {
      if (shift.from > line) {
        break;
      }
      offset = shift.offset;
    }
    return line + offset;
  };
}

/**
 * The headings whose section holds a change: a new or edited line, or the place removed lines stood.
 * A section runs from its heading to the line before the next heading of the same or a higher level,
 * so a change deep inside a subsection marks every heading above it as well — which is what lets an
 * outline that lists only the upper levels still show where the change is.
 */
export function changedSections(
  headings: readonly ParsedHeading[],
  changes: HeadChanges,
): ParsedHeading[] {
  const changedLines = [...changes.lines.keys()];
  const removalPoints = changes.removals.map((removal) => removal.after);
  return headings.filter((heading, index) => {
    const next = headings
      .slice(index + 1)
      .find((other) => other.depth <= heading.depth);
    const end = next === undefined ? Number.POSITIVE_INFINITY : next.line - 1;
    const inside = (line: number) => line >= heading.line && line <= end;
    return changedLines.some(inside) || removalPoints.some(inside);
  });
}

/**
 * Whether a change falls in the text before a document's first section — the one unit
 * `documentSections` cuts that has no outline heading of its own, so `changedSections` cannot name
 * it. Lines removed above the first line count as its own, and so do lines removed right after its
 * last one, as `changedSections` gives a removal to the section it stood at the end of.
 */
export function introductionChanged(
  document: ParsedDocument,
  changes: HeadChanges,
): boolean {
  const introduction = documentSections(document)[0];
  if (introduction === undefined) {
    return false;
  }
  const inside = (line: number) => line <= introduction.end;
  return (
    [...changes.lines.keys()].some(inside) ||
    changes.removals.some((removal) => inside(removal.after))
  );
}
