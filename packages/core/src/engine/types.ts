// Rule-engine contracts (P2.01). Every rule, primitive, and host depends on these types.
//
// Design points from the requirements:
//   - Severity is orchestrator-owned (R1/C2): a rule declares `defaultSeverity`; config overrides
//     it; `"off"` filters the rule out before it runs. So a *resolved* `Severity` never includes
//     "off" — that lives only in config (`SeverityOverride`).
//   - Findings are structured (R3): `column`, `endLine`, `fixable`, `data`, `helpUri`.
//   - Fail-fast (R4): a project rule with no `documents` throws rather than silently no-oping.
//   - Fixes (R2): an optional `fix?` hook returns offset-based `TextEdit`s over the raw content.

import type { ContextGraph } from "../graph/context-graph-types.js";
import type { ParsedDocument } from "../markdown/document-types.js";

// Resolved, runnable severities. `"off"` is a config-time value only (see SeverityOverride).
export type Severity = "error" | "warning";

// Per-rule severity as written in config (C2). `"off"` documents-but-disables a rule.
export type SeverityOverride = Severity | "off";

export type RuleScope = "document" | "project";

// Category prefix a rule belongs to; drives README grouping and `init` categories (R6).
export type RuleCategory =
  | "TBL"
  | "SEC"
  | "STR"
  | "REF"
  | "CTX"
  | "GRP"
  | "SIZE"
  | "LLM"
  | "custom";

// Shared, inheritable config settings (C5). Rules read `ctx.settings`; per-rule options may
// override individual fields. Kept minimal in v2 (siteRouter only) and extended as needed.
export type SiteRouterSettings = {
  preset?: string;
  contentDir?: string;
  defaultLocale?: string;
};

export type ResolvedSettings = {
  siteRouter?: SiteRouterSettings;
};

// Offset-based edit over a document's raw `content` (half-open [start, end)). Offsets are
// unambiguous to apply (sort descending, splice) and are computed by fix hooks from line/column
// positions. The concrete fixable rules land in P3 (audit 4.2); the hook is defined here.
export type TextEdit = {
  start: number;
  end: number;
  newText: string;
};

// What a rule passes to `ctx.report()`. `ruleId` is attached by the runner; `filePath` defaults to
// the current document for document rules and must be set explicitly by project rules (which
// attribute each message to a specific file).
//
// `severity` is an optional per-finding hint for rules whose severity varies by finding (SIZE-001:
// warn vs error threshold). The runner resolves final severity as
// `configOverride ?? finding.severity ?? rule.defaultSeverity`, so a config `severity` override wins
// (C2), then the rule's per-finding hint, then the rule default.
export type ReportInput = {
  message: string;
  line: number;
  column?: number;
  endLine?: number;
  filePath?: string;
  severity?: Severity;
  fixable?: boolean;
  data?: Record<string, unknown>;
  helpUri?: string;
};

// A single finding. Superset of the legacy `Finding` capability (R3) — note `filePath` replaces the
// legacy `path`, and `line` is required (file-level rules report line 1). JSON output is the
// serialization of this shape.
export type LintMessage = {
  ruleId: string;
  severity: Severity;
  message: string;
  filePath: string;
  line: number;
  column?: number;
  endLine?: number;
  fixable?: boolean;
  data?: Record<string, unknown>;
  helpUri?: string;
};

// Runtime context handed to `rule.check()` / `rule.fix()`.
//
// `document`/`filePath` are present for document-scope rules (the file under lint). `documents`/
// `projectFiles` carry the whole corpus and are consumed by project rules and by cross-file
// document rules (e.g. REF-001 resolving a link against the corpus). They are typed optional so the
// R4 fail-fast check is meaningful, but the orchestrator always supplies them.
//
// Keying: `documents` is keyed by **repo-relative POSIX path** (each doc's own `.path`), which is
// what rules resolve link/ID targets to — distinct from `loadDocuments()`'s absolute-keyed map,
// which the orchestrator re-keys before building contexts.
//
// `rootDir` is the absolute cwd; REF-001/REF-003 need it for `existsSync` resolution of link/image
// targets that live on disk but outside the Markdown corpus (audit — P3 REF gap). It extends the
// minimal P2.01 field list (journal [P2.01]).
export type RuleContext = {
  document?: ParsedDocument;
  filePath?: string;
  documents?: Map<string, ParsedDocument>;
  projectFiles?: string[];
  rootDir?: string;
  settings: ResolvedSettings;
  graph?: ContextGraph;
  report(finding: ReportInput): void;
};

// A runnable rule instance produced by `resolveRule` (options already validated + bound).
export type Rule = {
  id: string;
  description: string;
  category: RuleCategory;
  defaultSeverity: Severity;
  scope: RuleScope;
  fixable: boolean;
  docsUrl?: string;
  check(context: RuleContext): void;
  fix?(context: RuleContext): TextEdit[];
};

// A resolved rule paired with its config severity *override* (`"off"` already filtered out by the
// orchestrator). `severityOverride` undefined ⇒ the rule's per-finding hint / default applies.
export type ResolvedRule = {
  rule: Rule;
  severityOverride?: Severity;
};
