import type { ContextGraph } from "../graph/context-graph-types.js";
import {
  DEFAULT_HUB_MIN_IN_DEGREE,
  getComponents,
  topologicalSort,
} from "../graph/graph-algorithms.js";

// The threshold is defined with the graph summary rather than here, and imported, because the graph
// report's `top hubs` list and this classifier's `hub` role must never disagree about one document.
// Re-exported so callers that reason about node roles keep reaching it through this module.
export { DEFAULT_HUB_MIN_IN_DEGREE };

export type NodeRole = "isolated" | "hub" | "entry" | "leaf" | "bridge";

export type NodeClassification = {
  path: string;
  role: NodeRole;
};

export type GraphAnalysisOptions = {
  // Config validation of `compile.hubMinInDegree` happens in the config schema; this surface only
  // threads the resolved threshold into the degree-only classifier, so compile work that needs a
  // different threshold does not have to reopen this API.
  hubMinInDegree?: number;
};

export type GraphAnalysis = {
  readingOrder: string[];
  excludedFromReadingOrder: string[];
  components: string[][];
  classification: NodeClassification[];
  cycles: string[][];
};

function classifyNode(
  inDegree: number,
  outDegree: number,
  hubMinInDegree: number,
): NodeRole {
  if (inDegree === 0 && outDegree === 0) {
    return "isolated";
  }
  // Order is load-bearing: a heavily referenced terminal document must stay a `hub`, not fall
  // through to `leaf`, because roles are assigned by first-match degree thresholds, in order.
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
  options: GraphAnalysisOptions = {},
): NodeClassification[] {
  const hubMinInDegree = options.hubMinInDegree ?? DEFAULT_HUB_MIN_IN_DEGREE;

  // Classification follows the graph's existing node order so callers can line it up with the
  // deterministic node list they already have, instead of this compile layer inventing a new one.
  return graph.nodes.map((node) => ({
    path: node.path,
    role: classifyNode(node.inDegree, node.outDegree, hubMinInDegree),
  }));
}

export function analyzeGraph(
  graph: ContextGraph,
  options: GraphAnalysisOptions = {},
): GraphAnalysis {
  const { order, excluded } = topologicalSort(graph);

  return {
    readingOrder: order,
    excludedFromReadingOrder: excluded,
    components: getComponents(graph),
    classification: classifyNodes(graph, options),
    // Threaded through even though nothing in this module reads it: `synthesize` needs the cycles
    // to say *why* a reading order is truncated, and recomputing them there would duplicate the
    // Tarjan pass the graph builder already ran.
    cycles: graph.cycles.map((cycle) => [...cycle]),
  };
}
