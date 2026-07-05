import path from "node:path";

import type { LintConfig } from "../config/config-schema.js";
import type { ResolvedSettings } from "../engine/types.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import { loadDocuments } from "../markdown/load-documents.js";
import { buildContextGraph } from "./build-context-graph.js";
import type { ContextGraph } from "./context-graph-types.js";

// Shared doc-load + graph-build sequence for graph-consuming hosts (P4.07 CLI, P7 MCP). Mirrors the
// same steps `lint-files.ts` runs internally, but is exposed standalone here so a host can build one
// `ContextGraph` up front, hand it to `lintFiles({ graph })` to avoid rebuilding it, and reuse it for
// query/slice/impact — without `lint-files.ts` importing from a CLI/MCP-facing module.

export type GraphContext = {
  documents: Map<string, ParsedDocument>;
  graph: ContextGraph;
};

export async function loadContext(params: {
  cwd: string;
  config: LintConfig;
  settings: ResolvedSettings;
}): Promise<GraphContext> {
  const rootDir = path.resolve(params.cwd);
  const loaded = await loadDocuments(params.config.include ?? ["**/*.md"], {
    cwd: rootDir,
    exclude: params.config.exclude,
    respectGitignore: params.config.respectGitignore
  });

  // Re-key the loader's absolute-path map to repo-relative POSIX paths — the identity rules and the
  // graph builder resolve link/ID targets against `document.path`, not the loader's map key.
  const documents = new Map<string, ParsedDocument>();
  for (const document of loaded.values()) {
    documents.set(document.path, document);
  }

  const graph = buildContextGraph(documents, {
    siteRouter: params.settings.siteRouter,
    idRef: params.settings.idRef
  });

  return { documents, graph };
}
