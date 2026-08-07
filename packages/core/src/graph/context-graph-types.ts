// The `ContextGraph` contract.
//
// The rule engine references this type so `RuleContext.graph` compiles. `buildContextGraph`
// materializes the full semantic taxonomy (anchor/image/import/id-ref) with retained multiplicity,
// but this read shape stayed unchanged when it replaced an earlier link-only builder — which is why
// GRP-001/002, the CLI, and MCP all read `path`/`from`/`to` and kept working across that swap.

import type { IdRef } from "../engine/defined-ids.js";
import type { SiteRouterSettings } from "../engine/types.js";

export type ContextGraphEdgeType =
  | "link"
  | "anchor"
  | "image"
  | "import"
  | "id-ref";

// The only inputs the builder consumes: `siteRouter` mirrors REF-001/002 root-relative resolution
// so graph edges never disagree with the REF rules; `idRef` turns on id-ref edges. Earlier
// `exclude`/`entryPoints` fields were removed rather than wired — nothing ever read them, and node
// exclusion belongs to whichever change concretely needs it, not to a speculative extension point.
export type BuildContextGraphOptions = {
  siteRouter?: SiteRouterSettings;
  idRef?: IdRef;
};

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
  // Explainability metadata — what an edge can say about itself. Optional because image edges
  // deliberately carry no label.
  text?: string;
  rawTarget?: string;
};

export type ContextGraph = {
  nodes: ContextGraphNode[];
  edges: ContextGraphEdge[];
  // Explicit cycle list: each entry is a node path sequence forming a cycle. GRP-001 reads
  // this directly instead of re-running traversal.
  cycles: string[][];
};
