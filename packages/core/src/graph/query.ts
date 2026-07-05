import type { ContextGraph, ContextGraphEdgeType } from "./context-graph-types.js";

// P4.03 unified traversal (G2): the one BFS that `slice`/`impact`/MCP/compile call instead of each
// hand-rolling its own walk. Cycle-safety is by construction — a node enters `visited` at most once
// and is never re-expanded — so cyclic graphs terminate without any cycle-removal step; GRP-001
// (`graph.cycles`) stays the sole owner of *reporting* cycles.

const byPath = (left: string, right: string): number => left.localeCompare(right);

export type QueryDirection = "forward" | "reverse";

export type QueryOptions = {
  // Repo-relative POSIX node path to start the traversal from.
  start: string;
  direction: QueryDirection;
  // Hop bound; omitted traverses to exhaustion (full closure).
  depth?: number;
  // `undefined` follows every edge type; `[]` follows none (start-only result) — documented
  // explicitly because the two are easy to conflate at call sites.
  edgeTypes?: ContextGraphEdgeType[];
};

export type QueryVisit = {
  path: string;
  // Hops from `start`; the start node itself is 0.
  depth: number;
  // Predecessor node path that first reached this node; null for `start`. Kept as a node path
  // (not the edge) — minimal per YAGNI, richer edge metadata can be added when a phase needs it.
  via: string | null;
};

export type QueryResult = {
  visited: QueryVisit[];
};

// Directional, typed, deduped adjacency local to this module: forward reads `from -> to`, reverse
// reads `to -> from`. Deliberately not `buildDedupedViews` from graph-algorithms.ts — that helper is
// untyped, forward-only, and has no predecessor direction, so it cannot serve `impact`'s reverse walk.
function buildAdjacency(
  graph: ContextGraph,
  direction: QueryDirection,
  edgeTypes: ContextGraphEdgeType[] | undefined
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacency.set(node.path, []);
  }

  // One entry per distinct (source,target): the builder never emits self-edges, but guarding here
  // matches graph-algorithms.ts and keeps this correct for any caller-supplied graph.
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === edge.to) {
      continue;
    }
    if (edgeTypes !== undefined && !edgeTypes.includes(edge.type)) {
      continue;
    }
    const source = direction === "forward" ? edge.from : edge.to;
    const target = direction === "forward" ? edge.to : edge.from;
    const key = `${source} ${target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    adjacency.get(source)?.push(target);
  }

  for (const neighbors of adjacency.values()) {
    neighbors.sort(byPath);
  }
  return adjacency;
}

export function query(graph: ContextGraph, options: QueryOptions): QueryResult {
  const { start, direction, depth: maxDepth, edgeTypes } = options;
  if (!graph.nodes.some((node) => node.path === start)) {
    return { visited: [] };
  }

  const adjacency = buildAdjacency(graph, direction, edgeTypes);
  const visited = new Map<string, QueryVisit>();
  visited.set(start, { path: start, depth: 0, via: null });

  // Level-order BFS. `frontier` is always kept sorted, so within a level the smallest node is
  // processed first — the first predecessor to reach an unvisited neighbor claims it, giving a
  // deterministic `via` (smallest predecessor at minimal depth) without a tie-break pass.
  let frontier = [start];
  let currentDepth = 0;
  while (frontier.length > 0 && (maxDepth === undefined || currentDepth < maxDepth)) {
    const nextDepth = currentDepth + 1;
    const nextFrontier: string[] = [];
    for (const current of frontier) {
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.set(neighbor, { path: neighbor, depth: nextDepth, via: current });
        nextFrontier.push(neighbor);
      }
    }
    nextFrontier.sort(byPath);
    frontier = nextFrontier;
    currentDepth = nextDepth;
  }

  return { visited: [...visited.values()].sort((left, right) => byPath(left.path, right.path)) };
}

export function slice(
  graph: ContextGraph,
  start: string,
  depth = 2,
  edgeTypes?: ContextGraphEdgeType[]
): QueryResult {
  return query(graph, { start, direction: "forward", depth, edgeTypes });
}

export function impact(graph: ContextGraph, start: string, edgeTypes?: ContextGraphEdgeType[]): QueryResult {
  // No depth ⇒ full closure: blast-radius analysis needs every upstream reference, not a bounded
  // neighborhood.
  return query(graph, { start, direction: "reverse", edgeTypes });
}
