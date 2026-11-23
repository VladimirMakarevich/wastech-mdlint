import type { LintConfig } from "../config/config-schema.js";
import { compareStrings } from "../deterministic-sort.js";
import { matchesConfigGlob } from "../discovery/globs.js";
import { ruleRegistry } from "../engine/rules/index.js";
import type { GitChange } from "../git/git-repository.js";
import type { ContextGraph } from "../graph/context-graph-types.js";
import { impact, query } from "../graph/query.js";

// The order a reviewer with limited attention should read a change set in: what reaches every
// agent session first, then what the most other documents depend on. Alphabetical order would put
// a typo fix in a glossary ahead of an edit to the rules every session loads.

const EAGER_CONTEXT_RULE = "LLM-001";

/**
 * The documents loaded into every agent session: the entrypoints LLM-001 is configured with, and
 * everything they eagerly import, followed through the graph's `import` edges — the same edges the
 * rule and compile's context budget walk. Empty when LLM-001 is not configured, since only that
 * rule says which files are entrypoints.
 */
export function eagerContextPaths(
  graph: ContextGraph,
  config: LintConfig,
): Set<string> {
  const patterns = (config.rules ?? []).flatMap((entry) => {
    if (
      entry.rule === "custom" ||
      !ruleRegistry.has(entry.rule) ||
      ruleRegistry.resolveId(entry.rule) !== EAGER_CONTEXT_RULE ||
      entry.severity === "off"
    ) {
      return [];
    }
    const entrypoints = (entry.options as { entrypoints?: unknown } | undefined)
      ?.entrypoints;
    return Array.isArray(entrypoints)
      ? entrypoints.filter(
          (pattern): pattern is string => typeof pattern === "string",
        )
      : [];
  });
  const eager = new Set<string>();
  if (patterns.length === 0) {
    return eager;
  }
  for (const node of graph.nodes) {
    if (!matchesConfigGlob(node.path, patterns)) {
      continue;
    }
    for (const visit of query(graph, {
      start: node.path,
      direction: "forward",
      edgeTypes: ["import"],
    }).visited) {
      eager.add(visit.path);
    }
  }
  return eager;
}

export type RankedChange = GitChange & {
  /** Loaded into every agent session (see `eagerContextPaths`). */
  eager: boolean;
  /**
   * How many documents reach this one through links and imports, directly or through others — how
   * far a change to it travels. 0 for a deleted document, which the current graph no longer holds.
   */
  reach: number;
};

/**
 * Changes ordered by influence: eagerly loaded documents first, then by reach, most first, then by
 * path in code-point order, so the order is the same on every machine.
 */
export function rankByInfluence(
  changes: readonly GitChange[],
  context: { graph: ContextGraph; eager: ReadonlySet<string> },
): RankedChange[] {
  const nodes = new Set(context.graph.nodes.map((node) => node.path));
  return changes
    .map((change) => ({
      ...change,
      eager: context.eager.has(change.path),
      reach: nodes.has(change.path)
        ? impact(context.graph, change.path).visited.length - 1
        : 0,
    }))
    .sort(
      (left, right) =>
        Number(right.eager) - Number(left.eager) ||
        right.reach - left.reach ||
        compareStrings(left.path, right.path),
    );
}
