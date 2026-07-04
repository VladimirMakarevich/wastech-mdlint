// Public barrel for @wastech-mdlint/core.
//
// This is the whole public contract for the v2 pipeline (core-hosts-the-pipeline decision): the CLI
// and MCP hosts import parsing, config, graph, rules, and formatting exclusively through this module.
// The legacy single-package pipeline was removed at the P3.09 cutover (D2 greenfield).

// Parser (P1)
export type {
  InlineDirective,
  InlineDirectiveKind,
  ParsedCheckItem,
  ParsedDocument,
  ParsedHeading,
  ParsedImage,
  ParsedImport,
  ParsedLink,
  ParsedLinkKind,
  ParsedTable,
  ParsedTableRow
} from "./markdown/document-types.js";
export { parseDocument } from "./markdown/parse-document.js";
export { loadDocuments } from "./markdown/load-documents.js";
export type { LoadDocumentsOptions } from "./markdown/load-documents.js";
export { canonicalizeRuleId } from "./rule-id.js";

// Glob / path helpers
export {
  matchesConfigGlob,
  normalizeConfigGlob,
  normalizeConfigGlobs,
  normalizeRelativePath
} from "./discovery/globs.js";

// Graph
export type {
  BuildContextGraphOptions,
  ContextGraph,
  ContextGraphEdge,
  ContextGraphEdgeType,
  ContextGraphNode
} from "./graph/context-graph-types.js";
export { buildContextGraph } from "./graph/build-context-graph.js";
export { formatContextGraphSummary, getComponents, topologicalSort } from "./graph/graph-algorithms.js";
export type { TopologicalSortResult } from "./graph/graph-algorithms.js";
export { impact, query, slice } from "./graph/query.js";
export type { QueryDirection, QueryOptions, QueryResult, QueryVisit } from "./graph/query.js";

// Engine (P2)
export type {
  LintMessage,
  ReportInput,
  ResolvedRule,
  ResolvedSettings,
  Rule,
  RuleCategory,
  RuleContext,
  RuleScope,
  Severity,
  SeverityOverride,
  SiteRouterSettings,
  TextEdit
} from "./engine/types.js";
export { runRules } from "./engine/run-rules.js";
export type { RunRulesContext } from "./engine/run-rules.js";
export { lintFiles } from "./engine/lint-files.js";
export type { LintFilesInput, LintResult } from "./engine/lint-files.js";
export { createSuppressionChecker } from "./engine/suppression.js";
export type { SuppressionChecker } from "./engine/suppression.js";
export { formatLintResultJson, formatLintResultText } from "./engine/format-lint-result.js";
export { estimateTokens } from "./engine/tokens.js";
export { applyEdits, applyFixes } from "./engine/fix.js";
export type { ApplyFixesResult } from "./engine/fix.js";
export { extractColumnIds, extractDefinedIds } from "./engine/defined-ids.js";
export type { IdOccurrence, IdRef } from "./engine/defined-ids.js";
export { compileRegex, regexFlagsSchema, regexStringSchema } from "./engine/regex.js";
export { findLineNumber } from "./engine/text-position.js";
export { extractSectionBody } from "./engine/section-body.js";
export { resolveRoutedUrl } from "./engine/site-router.js";

// Primitives (P2.02)
export {
  assertionSchema,
  ASSERTION_TARGETS,
  isProjectAssertion,
  runAssertion
} from "./engine/primitives/assert.js";
export type { Assertion, RunAssertionOptions } from "./engine/primitives/assert.js";
export { DEFAULT_PLACEHOLDERS } from "./engine/primitives/content.js";
export type { PrimitiveContext, PrimitiveFinding } from "./engine/primitives/types.js";

// Registry + rules (P2.03 / P3)
export { defineRule, RuleRegistry, RuleResolutionError } from "./engine/registry.js";
export type { ConfigIssue, RuleDefinition, RuleMetadata, RuleResolutionCode } from "./engine/registry.js";
export { BUILTIN_RULE_DEFINITIONS, ruleRegistry } from "./engine/rules/index.js";
export { fileScopeShape, matchesFileScope } from "./engine/rules/scope.js";
export type { FileScope } from "./engine/rules/scope.js";
export { resolveCustomRule } from "./engine/rules/custom.js";
export type { CustomRuleEntry } from "./engine/rules/custom.js";

// Schema + docs generation (P2.06 / P3.09)
export { generateConfigSchema } from "./engine/schema.js";
export type { CustomRuleDefinition } from "./engine/schema.js";
export { generateRuleDocs } from "./engine/rule-docs.js";

// Config (P2.04 / P3.08)
export {
  customRuleEntrySchema,
  lintConfigSchema,
  ruleEntrySchema,
  ruleEntryUnionSchema,
  severityOverrideSchema
} from "./config/config-schema.js";
export type { CustomRuleConfigEntry, LintConfig, RuleConfigEntry } from "./config/config-schema.js";
export { ConfigError } from "./config/config-error.js";
export { CONFIG_FILE_NAME, findConfig } from "./config/find-config.js";
export { loadConfiguration } from "./config/load-config.js";
export type { ConfiguredRule, LoadedConfiguration } from "./config/load-config.js";
