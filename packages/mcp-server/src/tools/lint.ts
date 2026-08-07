import {
  customRuleEntrySchema,
  formatLintResultText,
  lintContent,
  resolveCustomRule,
  ruleEntrySchema,
  ruleRegistry,
  RuleResolutionError,
  type CustomRuleConfigEntry,
  type ResolvedRule,
  type Rule,
  type RuleConfigEntry,
} from "@wastech-mdlint/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { lintMessageSchema } from "../shared/lint-message-schema.js";
import { ToolInputError } from "../shared/tool-input-error.js";
import {
  errorResult,
  READ_ONLY_ANNOTATIONS,
  successResult,
  withErrorOutput,
} from "../shared/tool-response.js";

// `lint` — lint ad-hoc Markdown text against an explicit set of rules. This tool never loads a
// project config (that is `lint-files`' job): the whole contract is "content + rules in, findings
// out", so the input carries the rules to run rather than resolving them from a config. Core still
// owns rule semantics, so file-resolving rules may inspect paths under the server cwd.

// A synthetic in-memory path for the single document. Ends in `.md` because some built-in rules
// accept `files`/`exclude` glob options (fileScopeShape) and match them against the document path;
// a `.md` suffix behaves least-surprisingly against a caller-supplied glob like `**/*.md`.
const AD_HOC_DOCUMENT_PATH = "content.md";

// Reuse core's already-validated rule entry schemas for each requested rule rather than a hand-rolled
// `{ rule, options }` pair. This is a deliberate small superset of the task's literal wording: it
// also carries `severity` (including `"off"`), and honoring the field the schema exposes is safer
// than silently ignoring it.
//
// Widened to a union so "executes declarative custom rules" holds for ad-hoc `lint`
// too. Custom-first, because the strict built-in branch would reject a custom entry's `id`/`target`
// keys. The second branch is `ruleEntrySchema` — the permissive one — deliberately NOT the config-only
// `ruleEntryUnionSchema`, whose standard branch refine-rejects the literal `"custom"`: the SDK
// `safeParseAsync`s this schema *before* the handler runs and turns a failure into an
// `InvalidParams` result carrying raw validation text and no `structuredContent`, so any shape
// rejected here can never carry the `{code,message,hint}` payload. A malformed
// `{ "rule": "custom" }` must therefore reach `handleLint`
// and be re-validated there (see `resolveCustomRequest`). Config load stays fail-closed on the same
// shape; only this wire schema is permissive.
const ruleRequestSchema = z.union([customRuleEntrySchema, ruleEntrySchema]);

const lintInputShape = {
  content: z.string(),
  rules: z.array(ruleRequestSchema),
} as const;

const lintOutputShape = {
  messages: z.array(lintMessageSchema),
  errorCount: z.number().int(),
  warningCount: z.number().int(),
} as const;

// Wire clients validate `structuredContent` against `outputSchema` even on errors, so the error
// path needs schema-compatible zero values for lint's required success fields.
const EMPTY_LINT_OUTPUT = {
  messages: [],
  errorCount: 0,
  warningCount: 0,
} as const;

type LintRuleRequest = RuleConfigEntry | CustomRuleConfigEntry;

type LintToolInput = { content: string; rules: LintRuleRequest[] };

// `ruleRegistry.resolveRule` throws `RuleResolutionError`, whose `UNKNOWN_RULE`/`INVALID_OPTIONS`
// codes are a *different* enum than `ToolErrorCode`, so it needs the shared `ToolInputError`
// translation to keep its "did you mean" / bad-options text instead of degrading to a sanitized
// `INTERNAL_ERROR`.
function toToolInputError(error: RuleResolutionError): ToolInputError {
  if (error.code === "UNKNOWN_RULE") {
    const hint =
      error.suggestion === undefined
        ? undefined
        : `Did you mean "${error.suggestion}"?`;
    return new ToolInputError(error.message, hint);
  }

  // INVALID_OPTIONS: surface the failing option paths so the caller can fix the request.
  const hint = error.issues
    ?.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  return new ToolInputError(error.message, hint === "" ? undefined : hint);
}

// Re-validate a `rule: "custom"` request inside the handler. The wire schema's permissive branch lets
// a malformed custom entry through on purpose (see `ruleRequestSchema`), and `entry.rule === "custom"`
// does not narrow `RuleConfigEntry` away — its `rule` is an open `z.string()` — so this parses rather
// than casts. That also means `handleLint`, which tests call directly, never reaches
// `resolveCustomRule` with an absent `id` — the same crash the config boundary already guards.
function resolveCustomRequest(entry: LintRuleRequest): Rule {
  const parsed = customRuleEntrySchema.safeParse(entry);
  if (!parsed.success) {
    const hint = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new ToolInputError(
      'A "custom" rule entry requires "id" and "options.assert".',
      hint === "" ? undefined : hint,
    );
  }
  return resolveCustomRule(parsed.data, ruleRegistry);
}

// Resolve requested entries to runnable rules, mirroring lintFiles' resolve-then-filter of `"off"`
// (that helper isn't exported and is only ~6 lines — not worth a core export for one caller).
function resolveRequestedRules(
  entries: readonly LintRuleRequest[],
): ResolvedRule[] {
  const resolved: ResolvedRule[] = [];
  for (const entry of entries) {
    let rule: Rule;
    try {
      // The `else` branch narrows to `RuleConfigEntry` (the literal-`"custom"` member drops out),
      // keeping `entry.options` the `unknown` that per-rule validation expects.
      rule =
        entry.rule === "custom"
          ? resolveCustomRequest(entry)
          : ruleRegistry.resolveRule(entry.rule, entry.options);
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
    // Rule *resolution* stays here — `resolveRequestedRules` owns translating a `RuleResolutionError`
    // into this host's `{ code, message, hint }` contract — and every step after it is core's
    // `lintContent`: parse, corpus of one, scope split, inline-disable, counts. Those steps used to
    // be assembled in this function, which made this the one place `lintFiles`' step
    // order existed twice; a step added there would silently not have reached this tool.
    //
    // `rootDir` is the server cwd, mirroring the fallback `resolveToolCwd` applies to the file-based
    // tools. It is a bare `process.cwd()` call, not that helper: this tool takes no `cwd` input, so
    // there is nothing caller-supplied to validate. Passing a real directory rather than a bespoke
    // corpus-only mode is deliberate — REF-001/003 resolve `rootDir` into `existsSync` for targets
    // outside the corpus, so on-disk targets resolve exactly as they do under `lint-files`, and core
    // stays the single owner of REF/SEC resolution semantics.
    const result = lintContent({
      path: AD_HOC_DOCUMENT_PATH,
      content: input.content,
      rules: resolveRequestedRules(input.rules),
      rootDir: process.cwd(),
    });

    return successResult({
      // Core's own text formatter, so `lint` and `lint-files` render byte-for-byte consistently.
      summary: formatLintResultText(result),
      // Deliberately narrower than `LintResult`: an ad-hoc document is not a corpus, so there is no
      // `files` list to report. The divergence from `lint-files` is deliberate, and pinned by
      // `test/lint.test.ts` so it cannot drift into an accident.
      structured: {
        messages: result.messages,
        errorCount: result.errorCount,
        warningCount: result.warningCount,
      },
    });
  } catch (error) {
    // `process.cwd()` is the right base here even though this tool takes no `cwd` input: it is the
    // same root the corpus-of-one above lints against (`rootDir`), so a file-resolving rule that
    // fails on an errno names its path relative to the directory the rule actually probed.
    return errorResult(error, {
      successFields: EMPTY_LINT_OUTPUT,
      cwd: process.cwd(),
    });
  }
}

export function registerLintTool(server: McpServer): void {
  server.registerTool(
    "lint",
    {
      title: "Lint Markdown content",
      // This text ships on every `listTools` and is generated into the README inventory, so it stays
      // terse. It must avoid `|` (would be escaped into the table) and `**` (Prettier destructively
      // rewrites a glob-bearing code span nested in bold).
      description:
        "Lint ad-hoc Markdown content against an explicit set of rules. Does not load project config; " +
        "file-resolving rules such as REF-001/REF-003, SEC-003 and STR-001 may probe or read paths " +
        "inside the server's working directory; an absolute path or a `..`-escaping relative path is " +
        "rejected rather than followed. Each entry is either a built-in rule id or a declarative " +
        '`custom` rule (`rule: "custom"` plus `id` and `options.assert`); code plugins are never ' +
        "loaded. Rules see one synthetic document path, `content.md`, so an `options.files` or " +
        "`options.exclude` glob that does not match that path selects nothing.",
      inputSchema: lintInputShape,
      outputSchema: withErrorOutput(lintOutputShape),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) => handleLint(input),
  );
}
