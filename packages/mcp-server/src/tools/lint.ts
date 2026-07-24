import {
  createSuppressionChecker,
  formatLintResultText,
  parseDocument,
  ruleEntrySchema,
  ruleRegistry,
  runRules,
  RuleResolutionError,
  type LintMessage,
  type ParsedDocument,
  type ResolvedRule,
  type Rule,
  type RuleConfigEntry,
  type ToolErrorCode
} from "@wastech-mdlint/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { lintMessageSchema } from "../shared/lint-message-schema.js";
import {
  errorResult,
  READ_ONLY_ANNOTATIONS,
  successResult,
  withErrorOutput
} from "../shared/tool-response.js";

// `lint` — lint ad-hoc Markdown text against an explicit set of rules. This tool never loads a
// project config (that is `lint-files`' job): the whole contract is "content + rules in, findings
// out", so the input carries the rules to run rather than resolving them from a config. Core still
// owns rule semantics, so file-resolving rules may inspect paths under the server cwd.

// A synthetic in-memory path for the single document. Ends in `.md` because some built-in rules
// accept `files`/`exclude` glob options (fileScopeShape) and match them against the document path;
// a `.md` suffix behaves least-surprisingly against a caller-supplied glob like `**/*.md`.
const AD_HOC_DOCUMENT_PATH = "content.md";

// Reuse core's already-validated rule entry schema for each requested rule rather than a hand-rolled
// `{ rule, options }` pair. This is a deliberate small superset of the task's literal wording: it
// also carries `severity` (including `"off"`), and honoring the field the schema exposes is safer
// than silently ignoring it.
const lintInputShape = {
  content: z.string(),
  rules: z.array(ruleEntrySchema)
} as const;

const lintOutputShape = {
  messages: z.array(lintMessageSchema),
  errorCount: z.number().int(),
  warningCount: z.number().int()
} as const;

// Wire clients validate `structuredContent` against `outputSchema` even on errors, so the error
// path needs schema-compatible zero values for lint's required success fields.
const EMPTY_LINT_OUTPUT = {
  messages: [],
  errorCount: 0,
  warningCount: 0
} as const;

type LintToolInput = { content: string; rules: RuleConfigEntry[] };

// Error wrapping lives on the MCP boundary (architecture split: "error wrapping" is a host concern),
// and this is the only call site that needs it so far — so the wrapper is local, not promoted to
// core. `ruleRegistry.resolveRule` throws `RuleResolutionError`, whose `UNKNOWN_RULE`/`INVALID_OPTIONS`
// codes are a *different* enum than `ToolErrorCode`; without this translation an unwrapped
// `RuleResolutionError` fails `isStructuredError`'s allowlist and degrades to a sanitized
// `INTERNAL_ERROR`, losing the "did you mean" / bad-options message M6 exists to preserve.
class ToolInputError extends Error {
  readonly code: ToolErrorCode = "INVALID_INPUT";
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "ToolInputError";
    this.hint = hint;
  }
}

function toToolInputError(error: RuleResolutionError): ToolInputError {
  if (error.code === "UNKNOWN_RULE") {
    const hint =
      error.suggestion === undefined ? undefined : `Did you mean "${error.suggestion}"?`;
    return new ToolInputError(error.message, hint);
  }

  // INVALID_OPTIONS: surface the failing option paths so the caller can fix the request.
  const hint = error.issues
    ?.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  return new ToolInputError(error.message, hint === "" ? undefined : hint);
}

// Resolve requested entries to runnable rules, mirroring lintFiles' resolve-then-filter of `"off"`
// (that helper isn't exported and is only ~6 lines — not worth a core export for one caller).
function resolveRequestedRules(entries: readonly RuleConfigEntry[]): ResolvedRule[] {
  const resolved: ResolvedRule[] = [];
  for (const entry of entries) {
    let rule: Rule;
    try {
      rule = ruleRegistry.resolveRule(entry.rule, entry.options);
    } catch (error) {
      if (error instanceof RuleResolutionError) {
        throw toToolInputError(error);
      }
      throw error;
    }
    if (entry.severity === "off") {
      continue;
    }
    resolved.push({ rule, severityOverride: entry.severity });
  }
  return resolved;
}

export function handleLint(input: LintToolInput): CallToolResult {
  try {
    const resolved = resolveRequestedRules(input.rules);
    const document = parseDocument({ path: AD_HOC_DOCUMENT_PATH, content: input.content });

    // Build a "corpus of one" so R4's project-scope fail-fast is satisfied uniformly for any rule
    // scope without special-casing: `documents` and `projectFiles` are non-empty.
    //
    // `rootDir` is the server cwd (mirroring the `cwd ?? process.cwd()` default tool-context.ts uses
    // elsewhere in this package). Reusing core's standard behavior — rather than a bespoke
    // corpus-only mode — is deliberate: REF-001/003 non-null-assert `rootDir` into `existsSync` for
    // targets outside the corpus, so a real value both avoids a `path.resolve(undefined, …)` crash
    // and lets on-disk targets resolve exactly as they do under `lint-files` (core stays the single
    // owner of REF/SEC resolution semantics; this host does not fork them).
    //
    // `graph` is left undefined deliberately: GRP-001/002 no-op gracefully without one, and building
    // a real ContextGraph for a one-document corpus needs siteRouter/idRef wiring this tool's
    // `{ content, rules }` input has no slot for — and would only ever flag the lone doc as an
    // orphan. Intentional scope boundary, not a gap.
    const documents = new Map<string, ParsedDocument>([[document.path, document]]);
    const rawMessages: LintMessage[] = runRules(resolved, {
      document,
      filePath: document.path,
      documents,
      projectFiles: [document.path],
      rootDir: process.cwd(),
      settings: {}
    });

    // Apply inline-disable suppression (R8), matching `lintFiles`: drop each message whose
    // (ruleId, line) is disabled by a `<!-- wastech-mdlint-disable... -->` directive in the content.
    // Without this the `lint` tool would disagree with `lint-files` on the same directive-bearing
    // text. The runner already sorted `rawMessages`, so filtering preserves that order.
    const isSuppressed = createSuppressionChecker(document.directives);
    const messages = rawMessages.filter((message) => !isSuppressed(message.ruleId, message.line));

    const errorCount = messages.filter((message) => message.severity === "error").length;
    const warningCount = messages.filter((message) => message.severity === "warning").length;

    // Reuse core's text formatter so `lint` and `lint-files` render byte-for-byte consistently.
    // `formatLintResultText` never reads `.files`, so the one-entry placeholder only satisfies the
    // `LintResult` type.
    const summary = formatLintResultText({
      messages,
      files: [AD_HOC_DOCUMENT_PATH],
      errorCount,
      warningCount
    });

    return successResult({ summary, structured: { messages, errorCount, warningCount } });
  } catch (error) {
    return errorResult(error, EMPTY_LINT_OUTPUT);
  }
}

export function registerLintTool(server: McpServer): void {
  server.registerTool(
    "lint",
    {
      title: "Lint Markdown content",
      description:
        "Lint ad-hoc Markdown content against an explicit set of rules. Does not load project config; " +
        "file-resolving rules such as REF-001/REF-003 and SEC-003 may probe or read paths relative " +
        "to the server's working directory.",
      inputSchema: lintInputShape,
      outputSchema: withErrorOutput(lintOutputShape),
      annotations: READ_ONLY_ANNOTATIONS
    },
    (input) => handleLint(input)
  );
}
