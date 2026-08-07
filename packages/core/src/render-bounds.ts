// Shared bounds for the two human-facing renderers. A sibling of
// `deterministic-sort.ts` rather than a helper inside either renderer: `graph/graph-render.ts` and
// `compile/synthesize.ts` both render a cycle path, and a helper owned by one of them would make
// the other import across a layer boundary it otherwise never crosses.
//
// Everything here is a *fixed* bound, never corpus-relative. A cap derived from corpus size cannot
// be stated in the artifact as a rule a reader can apply — "eight hops" means the same thing in
// every repository, "one tenth of the nodes" does not — and it would let an unrelated file silently
// change how one already-elided line renders.

/**
 * Maximum node entries rendered in one cycle path before it is elided.
 *
 * A cycle path is the one line in either renderer whose length is driven by graph shape rather than
 * by an authored list: a 100-node strongly connected component produces a ~3 500-character single
 * line in both `formatContextGraphSummary` and the generated `SKILL.md`. The fixture's cycle is 3
 * nodes, so without this the "no line exceeds N characters" property would be true of the fixture
 * and false of the product.
 */
export const CYCLE_PATH_HOP_LIMIT = 8;

/**
 * Render a closed cycle path (`[a, b, …, a]`) as `a -> b -> … -> a`, eliding the middle past
 * {@link CYCLE_PATH_HOP_LIMIT} and stating how many entries were dropped.
 *
 * The head/tail split keeps the two entries a reader actually uses — where the cycle starts and
 * that it closes on the same node — and the elision is ASCII `...`, not `…`, because this reaches a
 * Windows terminal whose code page may not carry the ellipsis character.
 */
export function formatCyclePath(cycle: readonly string[]): string {
  if (cycle.length <= CYCLE_PATH_HOP_LIMIT) {
    return cycle.join(" -> ");
  }

  const head = cycle.slice(0, CYCLE_PATH_HOP_LIMIT - 1);
  const omitted = cycle.length - CYCLE_PATH_HOP_LIMIT;
  return `${[...head, "...", cycle.at(-1)].join(" -> ")} (+${omitted} more hops)`;
}
