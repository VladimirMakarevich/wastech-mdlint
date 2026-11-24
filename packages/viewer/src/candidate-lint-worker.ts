import { parentPort } from "node:worker_threads";

import {
  buildContextGraph,
  lintContext,
  loadContext,
  parseConfiguration,
  type ContextGraph,
  type GraphContext,
  type ParsedDocument,
} from "@wastech-mdlint/core";

import type {
  CandidateLintAnswer,
  CandidateLintJob,
} from "./candidate-lint.js";

// The thread a config preview's lint runs on. A candidate config can carry custom-rule patterns the
// reader is still typing, and one that backtracks catastrophically (`(a+)+$` against a long run of
// `a`) holds whatever thread runs it for as long as it likes. On the server's own thread that froze
// every page, the live-reload stream and Ctrl+C with it; here the server can stop it by terminating
// the thread.

// The corpus's parsed documents as last sent. The server sends them again only when its corpus has
// replaced its document map, so a burst of previews pays for one copy, not one per keystroke.
let documents = new Map<string, ParsedDocument>();
// The graph over `documents` for the link settings it was built with: a preview that changes only
// rules lints against the same graph every time.
let graph: { key: string; graph: ContextGraph } | undefined;

parentPort?.on("message", (job: CandidateLintJob) => {
  void answer(job).then(
    (reply) => parentPort?.postMessage(reply),
    (error: unknown) =>
      parentPort?.postMessage({
        ok: false,
        reason: "failed",
        message: (error as Error).message,
      } satisfies CandidateLintAnswer),
  );
});

async function answer(job: CandidateLintJob): Promise<CandidateLintAnswer> {
  if (job.documents !== undefined) {
    // Read-only on the server's side; what arrives here is the thread's own structured copy, a
    // plain `Map` nothing else holds.
    documents = job.documents as Map<string, ParsedDocument>;
    graph = undefined;
  }
  // Validated by the server before the job was sent; parsed again here because a loaded config
  // carries compiled rules, which do not cross a thread boundary.
  const candidate = parseConfiguration({
    text: job.text,
    cwd: job.rootDir,
    configPath: job.configPath,
  });
  let context: GraphContext;
  if (job.sameScope) {
    const { siteRouter, idRef } = candidate.settings;
    const key = JSON.stringify([siteRouter, idRef]);
    if (graph?.key !== key) {
      graph = {
        key,
        graph: buildContextGraph(documents, { siteRouter, idRef }),
      };
    }
    context = { documents, graph: graph.graph };
  } else {
    // A new `include`, `exclude` or `respectGitignore` decides which files are documents, so only
    // core's own discovery and parse of that scope can answer it.
    context = await loadContext({
      cwd: job.rootDir,
      config: candidate.config,
      settings: candidate.settings,
    });
  }
  const result = lintContext({
    cwd: job.rootDir,
    context,
    rules: candidate.rules,
    settings: candidate.settings,
  });
  return {
    ok: true,
    messages: result.messages,
    documentCount: context.documents.size,
  };
}
