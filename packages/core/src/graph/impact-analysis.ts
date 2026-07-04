import path from "node:path";

import { normalizeRelativePath } from "../discovery/globs.js";
import type { ContextGraph } from "./context-graph-types.js";
import { topologicalSort } from "./graph-algorithms.js";
import { impact, type QueryVisit } from "./query.js";

// P4.05 impact analysis (G2 hand-off): the blast radius of changing a file, built entirely on the
// P4.03 reverse traversal (`impact`) and the P4.02 topo-sort. No new traversal is written here —
// the architecture invariant is "one traversal, one topo-sort", not per-feature reimplementations.

const byPath = (left: string, right: string): number => left.localeCompare(right);

// Thrown when the requested file is not a node in the graph (typo, or excluded by config globs).
// Mirrors the ConfigError/RuleResolutionError dedicated-error pattern so a host (P4.07 CLI, P7 MCP
// M6) can catch this type specifically and render its `.hint` instead of a bare stack trace. No
// "did you mean" suggestion: that would make the error's shape depend on corpus contents, which
// cuts against deterministic, reproducible diagnostics.
export class ImpactAnalysisError extends Error {
  readonly hint: string;

  constructor(file: string) {
    const hint =
      "The path must be repository-relative POSIX (for example \"docs/guide.md\") and included " +
      "by the configured file globs.";
    super(`File not found in the context graph: "${file}". ${hint}`);
    this.name = "ImpactAnalysisError";
    this.hint = hint;
  }
}

// Shared by getImpactSet/classifyImpact so both reject an out-of-corpus file the same way instead
// of duplicating the normalize-then-check sequence.
function requireNode(graph: ContextGraph, file: string): string {
  const normalized = normalizeRelativePath(file);
  if (!graph.nodes.some((node) => node.path === normalized)) {
    throw new ImpactAnalysisError(normalized);
  }
  return normalized;
}

/**
 * Every file transitively affected by a change to `file`, excluding `file` itself. Unbounded on
 * purpose (task constraint): a depth cap would silently drop genuinely-affected files, and a large
 * result for a heavily-referenced hub is the correct answer, not a bug. `impact`'s mandatory
 * visited-set still bounds the walk to O(nodes+edges) on cyclic graphs, so "no limit" here does not
 * mean "no termination guarantee".
 */
export function getImpactSet(graph: ContextGraph, file: string): QueryVisit[] {
  const start = requireNode(graph, file);
  return impact(graph, start).visited.filter((visit) => visit.depth > 0);
}

export type DirectlyAffected = { path: string; references: number };
export type TransitivelyAffected = { path: string; depth: number; via: string };

export type ImpactClassification = {
  file: string;
  directlyAffected: DirectlyAffected[];
  transitivelyAffected: TransitivelyAffected[];
  readingOrder: string[];
  excluded: string[];
};

export function classifyImpact(graph: ContextGraph, file: string): ImpactClassification {
  const start = requireNode(graph, file);
  const visited = impact(graph, start).visited;

  const directlyAffected: DirectlyAffected[] = visited
    .filter((visit) => visit.depth === 1)
    .map((visit) => ({
      path: visit.path,
      // Retained edge multiplicity (P4.01 constraint, mirrored from graph-algorithms.ts's degree
      // semantics): two `visit.path -> start` links are two references, not one deduped edge.
      references: graph.edges.filter((edge) => edge.from === visit.path && edge.to === start).length
    }))
    .sort((left, right) => byPath(left.path, right.path));

  const transitivelyAffected: TransitivelyAffected[] = visited
    .filter((visit) => visit.depth >= 2)
    .map((visit) => ({
      path: visit.path,
      depth: visit.depth,
      // `via` is null only for the depth-0 start (query.ts); every depth>=2 visit has a real
      // predecessor. `?? ""` mirrors search-index.ts's compareVisit rather than a non-null
      // assertion, so a future change to that invariant fails loudly as a wrong value, not a crash.
      via: visit.via ?? ""
    }))
    .sort((left, right) => byPath(left.path, right.path));

  // Reading order runs over the affected subgraph: the changed file plus everything upstream of
  // it, restricted to edges with both endpoints inside that set. `topologicalSort` reads only
  // `nodes`/`edges` (never `cycles`), so an empty `cycles` here is safe — GRP-001 remains the sole
  // owner of cycle *reporting*.
  const affectedPaths = new Set(visited.map((visit) => visit.path));
  const subgraph: ContextGraph = {
    nodes: graph.nodes.filter((node) => affectedPaths.has(node.path)),
    edges: graph.edges.filter((edge) => affectedPaths.has(edge.from) && affectedPaths.has(edge.to)),
    cycles: []
  };
  const { order, excluded } = topologicalSort(subgraph);

  return { file: start, directlyAffected, transitivelyAffected, readingOrder: order, excluded };
}

/**
 * Re-express every path in `impactResult` relative to `cwd`. `cwd` is repo-relative (a host with an
 * absolute invocation directory converts it to repo-relative before calling), so the repo root is
 * `""` and maps to an identity relativization — core stays platform-agnostic and never needs a
 * repo-root parameter. Path-sorted arrays (`directlyAffected`, `transitivelyAffected`, `excluded`)
 * are re-sorted after relativizing because changing the path changes the sort key; `readingOrder`
 * is topological, not lexical, so it is only mapped — re-sorting it would silently replace the
 * topo-sort's reading order with an alphabetical one.
 */
export function relativizeImpact(impactResult: ImpactClassification, cwd: string): ImpactClassification {
  const normalizedCwd = normalizeRelativePath(cwd);
  const relativize = (value: string): string => path.posix.relative(normalizedCwd, value);

  const directlyAffected = impactResult.directlyAffected
    .map((entry) => ({ ...entry, path: relativize(entry.path) }))
    .sort((left, right) => byPath(left.path, right.path));

  const transitivelyAffected = impactResult.transitivelyAffected
    .map((entry) => ({ ...entry, path: relativize(entry.path), via: relativize(entry.via) }))
    .sort((left, right) => byPath(left.path, right.path));

  return {
    file: relativize(impactResult.file),
    directlyAffected,
    transitivelyAffected,
    readingOrder: impactResult.readingOrder.map(relativize),
    excluded: [...impactResult.excluded.map(relativize)].sort(byPath)
  };
}
