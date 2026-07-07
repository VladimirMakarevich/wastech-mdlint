import type { ContextGraph } from "../graph/context-graph-types.js";
import { getComponents, topologicalSort } from "../graph/graph-algorithms.js";

export const DEFAULT_HUB_MIN_IN_DEGREE = 3;

export type NodeRole = "isolated" | "hub" | "entry" | "leaf" | "bridge";

export type NodeClassification = {
  path: string;
  role: NodeRole;
};

export type GraphAnalysisOptions = {
  // P5.05 validates `config.compile.hubMinInDegree`; this surface only threads the resolved
  // threshold into the degree-only classifier so later compile work does not need to reopen the API.
  hubMinInDegree?: number;
};

export type GraphAnalysis = {
  readingOrder: string[];
  excludedFromReadingOrder: string[];
  components: string[][];
  classification: NodeClassification[];
  cycles: string[][];
};

function classifyNode(inDegree: number, outDegree: number, hubMinInDegree: number): NodeRole {
  if (inDegree === 0 && outDegree === 0) {
    return "isolated";
  }
  // Order is load-bearing: a heavily referenced terminal document must stay a `hub`, not fall
  // through to `leaf`, because P5 defines roles from first-match degree thresholds.
  if (inDegree >= hubMinInDegree) {
    return "hub";
  }
  if (inDegree === 0) {
    return "entry";
  }
  if (outDegree === 0) {
    return "leaf";
  }
  return "bridge";
}

export function classifyNodes(
  graph: ContextGraph,
  options: GraphAnalysisOptions = {}
): NodeClassification[] {
  const hubMinInDegree = options.hubMinInDegree ?? DEFAULT_HUB_MIN_IN_DEGREE;

  // Classification follows the graph's existing node order so callers can line it up with the
  // deterministic node list they already have, instead of this compile layer inventing a new one.
  return graph.nodes.map((node) => ({
    path: node.path,
    role: classifyNode(node.inDegree, node.outDegree, hubMinInDegree)
  }));
}

export function analyzeGraph(graph: ContextGraph, options: GraphAnalysisOptions = {}): GraphAnalysis {
  const { order, excluded } = topologicalSort(graph);

  return {
    readingOrder: order,
    excludedFromReadingOrder: excluded,
    components: getComponents(graph),
    classification: classifyNodes(graph, options),
    // The illustrative task shape omits `cycles`, but the same task explicitly requires threading
    // `graph.cycles` through so P5.04 can report truncated reading order honestly.
    cycles: graph.cycles.map((cycle) => [...cycle])
  };
}
