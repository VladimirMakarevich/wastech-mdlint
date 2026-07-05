// `ContextGraph` contract (P2.01 / audit 2.2, extended P4.01).
//
// The rule engine references this type so `RuleContext.graph` compiles. P3 injected a graph built
// from the relocated legacy (link-only) builder; P4.01's `buildContextGraph` now materializes the
// full semantic taxonomy (anchor/image/import/id-ref) with retained multiplicity, but the read
// shape below is unchanged — GRP-001/002, the CLI, and MCP all read `path`/`from`/`to` and keep
// working across the swap.

import type { IdRef } from "../engine/defined-ids.js";
import type { SiteRouterSettings } from "../engine/types.js";

export type ContextGraphEdgeType = "link" | "anchor" | "image" | "import" | "id-ref";

// The only inputs the builder consumes: `siteRouter` mirrors REF-001/002 root-relative resolution
// so graph edges never disagree with the REF rules; `idRef` turns on id-ref edges. Earlier
// `exclude`/`entryPoints` fields were removed after P4.06 declined to wire them — they were dead API
// for the whole phase, and node exclusion belongs to a future task that concretely needs it (per the
// coding-style rule against extension points for hypothetical needs).
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
