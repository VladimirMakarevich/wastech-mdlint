import path from "node:path";

import { resolveCorpusScope } from "../config/corpus-scope.js";
import type { ConfiguredRule } from "../config/load-config.js";
import { buildContextGraph } from "../graph/build-context-graph.js";
import type { ContextGraph } from "../graph/context-graph-types.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import { loadDocuments } from "../markdown/load-documents.js";
import { lintCorpus, type LintResult } from "./lint-corpus.js";
import type { LintConfig } from "../config/config-schema.js";
import type { ResolvedRule, ResolvedSettings } from "./types.js";

// Re-exported from its new home so every existing importer — `format-lint-result.ts`, `src/index.ts`,
// and both hosts through the barrel — keeps resolving `LintResult` from here. It moved to
// `lint-corpus.ts` at P16.01 because that is the layer that now produces it.
export type { LintResult } from "./lint-corpus.js";

export type LintFilesInput = {
  cwd: string;
  config: LintConfig;
  rules: readonly ConfiguredRule[];
  settings: ResolvedSettings;
  // Injected shared ContextGraph (R5). Undefined in P2 (no graph rules yet); the orchestrator
  // builds and injects it starting P3.06, so GRP rules read one graph instead of building adjacency.
  graph?: ContextGraph;
};

// Resolve config severity overrides and drop `"off"` rules (R1/C2) before running anything. Written
// as a loop so TypeScript narrows `"off"` out of the override union after the guard.
function activeRules(rules: readonly ConfiguredRule[]): ResolvedRule[] {
  const active: ResolvedRule[] = [];

  for (const configured of rules) {
    if (configured.severity === "off") {
      continue;
    }
    active.push({
      rule: configured.rule,
      severityOverride: configured.severity,
    });
  }

  return active;
}

/**
 * Run the full lint pipeline (P2.05) for a project: resolve the corpus scope from config, load and
 * parse it, resolve rule severities, build the shared graph, then hand all of that to
 * {@link lintCorpus}, which owns the step order from there.
 *
 * This function is the *discovery* half — everything that needs config and the filesystem. The split
 * exists so the ad-hoc text path (`lintContent`) reaches the same steps in the same order instead of
 * re-assembling them in a host (W-58).
 */
export async function lintFiles(input: LintFilesInput): Promise<LintResult> {
  const rootDir = path.resolve(input.cwd);

  // Corpus scope comes from the config layer (P13.02), so a zero-config run prunes `node_modules`
  // and friends without any host or caller having to remember to pass an `exclude`.
  const scope = resolveCorpusScope(input.config);
  const loaded = await loadDocuments(scope.include, {
    cwd: rootDir,
    exclude: scope.exclude,
    respectGitignore: scope.respectGitignore,
  });

  // Re-key the loader's absolute-path map to repo-relative POSIX paths — the identity rules resolve
  // link/ID targets against.
  const documents = new Map<string, ParsedDocument>();
  for (const document of loaded.values()) {
    documents.set(document.path, document);
  }

  // Build + inject one shared ContextGraph (R5 / audit 2.2). P4.01 wires siteRouter so graph edges
  // resolve root-relative links identically to the REF rules; P4.06 adds idRef so id-ref edges
  // materialize whenever the shared setting is configured. Those two settings are the builder's
  // whole input: R5's proposed `exclude`/`entryPoints` were dropped from its options at P4.06
  // because the graph is corpus-wide, so every rule reasons over the same relationships — which is why
  // every option the GRP rules do keep filters their *reporting* rather than the graph: GRP-002's
  // `files`/`exclude`/`entryPoints` ([P11.13]) and GRP-001's `minCycleLength` ([P13.04]) all act on
  // findings already produced. Callers may pass a graph to override (e.g. tests).
  const graph =
    input.graph ??
    buildContextGraph(documents, {
      siteRouter: input.settings.siteRouter,
      idRef: input.settings.idRef,
    });

  return lintCorpus({
    documents,
    rules: activeRules(input.rules),
    rootDir,
    settings: input.settings,
    graph,
  });
}
