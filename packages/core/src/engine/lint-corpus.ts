import { compareStrings } from "../deterministic-sort.js";
import type { ContextGraph } from "../graph/context-graph-types.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import { runRules } from "./run-rules.js";
import { createSuppressionChecker } from "./suppression.js";
import type {
  LintMessage,
  ResolvedRule,
  ResolvedSettings,
  RuleContext,
} from "./types.js";

// The lint pipeline's **step order**, over a corpus that is already in memory: split rules by scope,
// run document rules per file and project rules once, apply inline-disable, sort, count.
//
// Split out of `lint-files.ts`. The order used to exist twice — once here (as part
// of `lintFiles`) and once hand-assembled inside the MCP `lint` tool's handler, which lints ad-hoc
// text rather than a discovered corpus. Every step there composed a core export, so it was never a
// fork of the pipeline; the problem was that **a step added to `lintFiles` would silently not reach
// that tool**, and nothing failed when the two disagreed. One entry point both callers go through is
// the seam that closes it, and it is preferred over a differential test because
// a differential test over a hand-assembled sequence rots as the sequence grows.
//
// Deliberately **synchronous**: everything asynchronous about linting (discovery, reads) happens
// before a corpus exists, and the ad-hoc host path is sync and must stay so.
//
// This layer takes the corpus, the resolved rules, and an optional graph as *given*. Deciding what
// the corpus is (`resolveCorpusScope` + `loadDocuments`), which rules are active, and whether to
// build a `ContextGraph` stays in `lintFiles`, because those answers differ per caller — an ad-hoc
// one-document corpus has no config to scope and no meaningful graph.

export type LintResult = {
  messages: LintMessage[];
  files: string[];
  errorCount: number;
  warningCount: number;
};

export type LintCorpusInput = {
  // Keyed by **repo-relative POSIX path** (each document's own `.path`) — the identity rules resolve
  // link and ID targets against, and the keys that become `files`. Note this is *not*
  // `loadDocuments`' absolute-keyed map; `lintFiles` re-keys before calling here.
  documents: Map<string, ParsedDocument>;
  // Severity-resolved and already filtered of `"off"`. Resolution belongs to the caller:
  // `lintFiles` reads it from config, while a host that takes rules from a request also owns
  // translating a resolution failure into its own error contract.
  rules: readonly ResolvedRule[];
  // Absolute. REF-001/REF-003 and SEC-003/STR-001 resolve on-disk targets against it, so it must be
  // a real directory even when the corpus is synthetic.
  rootDir: string;
  settings: ResolvedSettings;
  // The shared `ContextGraph`, when the caller has one. Graph-aware rules (GRP-001/002) no-op
  // gracefully without it.
  graph?: ContextGraph;
};

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
 * Run the rule pipeline over an in-memory corpus and return deterministic, file-attributed results.
 *
 * Document rules run once per file in sorted path order; project rules run once over the whole
 * corpus and self-attribute each finding to a file. Missing `documents` for a project rule throws
 * — unreachable from here, since the corpus is always passed.
 */
export function lintCorpus(input: LintCorpusInput): LintResult {
  const projectFiles = [...input.documents.keys()].sort(compareStrings);

  const documentRules = input.rules.filter(
    (entry) => entry.rule.scope === "document",
  );
  const projectRules = input.rules.filter(
    (entry) => entry.rule.scope === "project",
  );

  const sharedContext: Omit<RuleContext, "report" | "document" | "filePath"> = {
    documents: input.documents,
    projectFiles,
    rootDir: input.rootDir,
    settings: input.settings,
    graph: input.graph,
  };

  const rawMessages: LintMessage[] = [];

  // Document rules: once per file, in deterministic path order.
  for (const filePath of projectFiles) {
    const document = input.documents.get(filePath)!;
    rawMessages.push(
      ...runRules(documentRules, { ...sharedContext, document, filePath }),
    );
  }

  // Project rules: once over the corpus. They get no `document`/`filePath`, which is what forces
  // them to attribute every finding explicitly — the property that makes running them once correct.
  if (projectRules.length > 0) {
    rawMessages.push(...runRules(projectRules, sharedContext));
  }

  // Inline-disable suppression: drop each message whose (ruleId, line) is disabled in its file. A
  // message attributed to a path outside the corpus (SEC-003 naming its own `template`, STR-001
  // naming a required file) has no document to read directives from and is never suppressed.
  const suppressionByFile = new Map<
    string,
    ReturnType<typeof createSuppressionChecker>
  >();
  const messages = rawMessages.filter((message) => {
    const document = input.documents.get(message.filePath);
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
