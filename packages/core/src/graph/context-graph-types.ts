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

// `exclude`/`entryPoints` are accepted for forward compatibility with the P4.06 coverage/orphan
// wiring; `buildContextGraph` does not yet consume them (task constraint — deferred, not dropped).
export type BuildContextGraphOptions = {
  exclude?: string[];
  entryPoints?: string[];
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
