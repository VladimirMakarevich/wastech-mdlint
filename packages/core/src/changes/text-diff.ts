import type { ParsedDocument } from "../markdown/document-types.js";
import { type DiffRun, diffSequences } from "./sequence-diff.js";

// The diff a reviewer reads: lines, grouped into hunks with context, and inside each changed line
// the words — or, in a table row, the cells — that actually changed. Prose in Markdown is usually
// one line per paragraph (formatters such as Prettier with `proseWrap: "never"`, and agents writing
// unwrapped text), so a line diff alone marks a whole paragraph for one changed word.

/**
 * The text a diff or a content hash is computed over: line endings made `\n` and a leading byte
 * order mark dropped. With `core.autocrlf` git stores LF while the work tree holds CRLF, so without
 * this every line of every file would differ. A lone `\r` counts as a line ending, as the Markdown
 * parser counts it, so line numbers here are the ones a parsed document reports.
 */
export function normalizeText(text: string): string {
  const unmarked =
    text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
  return unmarked.replace(/\r\n?/g, "\n");
}

const BYTE_ORDER_MARK = 0xfeff;

/** A stretch of a changed line, marked when it differs from the line it was paired with. */
export type DiffSegment = { text: string; changed: boolean };

/**
 * One line of a hunk, numbered from 1 on each side it exists on. A removed or added line that was
 * paired with its counterpart carries `segments`, which cover the whole line; one without a
 * counterpart close enough to compare is changed as a whole. A whole line removed in one place and
 * added unchanged in another is a move: the removed one names the head line it went to
 * (`movedTo`), the added one the base line it came from (`movedFrom`).
 */
export type DiffLine =
  | { kind: "context"; baseLine: number; headLine: number; text: string }
  | {
      kind: "removed";
      baseLine: number;
      text: string;
      segments?: DiffSegment[];
      movedTo?: number;
    }
  | {
      kind: "added";
      headLine: number;
      text: string;
      segments?: DiffSegment[];
      movedFrom?: number;
    };

/**
 * A run of changed lines with up to `context` unchanged lines around it. `baseStart` and
 * `headStart` are the first line numbers the hunk shows on each side — or, on a side the hunk has no
 * line from, the line after which its lines would sit (0 at the top).
 */
export type DiffHunk = {
  baseStart: number;
  baseLines: number;
  headStart: number;
  headLines: number;
  lines: DiffLine[];
};

export type TextDiff = {
  hunks: DiffHunk[];
  added: number;
  removed: number;
  /** Whether only one side ends with a line break — a change no line shows. */
  newlineAtEndChanged: boolean;
};

export type TextDiffOptions = {
  /** Unchanged lines shown around each change; 3, as `git diff` shows. */
  context?: number;
  /**
   * Line numbers of table rows on each side, from the parsed documents (`tableRowLines`). A changed
   * row paired with a changed row is compared cell by cell, without the padding a formatter adds when
   * it realigns a column.
   */
  baseTableRows?: ReadonlySet<number>;
  headTableRows?: ReadonlySet<number>;
};

// A changed line is compared with its counterpart only when they share at least this much of their
// text; below it, highlighting the few words they share would make a rewritten paragraph look edited.
const PAIRING_THRESHOLD = 0.5;
// Pairing in a block of R removed and A added lines compares each with each; past this many
// comparisons lines are paired in order instead.
const PAIRING_COMPARISONS = 400;

/** Every line number on which a row of a table — header, delimiter or body — sits. */
export function tableRowLines(document: ParsedDocument): Set<number> {
  const lines = new Set<number>();
  for (const table of document.tables) {
    lines.add(table.line);
    // The delimiter row (`| --- |`) is not a parsed row, and always follows the header.
    lines.add(table.line + 1);
    for (const row of table.rows) {
      lines.add(row.line);
    }
  }
  return lines;
}

type SplitText = { lines: string[]; newlineAtEnd: boolean };

function splitLines(text: string): SplitText {
  if (text === "") {
    return { lines: [], newlineAtEnd: false };
  }
  const newlineAtEnd = text.endsWith("\n");
  return {
    lines: (newlineAtEnd ? text.slice(0, -1) : text).split("\n"),
    newlineAtEnd,
  };
}

function lineRuns(base: SplitText, head: SplitText): DiffRun[] {
  return diffSequences(base.lines, head.lines, (left, right) => left === right);
}

export function diffText(
  baseText: string,
  headText: string,
  options: TextDiffOptions = {},
): TextDiff {
  const context = options.context ?? 3;
  const base = splitLines(normalizeText(baseText));
  const head = splitLines(normalizeText(headText));
  const runs = lineRuns(base, head);

  // Every line of both sides in order, then cut into hunks around the changed ones.
  const all: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index] as DiffRun;
    if (run.kind === "equal") {
      for (let offset = 0; offset < run.length; offset += 1) {
        all.push({
          kind: "context",
          baseLine: run.baseStart + offset + 1,
          headLine: run.headStart + offset + 1,
          text: base.lines[run.baseStart + offset] ?? "",
        });
      }
      continue;
    }
    // A change block: every delete and insert run up to the next equal one.
    const removedIndexes: number[] = [];
    const addedIndexes: number[] = [];
    let blockEnd = index;
    while (blockEnd < runs.length && runs[blockEnd]?.kind !== "equal") {
      const blockRun = runs[blockEnd] as DiffRun;
      for (let offset = 0; offset < blockRun.length; offset += 1) {
        if (blockRun.kind === "delete") {
          removedIndexes.push(blockRun.baseStart + offset);
        } else {
          addedIndexes.push(blockRun.headStart + offset);
        }
      }
      blockEnd += 1;
    }
    index = blockEnd - 1;
    all.push(...changeBlock(base, head, removedIndexes, addedIndexes, options));
    added += addedIndexes.length;
    removed += removedIndexes.length;
  }

  markMoves(all);
  return {
    hunks: groupHunks(all, context),
    added,
    removed,
    newlineAtEndChanged:
      base.lines.length > 0 &&
      head.lines.length > 0 &&
      base.newlineAtEnd !== head.newlineAtEnd,
  };
}

// A line shorter than this is not called moved when the same text appears elsewhere: a blank line, a
// `---` or a closing fence turns up all over a document, and pairing those would mark half a diff
// as moves. A sentence or a list item with some words in it is long enough to be the same line.
const MOVE_MIN_LENGTH = 12;

/**
 * Pair every whole line removed in one place with the same line added in another, in order: a
 * paragraph or list item cut and pasted elsewhere reads as a move rather than as a deletion and an
 * unrelated addition. Only lines changed as a whole take part; a line paired as an edit already has
 * its counterpart.
 */
function markMoves(lines: DiffLine[]): void {
  const added = new Map<string, Extract<DiffLine, { kind: "added" }>[]>();
  for (const line of lines) {
    if (
      line.kind === "added" &&
      line.segments === undefined &&
      line.text.trim().length >= MOVE_MIN_LENGTH
    ) {
      const waiting = added.get(line.text);
      if (waiting === undefined) {
        added.set(line.text, [line]);
      } else {
        waiting.push(line);
      }
    }
  }
  for (const line of lines) {
    if (line.kind !== "removed" || line.segments !== undefined) {
      continue;
    }
    const partner = added.get(line.text)?.shift();
    if (partner !== undefined) {
      line.movedTo = partner.headLine;
      partner.movedFrom = line.baseLine;
    }
  }
}

/** Unchanged lines a diff leaves out, between two hunks or before the first or after the last. */
export type DiffGap = {
  /** The hunk the gap comes before; the number of hunks for the gap after the last one. */
  before: number;
  lines: { baseLine: number; headLine: number; text: string }[];
};

/**
 * Every run of unchanged lines `diff` does not show, from the head text it was computed against: what
 * a reader opens to see more context around a change. Unchanged lines are the same on both sides, so
 * each carries its number on both.
 */
export function contextGaps(diff: TextDiff, headText: string): DiffGap[] {
  const head = splitLines(normalizeText(headText)).lines;
  const gaps: DiffGap[] = [];
  let lastBase = 0;
  let lastHead = 0;
  const gap = (before: number, from: number, to: number) => {
    const lines = [];
    for (let headLine = from; headLine <= to; headLine += 1) {
      lines.push({
        baseLine: lastBase + (headLine - lastHead),
        headLine,
        text: head[headLine - 1] ?? "",
      });
    }
    if (lines.length > 0) {
      gaps.push({ before, lines });
    }
  };
  diff.hunks.forEach((hunk, index) => {
    // A hunk with no head line sits after `headStart`, so the gap above it ends there.
    const firstHead = hunk.headLines > 0 ? hunk.headStart : hunk.headStart + 1;
    gap(index, lastHead + 1, firstHead - 1);
    lastHead =
      hunk.headLines > 0 ? hunk.headStart + hunk.headLines - 1 : hunk.headStart;
    lastBase =
      hunk.baseLines > 0 ? hunk.baseStart + hunk.baseLines - 1 : hunk.baseStart;
  });
  if (diff.hunks.length > 0) {
    gap(diff.hunks.length, lastHead + 1, head.length);
  }
  return gaps;
}

function changeBlock(
  base: SplitText,
  head: SplitText,
  removedIndexes: number[],
  addedIndexes: number[],
  options: TextDiffOptions,
): DiffLine[] {
  const removedLines = removedIndexes.map((index) => ({
    line: index + 1,
    text: base.lines[index] ?? "",
  }));
  const addedLines = addedIndexes.map((index) => ({
    line: index + 1,
    text: head.lines[index] ?? "",
  }));
  const tokenized = (
    side: "base" | "head",
    entry: { line: number; text: string },
  ) => {
    const rows =
      side === "base" ? options.baseTableRows : options.headTableRows;
    return rows?.has(entry.line) === true
      ? { tokens: cellTokens(entry.text), table: true }
      : { tokens: wordTokens(entry.text), table: false };
  };
  const removedTokens = removedLines.map((entry) => tokenized("base", entry));
  const addedTokens = addedLines.map((entry) => tokenized("head", entry));

  // Only like is compared with like: a table row with a table row, prose with prose.
  const comparable = (removedIndex: number, addedIndex: number) =>
    removedTokens[removedIndex]?.table === addedTokens[addedIndex]?.table;
  const compare = (removedIndex: number, addedIndex: number) =>
    compareTokens(
      (removedTokens[removedIndex] as TokenizedLine).tokens,
      (addedTokens[addedIndex] as TokenizedLine).tokens,
      (removedTokens[removedIndex] as TokenizedLine).table,
    );
  const pairs = pairLines(
    removedLines.length,
    addedLines.length,
    comparable,
    compare,
  );

  const removedSegments = new Map<number, DiffSegment[]>();
  const addedSegments = new Map<number, DiffSegment[]>();
  for (const [removedIndex, addedIndex, comparison] of pairs) {
    removedSegments.set(removedIndex, comparison.base);
    addedSegments.set(addedIndex, comparison.head);
  }

  // All removed lines, then all added ones, as `git diff` prints a block; the segments carry the
  // pairing a reader needs.
  return [
    ...removedLines.map((entry, index): DiffLine => {
      const segments = removedSegments.get(index);
      return segments === undefined
        ? { kind: "removed", baseLine: entry.line, text: entry.text }
        : { kind: "removed", baseLine: entry.line, text: entry.text, segments };
    }),
    ...addedLines.map((entry, index): DiffLine => {
      const segments = addedSegments.get(index);
      return segments === undefined
        ? { kind: "added", headLine: entry.line, text: entry.text }
        : { kind: "added", headLine: entry.line, text: entry.text, segments };
    }),
  ];
}

type TokenizedLine = { tokens: string[]; table: boolean };

type Comparison = {
  similarity: number;
  base: DiffSegment[];
  head: DiffSegment[];
};

/**
 * Pair removed with added lines, in order, maximizing their total similarity — a dynamic program
 * over the block, like a longest common subsequence weighted by similarity — and keep only pairs at
 * or above the threshold. A large block is paired line for line in order instead.
 */
function pairLines(
  removedCount: number,
  addedCount: number,
  comparable: (removed: number, added: number) => boolean,
  compare: (removed: number, added: number) => Comparison,
): [number, number, Comparison][] {
  if (removedCount === 0 || addedCount === 0) {
    return [];
  }
  const accept = (removed: number, added: number) => {
    if (!comparable(removed, added)) {
      return undefined;
    }
    const comparison = compare(removed, added);
    return comparison.similarity >= PAIRING_THRESHOLD ? comparison : undefined;
  };

  if (removedCount * addedCount > PAIRING_COMPARISONS) {
    const pairs: [number, number, Comparison][] = [];
    for (
      let index = 0;
      index < Math.min(removedCount, addedCount);
      index += 1
    ) {
      const comparison = accept(index, index);
      if (comparison !== undefined) {
        pairs.push([index, index, comparison]);
      }
    }
    return pairs;
  }

  const comparisons: (Comparison | undefined)[][] = Array.from(
    { length: removedCount },
    (_, removed) =>
      Array.from({ length: addedCount }, (_unused, added) =>
        accept(removed, added),
      ),
  );
  // best[r][a]: the highest total similarity pairing removed lines from r and added lines from a.
  const best: number[][] = Array.from({ length: removedCount + 1 }, () =>
    new Array<number>(addedCount + 1).fill(0),
  );
  for (let removed = removedCount - 1; removed >= 0; removed -= 1) {
    for (let added = addedCount - 1; added >= 0; added -= 1) {
      const row = best[removed] as number[];
      const skipRemoved = (best[removed + 1] as number[])[added] as number;
      const skipAdded = row[added + 1] as number;
      const comparison = comparisons[removed]?.[added];
      const take =
        comparison === undefined
          ? -1
          : comparison.similarity +
            ((best[removed + 1] as number[])[added + 1] as number);
      row[added] = Math.max(take, skipRemoved, skipAdded);
    }
  }

  const pairs: [number, number, Comparison][] = [];
  let removed = 0;
  let added = 0;
  while (removed < removedCount && added < addedCount) {
    const comparison = comparisons[removed]?.[added];
    const here = (best[removed] as number[])[added] as number;
    if (
      comparison !== undefined &&
      here ===
        comparison.similarity +
          ((best[removed + 1] as number[])[added + 1] as number)
    ) {
      pairs.push([removed, added, comparison]);
      removed += 1;
      added += 1;
    } else if (here === ((best[removed + 1] as number[])[added] as number)) {
      removed += 1;
    } else {
      added += 1;
    }
  }
  return pairs;
}

// Words as runs of letters and digits in any script, so Cyrillic words are words; whitespace runs;
// the Markdown markers that wrap text (`**`, `__`, `~~`, a run of backticks, a run of `#`, `](` and
// `![`) as one token each, so a changed link target lights up the target and not the brackets
// around it; and any other character on its own.
const WORD_TOKEN =
  /[\p{L}\p{N}_]+|\s+|\*\*|__|~~|`+|#+|\]\(|!\[|[^\p{L}\p{N}_\s]/gu;

function wordTokens(line: string): string[] {
  return line.match(WORD_TOKEN) ?? [];
}

/**
 * A table row as alternating pipes and cells, each cell with the spaces around it. A `\|` inside a
 * cell is text, as GitHub-flavored Markdown reads it, not a separator.
 */
function cellTokens(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] as string;
    if (character === "\\" && line[index + 1] === "|") {
      current += "\\|";
      index += 1;
    } else if (character === "|") {
      if (current !== "") {
        tokens.push(current);
      }
      tokens.push("|");
      current = "";
    } else {
      current += character;
    }
  }
  if (current !== "") {
    tokens.push(current);
  }
  return tokens;
}

function compareTokens(
  baseTokens: string[],
  headTokens: string[],
  table: boolean,
): Comparison {
  // A cell is the same cell whatever padding surrounds it; a word must match exactly.
  const key = (token: string) => (table ? token.trim() : token);
  const runs = diffSequences(
    baseTokens,
    headTokens,
    (left, right) => key(left) === key(right),
  );

  const weight = (token: string) => key(token).replace(/\s+/g, "").length;
  const total =
    baseTokens.reduce((sum, token) => sum + weight(token), 0) +
    headTokens.reduce((sum, token) => sum + weight(token), 0);
  let shared = 0;
  const baseChanged = new Array<boolean>(baseTokens.length).fill(true);
  const headChanged = new Array<boolean>(headTokens.length).fill(true);
  for (const run of runs) {
    if (run.kind !== "equal") {
      continue;
    }
    for (let offset = 0; offset < run.length; offset += 1) {
      baseChanged[run.baseStart + offset] = false;
      headChanged[run.headStart + offset] = false;
      shared += 2 * weight(baseTokens[run.baseStart + offset] as string);
    }
  }
  return {
    // Lines with no visible text at all (blank, or whitespace only) are alike.
    similarity: total === 0 ? 1 : shared / total,
    base: segmentsOf(baseTokens, baseChanged),
    head: segmentsOf(headTokens, headChanged),
  };
}

function segmentsOf(tokens: string[], changed: boolean[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  tokens.forEach((token, index) => {
    const isChanged = changed[index] === true;
    const last = segments[segments.length - 1];
    if (last?.changed === isChanged) {
      last.text += token;
    } else {
      segments.push({ text: token, changed: isChanged });
    }
  });
  return segments;
}

function groupHunks(all: DiffLine[], context: number): DiffHunk[] {
  // Index ranges into `all` to show: each changed line with `context` lines either side, merged
  // where they touch or overlap.
  const ranges: { start: number; end: number }[] = [];
  all.forEach((line, index) => {
    if (line.kind === "context") {
      return;
    }
    const start = Math.max(0, index - context);
    const end = Math.min(all.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  });

  return ranges.map(({ start, end }) => {
    const lines = all.slice(start, end + 1);
    const baseNumbers = lines.flatMap((line) =>
      line.kind === "added" ? [] : [line.baseLine],
    );
    const headNumbers = lines.flatMap((line) =>
      line.kind === "removed" ? [] : [line.headLine],
    );
    return {
      baseStart: baseNumbers[0] ?? lineBefore(all, start, "base"),
      baseLines: baseNumbers.length,
      headStart: headNumbers[0] ?? lineBefore(all, start, "head"),
      headLines: headNumbers.length,
      lines,
    };
  });
}

// The last line number on one side before `index`, for a hunk with no line on that side.
function lineBefore(all: DiffLine[], index: number, side: "base" | "head") {
  for (let at = index - 1; at >= 0; at -= 1) {
    const line = all[at] as DiffLine;
    if (side === "base" && line.kind !== "added") {
      return line.baseLine;
    }
    if (side === "head" && line.kind !== "removed") {
      return line.headLine;
    }
  }
  return 0;
}

/**
 * Runs of lines identical on both sides, 1-based: base lines `base .. base + length - 1` are head
 * lines `head .. head + length - 1`. Plain data, so it can travel in a JSON payload.
 */
export type LineRun = { base: number; head: number; length: number };

/** Which lines of the head are unchanged lines of the base, and where they were. */
export function lineCorrespondence(
  baseText: string,
  headText: string,
): LineRun[] {
  return lineRuns(
    splitLines(normalizeText(baseText)),
    splitLines(normalizeText(headText)),
  )
    .filter((run) => run.kind === "equal")
    .map((run) => ({
      base: run.baseStart + 1,
      head: run.headStart + 1,
      length: run.length,
    }));
}

/**
 * Whether head lines `start .. end` still show what base lines `start .. end` showed: each is an
 * unchanged line that has not moved. A link to `file.ts#L12-L20` written against the base points at
 * different code when lines in that range were edited, or when a change above it shifted them —
 * and at the same code again when changes above it cancel out.
 */
export function lineRangeKept(
  runs: readonly LineRun[],
  start: number,
  end: number,
): boolean {
  for (let line = start; line <= end; line += 1) {
    const covering = runs.find(
      (run) => line >= run.head && line < run.head + run.length,
    );
    if (covering === undefined || covering.base !== covering.head) {
      return false;
    }
  }
  return start <= end;
}
