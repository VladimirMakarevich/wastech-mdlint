// A shortest edit script between two sequences — Myers' O(ND) algorithm — for lines, words and
// table cells alike. Written here rather than taken from a package: core is published, the
// algorithm is short, and the review needs custom equality (a table cell compared without its
// padding) that a text-oriented library would have to be bent to. Its output is deterministic for a
// given input, as every report in this product has to be.

/**
 * A run of the edit script, 0-based: `equal` covers `length` items at `baseStart` and `headStart`,
 * `delete` covers `length` items of the base at `baseStart`, `insert` `length` items of the head at
 * `headStart`. Runs are in order and cover both sequences exactly once.
 */
export type DiffRun = {
  kind: "equal" | "delete" | "insert";
  baseStart: number;
  headStart: number;
  length: number;
};

/**
 * Myers keeps one row of frontier positions per edit, so time and memory grow with the square of
 * the number of edits. Past this many edits the two sides are treated as wholly replaced between
 * their common start and end: for two texts that different, a minimal script tells a reader
 * nothing a plain "replaced" does not.
 */
export const DEFAULT_MAX_EDITS = 2000;

export function diffSequences<T>(
  base: readonly T[],
  head: readonly T[],
  equals: (left: T, right: T) => boolean = Object.is,
  maxEdits: number = DEFAULT_MAX_EDITS,
): DiffRun[] {
  // The common start and end never take part in the search, which keeps the typical review — a few
  // edits in a long document — far from the edit limit.
  let prefix = 0;
  while (
    prefix < base.length &&
    prefix < head.length &&
    equals(base[prefix] as T, head[prefix] as T)
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < head.length - prefix &&
    equals(
      base[base.length - 1 - suffix] as T,
      head[head.length - 1 - suffix] as T,
    )
  ) {
    suffix += 1;
  }

  const middle = diffMiddle(
    base.slice(prefix, base.length - suffix),
    head.slice(prefix, head.length - suffix),
    equals,
    maxEdits,
  );

  const runs: DiffRun[] = [];
  const push = (run: DiffRun) => {
    if (run.length === 0) {
      return;
    }
    const last = runs[runs.length - 1];
    if (
      last?.kind === run.kind &&
      last.baseStart + (run.kind === "insert" ? 0 : last.length) ===
        run.baseStart &&
      last.headStart + (run.kind === "delete" ? 0 : last.length) ===
        run.headStart
    ) {
      last.length += run.length;
      return;
    }
    runs.push({ ...run });
  };
  push({ kind: "equal", baseStart: 0, headStart: 0, length: prefix });
  for (const run of middle) {
    push({
      ...run,
      baseStart: run.baseStart + prefix,
      headStart: run.headStart + prefix,
    });
  }
  push({
    kind: "equal",
    baseStart: base.length - suffix,
    headStart: head.length - suffix,
    length: suffix,
  });
  return runs;
}

type Step = { kind: DiffRun["kind"]; base: number; head: number };

function diffMiddle<T>(
  base: readonly T[],
  head: readonly T[],
  equals: (left: T, right: T) => boolean,
  maxEdits: number,
): DiffRun[] {
  const n = base.length;
  const m = head.length;
  const replaced: DiffRun[] = [
    { kind: "delete", baseStart: 0, headStart: 0, length: n },
    { kind: "insert", baseStart: n, headStart: 0, length: m },
  ];
  if (n === 0 || m === 0) {
    return replaced;
  }

  const max = Math.min(n + m, maxEdits);
  // `frontier[k + offset]` is the furthest base index reached on diagonal `k = x - y`. Each edit
  // count's row is kept, trimmed to the diagonals the next one reads, so the script can be traced back.
  const offset = max + 1;
  const frontier = new Int32Array(2 * max + 3);
  const rows: Int32Array[] = [];

  for (let edits = 0; edits <= max; edits += 1) {
    rows.push(frontier.slice(offset - edits - 1, offset + edits + 2));
    for (let k = -edits; k <= edits; k += 2) {
      // Down (an insertion) when on the lowest diagonal, or when the diagonal above reached further;
      // right (a deletion) otherwise. A fixed rule, so equal inputs always give equal scripts.
      const down =
        k === -edits ||
        (k !== edits && frontier[offset + k - 1]! < frontier[offset + k + 1]!);
      let x = down ? frontier[offset + k + 1]! : frontier[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && equals(base[x] as T, head[y] as T)) {
        x += 1;
        y += 1;
      }
      frontier[offset + k] = x;
      if (x >= n && y >= m) {
        return toRuns(traceBack(rows, base.length, head.length));
      }
    }
  }
  return replaced;
}

function traceBack(rows: Int32Array[], n: number, m: number): Step[] {
  const steps: Step[] = [];
  let x = n;
  let y = m;
  for (let edits = rows.length - 1; edits >= 0; edits -= 1) {
    const row = rows[edits]!;
    // `row` holds diagonals -edits-1 .. edits+1 of the frontier before this edit count's pass.
    const at = (k: number) => row[k + edits + 1]!;
    const k = x - y;
    const down = k === -edits || (k !== edits && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = edits === 0 ? 0 : at(previousK);
    const previousY = edits === 0 ? 0 : previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      steps.push({ kind: "equal", base: x, head: y });
    }
    if (edits > 0) {
      if (down) {
        steps.push({ kind: "insert", base: x, head: previousY });
      } else {
        steps.push({ kind: "delete", base: previousX, head: y });
      }
      x = previousX;
      y = previousY;
    }
  }
  return steps.reverse();
}

function toRuns(steps: Step[]): DiffRun[] {
  const runs: DiffRun[] = [];
  for (const step of steps) {
    const last = runs[runs.length - 1];
    if (last?.kind === step.kind) {
      last.length += 1;
    } else {
      runs.push({
        kind: step.kind,
        baseStart: step.base,
        headStart: step.head,
        length: 1,
      });
    }
  }
  return runs;
}
