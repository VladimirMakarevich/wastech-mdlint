import path from "node:path";

import type { ParsedDocument } from "../markdown/document-types.js";
import { parseDocument } from "../markdown/parse-document.js";
import { lintCorpus, type LintResult } from "./lint-corpus.js";
import type { ResolvedRule, ResolvedSettings } from "./types.js";

// The ad-hoc lint entry point (P16.01 / W-58): lint one in-memory document against an explicit set of
// rules, with no config and no filesystem discovery. The MCP `lint` tool is its caller; before this
// existed that host hand-assembled parse → corpus-of-one → `runRules` → suppression → counts →
// formatter itself, which is the one place the pipeline's step order lived twice.
//
// Synchronous, like `lintCorpus` and like `parseDocument`: the host handler this serves is sync.

export type LintContentInput = {
  // The synthetic path the single document is linted *as*. Chosen by the caller because it is part of
  // that caller's own contract: rules with a `files`/`exclude` glob scope match against it, and the
  // REF/SEC/STR rules resolve relative targets from its directory. A `.md` suffix behaves least
  // surprisingly against a caller-supplied `**/*.md`.
  path: string;
  content: string;
  // Already severity-resolved and filtered of `"off"`. Resolving a rule *request* is the caller's
  // job: a host that accepts rules over a wire also owns turning a resolution failure into its own
  // error contract, which core cannot do for it.
  rules: readonly ResolvedRule[];
  // Absolute, and a real directory. Not optional and not defaulted to `process.cwd()` here: the
  // file-resolving rules (REF-001/REF-003 for a link target that exists on disk but outside the
  // corpus, SEC-003's `template`, STR-001's required files) probe under it, so which directory an
  // ad-hoc lint may read is a decision its caller must make deliberately rather than inherit.
  rootDir: string;
  settings?: ResolvedSettings;
};

/**
 * Lint a single document's text as a corpus of one.
 *
 * The corpus-of-one is what satisfies R4's project-scope fail-fast uniformly for any rule scope
 * without special-casing: `documents` and `projectFiles` are non-empty, so a project rule runs
 * instead of throwing.
 *
 * No `ContextGraph` is built. Graph-aware rules (GRP-001/002) no-op gracefully without one, and a
 * graph over a single document could only ever report that document as an orphan — while building it
 * needs the `siteRouter`/`idRef` wiring an ad-hoc `{ path, content }` call has no corpus to make
 * meaningful. An intentional boundary, not a gap.
 */
export function lintContent(input: LintContentInput): LintResult {
  const document = parseDocument({ path: input.path, content: input.content });

  const documents = new Map<string, ParsedDocument>([
    [document.path, document],
  ]);

  return lintCorpus({
    documents,
    rules: input.rules,
    // Resolved for the same reason `lintFiles` resolves its `cwd`: the rules that probe disk join
    // against it, and a relative value would silently mean "wherever this process happens to run".
    rootDir: path.resolve(input.rootDir),
    settings: input.settings ?? {},
  });
}
