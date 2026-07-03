// Public barrel for @wastech-mdlint/core.
//
// This is the whole public contract for the pipeline (core-hosts-the-pipeline decision): CLI and
// MCP hosts must import parsing, config, discovery, graph, rules, and reporting exclusively
// through this module instead of reaching into internal paths.

export type {
  AnchorIndex,
  AuditConfig,
  AuditResult,
  AuditResultFile,
  AuditSummary,
  ConfigFileName,
  DependencyGraph,
  DependencyGraphEdge,
  DependencyGraphNode,
  EntrypointBudget,
  EntrypointBudgetImportedFile,
  EntrypointImportGraph,
  Finding,
  FindingSeverity,
  LlmImport,
  LlmImportCycle,
  LlmImportEdge,
  LlmImportGraph,
  LoadedConfig,
  MarkdownFile,
  MarkdownLink,
  MarkdownLinkKind,
  RequiredSectionRule,
  SizeOverride
} from "./types.js";

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
export type { LoadDocumentsOptions } from "./markdown/load-documents.js";

export type {
  ContextGraph,
  ContextGraphEdge,
  ContextGraphEdgeType,
  ContextGraphNode
} from "./graph/context-graph-types.js";

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
export { compileRegex, regexFlagsSchema, regexStringSchema } from "./engine/regex.js";
export { findLineNumber } from "./engine/text-position.js";
export { extractSectionBody } from "./engine/section-body.js";
export { resolveRoutedUrl } from "./engine/site-router.js";
export {
  assertionSchema,
  ASSERTION_TARGETS,
  isProjectAssertion,
  runAssertion
} from "./engine/primitives/assert.js";
export type { Assertion, RunAssertionOptions } from "./engine/primitives/assert.js";
export { DEFAULT_PLACEHOLDERS } from "./engine/primitives/content.js";
export type { PrimitiveContext, PrimitiveFinding } from "./engine/primitives/types.js";
export { defineRule, RuleRegistry, RuleResolutionError } from "./engine/registry.js";
export type { ConfigIssue, RuleDefinition, RuleMetadata, RuleResolutionCode } from "./engine/registry.js";
export { BUILTIN_RULE_DEFINITIONS, ruleRegistry } from "./engine/rules/index.js";

export { DEFAULT_CONFIG, SUPPORTED_CONFIG_FILE_NAMES } from "./config/defaults.js";
export { ConfigError, loadConfig } from "./config/load.js";
export { discoverMarkdownFiles, DiscoveryError } from "./discovery/discover.js";
export {
  matchesConfigGlob,
  normalizeConfigGlob,
  normalizeConfigGlobs,
  normalizeRelativePath
} from "./discovery/globs.js";
export { buildDependencyGraph } from "./graph/build.js";
export { buildEntrypointBudgets } from "./llm/budget.js";
export { analyzeLlmImports } from "./llm/imports.js";
export { loadDocuments } from "./markdown/load-documents.js";
export { parseDocument } from "./markdown/parse-document.js";
export { parseMarkdownFiles } from "./markdown/parse.js";
export { canonicalizeRuleId } from "./rule-id.js";
export {
  createAuditResult,
  renderAuditResultJson,
  renderAuditResultText
} from "./reporting/render.js";
export { checkLocalLinks } from "./rules/local-links.js";
export { checkFileSizes, estimateTokens, resolveMaxBytesForFile } from "./rules/size.js";
export { checkStructureRules } from "./rules/structure.js";
