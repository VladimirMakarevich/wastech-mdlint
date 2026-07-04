// Minimal `ContextGraph` contract (P2.01 / audit 2.2).
//
// The rule engine references this type so `RuleContext.graph` compiles, but P2 has no graph rules
// yet: the orchestrator starts *injecting* a graph in P3 (built from the relocated legacy builder),
// and P4 swaps in the semantic `buildContextGraph` without changing this read shape. GRP-001/002
// depend only on the fields declared here — the explicit cycle list (G6) and per-node in/out degree
// — so the builder can be replaced under them.

export type ContextGraphEdgeType = "link" | "anchor" | "image" | "import" | "id-ref";

export type ContextGraphNode = {
  // Repo-relative POSIX path — the stable node identity used everywhere.
  path: string;
  inDegree: number;
  outDegree: number;
};

export type ContextGraphEdge = {
  from: string;
  to: string;
  type: ContextGraphEdgeType;
  line?: number;
  // G3 explainability metadata; optional so the legacy-derived P3 graph can omit it.
  text?: string;
  rawTarget?: string;
};

export type ContextGraph = {
  nodes: ContextGraphNode[];
  edges: ContextGraphEdge[];
  // Explicit cycle list (G6): each entry is a node path sequence forming a cycle. GRP-001 reads
  // this directly instead of re-running traversal.
  cycles: string[][];
};
