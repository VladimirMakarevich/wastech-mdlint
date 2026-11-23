import type { ParsedHeading } from "../markdown/document-types.js";
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
