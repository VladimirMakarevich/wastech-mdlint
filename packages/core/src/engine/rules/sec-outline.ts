import type { ParsedHeading } from "../../markdown/document-types.js";

// Strict outline matching for SEC-003: a document's heading sequence must match a template's
// heading sequence exactly, where a template heading whose text is exactly `*`, `+` or `?` is a
// wildcard over document headings. Pure over parsed headings, so it needs no filesystem to test.

// `literal` consumes one heading with the same text and depth, `one` consumes exactly one heading,
// `many` consumes zero or more. `source` is the template heading the item came from, so a message
// can quote what the author wrote rather than the compiled form.
export type OutlineItem = {
  kind: "literal" | "one" | "many";
  text: string;
  depth: number;
  source: ParsedHeading;
};

// `expected` undefined means the outline was already complete (the document has an extra heading);
// `actual` undefined means the document ended while the outline still required something.
export type OutlineDivergence = {
  expected: ParsedHeading | undefined;
  actual: ParsedHeading | undefined;
};

export function compileOutline(headings: ParsedHeading[]): OutlineItem[] {
  const items: OutlineItem[] = [];
  for (const heading of headings) {
    const base = { text: heading.text, depth: heading.depth, source: heading };
    if (heading.text === "?") {
      items.push({ ...base, kind: "one" });
    } else if (heading.text === "*") {
      items.push({ ...base, kind: "many" });
    } else if (heading.text === "+") {
      // `+` is `?` followed by `*`. Compiling it away keeps the matcher to three item kinds; both
      // halves keep the `+` heading as `source`, so a divergence still names `+`, never `?` or `*`.
      items.push({ ...base, kind: "one" }, { ...base, kind: "many" });
    } else {
      items.push({ ...base, kind: "literal" });
    }
  }
  return items;
}

// A literal matches on exact depth, because heading levels are part of the outline. A wildcard
// matches any heading at its depth or deeper, so `## *` can absorb an extra section together with
// its `###` subsections; demanding exact depth would force authors to spell out every nested
// heading. It never matches a shallower heading, so `## *` cannot swallow the next `#` section.
function itemMatches(item: OutlineItem, heading: ParsedHeading): boolean {
  if (item.kind === "literal") {
    return item.text === heading.text && item.depth === heading.depth;
  }
  return heading.depth >= item.depth;
}

// Epsilon closure: a `many` item may match nothing, so being at it also means being past it. The
// result is sorted ascending so every later choice made from it is independent of insertion order.
function closure(items: OutlineItem[], positions: Iterable<number>): number[] {
  const reached = new Set<number>();
  const pending = [...positions];
  while (pending.length > 0) {
    const position = pending.pop()!;
    if (reached.has(position)) {
      continue;
    }
    reached.add(position);
    if (position < items.length && items[position]!.kind === "many") {
      pending.push(position + 1);
    }
  }
  return [...reached].sort((a, b) => a - b);
}

// The unmet requirement among the live positions: the earliest non-`*` item, since a `*` alone
// never demands anything and the earliest requirement is the first one the document failed to
// meet (`* A * B` against `A`, `# Z` names `A`); failing that the earliest `*` (its depth check is
// what failed); failing that nothing, meaning the outline was already complete. `states` arrives
// sorted ascending, so the choice never depends on the order positions were reached in.
function chooseExpected(
  items: OutlineItem[],
  states: number[],
): ParsedHeading | undefined {
  const live = states.filter((position) => position < items.length);
  const required = live.find((position) => items[position]!.kind !== "many");
  const chosen = required ?? live[0];
  return chosen === undefined ? undefined : items[chosen]!.source;
}

// Simulates the outline as an NFA over template positions rather than backtracking, so adjacent
// wildcards (`* *`, `+ ?`) cost polynomial time — each heading touches at most one state per
// template position, plus sorting that state set — instead of an exponential search. Only the
// first divergence is returned: once the outline is broken, which template position later
// headings "should" line up with is ambiguous, and guessing would produce misleading findings.
export function matchOutline(
  outline: OutlineItem[],
  headings: ParsedHeading[],
): OutlineDivergence | undefined {
  let states = closure(outline, [0]);
  for (const heading of headings) {
    const next = new Set<number>();
    for (const position of states) {
      const item = outline[position];
      if (item === undefined || !itemMatches(item, heading)) {
        continue;
      }
      next.add(item.kind === "many" ? position : position + 1);
    }
    if (next.size === 0) {
      return { expected: chooseExpected(outline, states), actual: heading };
    }
    states = closure(outline, next);
  }
  if (!states.includes(outline.length)) {
    return { expected: chooseExpected(outline, states), actual: undefined };
  }
  return undefined;
}

export function formatOutlineHeading(heading: ParsedHeading): string {
  return `${"#".repeat(heading.depth)} ${heading.text}`;
}
