import path from "node:path";

import { resolveCorpusScope } from "../config/corpus-scope.js";
import type { ConfiguredRule } from "../config/load-config.js";
import { compareStrings } from "../deterministic-sort.js";
import { buildContextGraph } from "../graph/build-context-graph.js";
import type { ContextGraph } from "../graph/context-graph-types.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import { loadDocuments } from "../markdown/load-documents.js";
import { runRules } from "./run-rules.js";
import { createSuppressionChecker } from "./suppression.js";
import type { LintConfig } from "../config/config-schema.js";
import type {
  LintMessage,
  ResolvedRule,
  ResolvedSettings,
  RuleContext,
} from "./types.js";

export type LintResult = {
  messages: LintMessage[];
  files: string[];
  errorCount: number;
  warningCount: number;
};

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

function compareMessages(left: LintMessage, right: LintMessage): number {
  return (
    compareStrings(left.filePath, right.filePath) ||
    left.line - right.line ||
    (left.column ?? 0) - (right.column ?? 0) ||
    compareStrings(left.ruleId, right.ruleId) ||
    compareStrings(left.message, right.message)
  );
}

/**
 * Run the full lint pipeline (P2.05): load documents from config, split rules by scope, run them,
 * resolve severity, apply inline-disable, and return deterministic, file-attributed results.
 *
 * Document rules run once per file; project rules run once over the whole corpus (self-attributing
 * messages). Missing `documents` for a project rule throws (R4) — but the orchestrator always
 * supplies the corpus, so that only fires on misuse.
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
  const projectFiles = [...documents.keys()].sort(compareStrings);

  const resolved = activeRules(input.rules);
  const documentRules = resolved.filter(
    (entry) => entry.rule.scope === "document",
  );
  const projectRules = resolved.filter(
    (entry) => entry.rule.scope === "project",
  );

  // Build + inject one shared ContextGraph (R5 / audit 2.2). P4.01 wires siteRouter so graph edges
  // resolve root-relative links identically to the REF rules; P4.06 adds idRef so id-ref edges
  // materialize whenever the shared setting is configured. Those two settings are the builder's
  // whole input: R5's proposed `exclude`/`entryPoints` were dropped from its options at P4.06
  // because the graph is corpus-wide, so every rule reasons over the same relationships — GRP-001
  // accordingly takes no options at all, and GRP-002's `files`/`exclude`/`entryPoints` filter its
  // *reporting* rather than the graph ([P11.13]). Callers may pass a graph to override (e.g. tests).
  const graph =
    input.graph ??
    buildContextGraph(documents, {
      siteRouter: input.settings.siteRouter,
      idRef: input.settings.idRef,
    });

  const sharedContext: Omit<RuleContext, "report" | "document" | "filePath"> = {
    documents,
    projectFiles,
    rootDir,
    settings: input.settings,
    graph,
  };

  const rawMessages: LintMessage[] = [];

  // Document rules: once per file, in deterministic path order.
  for (const filePath of projectFiles) {
    const document = documents.get(filePath)!;
    rawMessages.push(
      ...runRules(documentRules, { ...sharedContext, document, filePath }),
    );
  }

  // Project rules: once over the corpus (they self-attribute each finding to a file).
  if (projectRules.length > 0) {
    rawMessages.push(...runRules(projectRules, sharedContext));
  }

  // Inline-disable suppression: drop each message whose (ruleId, line) is disabled in its file.
  const suppressionByFile = new Map<
    string,
    ReturnType<typeof createSuppressionChecker>
  >();
  const messages = rawMessages.filter((message) => {
    const document = documents.get(message.filePath);
    if (document === undefined) {
      return true;
    }
    let checker = suppressionByFile.get(message.filePath);
    if (checker === undefined) {
      checker = createSuppressionChecker(document.directives);
      suppressionByFile.set(message.filePath, checker);
    }
    return !checker(message.ruleId, message.line);
  });

  messages.sort(compareMessages);

  return {
    messages,
    files: projectFiles,
    errorCount: messages.filter((message) => message.severity === "error")
      .length,
    warningCount: messages.filter((message) => message.severity === "warning")
      .length,
  };
}
