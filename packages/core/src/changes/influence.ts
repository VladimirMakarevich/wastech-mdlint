import type { LintConfig } from "../config/config-schema.js";
import { compareStrings } from "../deterministic-sort.js";
import { matchesConfigGlob } from "../discovery/globs.js";
import { ruleRegistry } from "../engine/rules/index.js";
import { eagerContextTokens } from "../engine/rules/llm.js";
import type { SiteRouterSettings } from "../engine/types.js";
import type { GitChange } from "../git/git-repository.js";
import type { ContextGraph } from "../graph/context-graph-types.js";
import { impact, query } from "../graph/query.js";
import type { ParsedDocument } from "../markdown/document-types.js";

// The order a reviewer with limited attention should read a change set in: what reaches every
// agent session first, then what the most other documents depend on. Alphabetical order would put
// a typo fix in a glossary ahead of an edit to the rules every session loads.

const EAGER_CONTEXT_RULE = "LLM-001";

// LLM-001's entries in a config that is turned on: which files are entrypoints, and the budget the
// rule holds each to. Read from the raw options, which the config loader has already validated
// against the rule's schema when the rule runs at all.
function eagerContextEntries(
  config: LintConfig,
): { entrypoints: string[]; maxTokens: number | undefined }[] {
  return (config.rules ?? []).flatMap((entry) => {
    if (
      entry.rule === "custom" ||
      !ruleRegistry.has(entry.rule) ||
      ruleRegistry.resolveId(entry.rule) !== EAGER_CONTEXT_RULE ||
      entry.severity === "off"
    ) {
      return [];
    }
    const options = entry.options as
      | { entrypoints?: unknown; maxTokensPerEntrypoint?: unknown }
      | undefined;
    const entrypoints = Array.isArray(options?.entrypoints)
      ? options.entrypoints.filter(
          (pattern): pattern is string => typeof pattern === "string",
        )
      : [];
    const maxTokens = options?.maxTokensPerEntrypoint;
    return [
      {
        entrypoints,
        maxTokens: typeof maxTokens === "number" ? maxTokens : undefined,
      },
    ];
  });
}

/**
 * The documents loaded into every agent session: the entrypoints LLM-001 is configured with, and
 * everything they eagerly import, followed through the graph's `import` edges - the same edges the
 * rule and compile's context budget walk. Empty when LLM-001 is not configured, since only that
 * rule says which files are entrypoints.
 */
export function eagerContextPaths(
  graph: ContextGraph,
  config: LintConfig,
): Set<string> {
  const patterns = eagerContextEntries(config).flatMap(
    (entry) => entry.entrypoints,
  );
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

export type EagerContextBudget = {
  entrypoint: string;
  /** Estimated tokens of the entrypoint and everything it eagerly imports, as LLM-001 counts them. */
  tokens: number;
  importedFiles: number;
  maxTokens: number;
};

/**
 * Every LLM-001 entrypoint among `documents` with what it loads into every agent session and the
 * budget it is held to, in path order. The total comes from `eagerContextTokens`, the function the
 * rule checks the budget with, so the number shown beside a budget is the number the rule judges.
 */
export function eagerContextBudgets(
  documents: Map<string, ParsedDocument>,
  config: LintConfig,
  siteRouter?: SiteRouterSettings,
): EagerContextBudget[] {
  const budgets = new Map<string, EagerContextBudget>();
  for (const entry of eagerContextEntries(config)) {
    if (entry.maxTokens === undefined) {
      continue;
    }
    for (const entrypoint of documents.keys()) {
      if (
        budgets.has(entrypoint) ||
        !matchesConfigGlob(entrypoint, entry.entrypoints)
      ) {
        continue;
      }
      const context = eagerContextTokens(entrypoint, documents, siteRouter);
      if (context !== undefined) {
        budgets.set(entrypoint, {
          entrypoint,
          ...context,
          maxTokens: entry.maxTokens,
        });
      }
    }
  }
  return [...budgets.values()].sort((left, right) =>
    compareStrings(left.entrypoint, right.entrypoint),
  );
}

export type RankedChange = GitChange & {
  /** Loaded into every agent session (see `eagerContextPaths`). */
  eager: boolean;
  /**
   * How many documents reach this one through links and imports, directly or through others - how
   * far a change to it travels. 0 for a deleted document, which the current graph no longer holds.
   */
  reach: number;
};

/**
 * Changes ordered by influence: eagerly loaded documents first, then those the change gave new
 * errors (`newErrors`, when known), then by reach, most first, then by path in code-point order, so
 * the order is the same on every machine.
 */
export function rankByInfluence(
  changes: readonly GitChange[],
  context: {
    graph: ContextGraph;
    eager: ReadonlySet<string>;
    newErrors?: ReadonlySet<string>;
  },
): RankedChange[] {
  const nodes = new Set(context.graph.nodes.map((node) => node.path));
  const newErrors = context.newErrors ?? new Set<string>();
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
        Number(newErrors.has(right.path)) - Number(newErrors.has(left.path)) ||
        right.reach - left.reach ||
        compareStrings(left.path, right.path),
    );
}
