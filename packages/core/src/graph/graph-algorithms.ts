import { compareStrings } from "../deterministic-sort.js";
import type { ContextGraph } from "./context-graph-types.js";

// P4.02 graph algorithms over the frozen `ContextGraph` read shape (G6): Kahn topo-sort with honest
// cycle-exclusion reporting, undirected connected components, and a deterministic summary. The
// cycles themselves are already computed by P4.01's Tarjan pass and stored on `graph.cycles`; this
// module consumes that data (that *is* the "reuse the existing Tarjan implementation" the task asks
// for) rather than re-running SCC. Every returned array is sorted before it leaves a function, and
// all ordering uses the shared host-independent string comparator on repo-relative POSIX node paths
// — matching build-context-graph.ts — so output is byte-stable across filesystems.

const byPath = compareStrings;

// Deduped, reachability-oriented views of the edge list. `node.inDegree` and the raw edge list
// retain edge multiplicity (P4.01 constraint: two `A→B` edges are two references), but the algorithms
// here reason about *whether* one node reaches another, where a repeated edge is the same
// relationship. Collapsing parallel edges is not cosmetic: Kahn's would otherwise leave a node fed by
// a doubled `A→B` stuck at in-degree 2, never reaching zero, and wrongly report it as cycle-excluded.
// Multiplicity stays only for `references`/degree display (collapsing it globally is G7 backlog).
type DedupedViews = {
  successors: Map<string, string[]>;
  inDegree: Map<string, number>;
  undirected: Map<string, string[]>;
};

function buildDedupedViews(graph: ContextGraph): DedupedViews {
  const successors = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const undirected = new Map<string, string[]>();
  for (const node of graph.nodes) {
    successors.set(node.path, []);
    inDegree.set(node.path, 0);
    undirected.set(node.path, []);
  }

  // One entry per distinct (from,to): the builder never emits self-edges, but guarding here keeps the
  // algorithms correct for any caller-supplied graph — a self-loop would deadlock Kahn's.
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === edge.to) {
      continue;
    }
    const key = `${edge.from} ${edge.to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    successors.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    undirected.get(edge.from)?.push(edge.to);
    undirected.get(edge.to)?.push(edge.from);
  }

  for (const neighbors of successors.values()) {
    neighbors.sort(byPath);
  }
  for (const neighbors of undirected.values()) {
    neighbors.sort(byPath);
  }
  return { successors, inDegree, undirected };
}

export type TopologicalSortResult = {
  // Reading order: a node appears only after every node that links to it, ties broken by path.
  order: string[];
  // Nodes never emitted — cycle members plus everything reachable only through them. This is the G6
  // honesty fix: the legacy topo silently truncated to a shorter array, hiding the loss; here the
  // excluded set is reported explicitly so callers can state *what* the cycles (see `graph.cycles`)
  // kept out of reading order.
  excluded: string[];
};

export function topologicalSort(graph: ContextGraph): TopologicalSortResult {
  const { successors, inDegree } = buildDedupedViews(graph);

  // Sorted zero-in-degree frontier, kept ordered so each Kahn step emits the lexicographically
  // smallest available node (deterministic across filesystems).
  const queue = [...inDegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([nodePath]) => nodePath)
    .sort(byPath);

  const order: string[] = [];
  while (queue.length > 0) {
    const nodePath = queue.shift()!;
    order.push(nodePath);
    for (const successor of successors.get(nodePath) ?? []) {
      const remaining = (inDegree.get(successor) ?? 0) - 1;
      inDegree.set(successor, remaining);
      if (remaining === 0) {
        // Binary-insert to keep the frontier sorted without re-sorting the whole queue each step.
        queue.splice(lowerBound(queue, successor), 0, successor);
      }
    }
  }

  const emitted = new Set(order);
  const excluded = graph.nodes
    .map((node) => node.path)
    .filter((nodePath) => !emitted.has(nodePath))
    .sort(byPath);

  return { order, excluded };
}

// Insertion index that keeps `sorted` ordered by `byPath`.
function lowerBound(sorted: string[], value: string): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (byPath(sorted[mid]!, value) < 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export function getComponents(graph: ContextGraph): string[][] {
  const { undirected } = buildDedupedViews(graph);
  const visited = new Set<string>();
  const components: string[][] = [];

  // Seed BFS in sorted node path order so which node represents a component (and the discovery order)
  // is deterministic. Every node participates, so isolated files surface as singleton components.
  for (const node of [...graph.nodes].sort((left, right) => byPath(left.path, right.path))) {
    if (visited.has(node.path)) {
      continue;
    }
    const component: string[] = [];
    const frontier = [node.path];
    visited.add(node.path);
    while (frontier.length > 0) {
      const current = frontier.shift()!;
      component.push(current);
      for (const neighbor of undirected.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          frontier.push(neighbor);
        }
      }
    }
    component.sort(byPath);
    components.push(component);
  }

  // Size descending, then by the component's smallest node path ascending — after the per-component
  // sort above that smallest path is `component[0]` (audit — P4 component-sort gap).
  components.sort((left, right) => right.length - left.length || byPath(left[0]!, right[0]!));
  return components;
}

// Hubs are ranked by total degree (`inDegree + outDegree`): the most-connected documents, which a
// reader or maintainer most needs to know about. Capped so the summary stays bounded on large corpora.
const TOP_HUB_LIMIT = 5;

export function formatContextGraphSummary(graph: ContextGraph): string {
  // Entry points use the retained-multiplicity `inDegree`; the zero test is identical under dedup, so
  // no deduped view is needed here.
  const entryPoints = graph.nodes
    .filter((node) => node.inDegree === 0)
    .map((node) => node.path)
    .sort(byPath);

  const hubs = [...graph.nodes]
    .sort(
      (left, right) =>
        right.inDegree + right.outDegree - (left.inDegree + left.outDegree) || byPath(left.path, right.path)
    )
    .slice(0, TOP_HUB_LIMIT);

  const lines = [
    `nodes: ${graph.nodes.length}`,
    `edges: ${graph.edges.length}`,
    `cycles: ${graph.cycles.length}`,
    `entry points (${entryPoints.length}): ${entryPoints.join(", ")}`,
    "top hubs:"
  ];
  for (const hub of hubs) {
    lines.push(`  ${hub.path} (${hub.inDegree + hub.outDegree})`);
  }
  // Reading-order output must report what cycles excluded: list them here, rendered like GRP-001.
  if (graph.cycles.length > 0) {
    lines.push("cycles:");
    for (const cycle of graph.cycles) {
      lines.push(`  ${cycle.join(" -> ")}`);
    }
  }
  return lines.join("\n");
}
