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
  ParsedTableRow,
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
  normalizeRelativePath,
} from "./discovery/globs.js";

// Repo scan (P6.01)
export {
  DEFAULT_KNOWN_CLUSTER_NAMES,
  DEFAULT_MIN_CLUSTER_SIZE,
  DEFAULT_NOISE_DIR_NAMES,
  DEFAULT_SAMPLE_SIZE,
} from "./discovery/repo-scan-constants.js";
export { detectPackageManager } from "./discovery/package-manager.js";
export type { DetectedPackageManager } from "./discovery/package-manager.js";
export { detectWorkspacePackages } from "./discovery/workspace-packages.js";
export type { WorkspacePackage } from "./discovery/workspace-packages.js";
export { scanRepository } from "./discovery/repo-scan.js";
export type {
  DocCluster,
  DocClusterKind,
  RepoScanResult,
  ScanRepositoryOptions,
} from "./discovery/repo-scan.js";

// Rule inference (P6.02)
export { inferRuleSet } from "./discovery/rule-inference.js";
export type {
  ClusterRuleInference,
  DetectedPatterns,
  InferredRule,
  RuleInferenceResult,
} from "./discovery/rule-inference.js";

// Graph
export type {
  BuildContextGraphOptions,
  ContextGraph,
  ContextGraphEdge,
  ContextGraphEdgeType,
  ContextGraphNode,
} from "./graph/context-graph-types.js";
export { buildContextGraph } from "./graph/build-context-graph.js";
export { computeGraphCoverage } from "./graph/coverage.js";
export type {
  ComputeGraphCoverageOptions,
  GraphCoverage,
} from "./graph/coverage.js";
export {
  formatContextGraphSummary,
  getComponents,
  topologicalSort,
} from "./graph/graph-algorithms.js";
export type { TopologicalSortResult } from "./graph/graph-algorithms.js";
export { impact, query, slice } from "./graph/query.js";
export type {
  QueryDirection,
  QueryOptions,
  QueryResult,
  QueryVisit,
} from "./graph/query.js";
export {
  buildSearchIndex,
  getContextSlice,
  resolveQuery,
  SLICE_RESOLUTION_DESCRIPTION,
} from "./graph/search-index.js";
export type {
  ContextSearchIndex,
  ContextSliceResult,
  SliceMatchKind,
} from "./graph/search-index.js";
export {
  classifyImpact,
  getImpactSet,
  ImpactAnalysisError,
  relativizeImpact,
} from "./graph/impact-analysis.js";
export type {
  DirectlyAffected,
  ImpactClassification,
  TransitivelyAffected,
} from "./graph/impact-analysis.js";
export { loadContext } from "./graph/load-context.js";
export type { GraphContext } from "./graph/load-context.js";
export {
  renderContextGraphDot,
  renderContextGraphMermaid,
  renderContextGraphText,
  renderContextSliceSummary,
  renderImpactSummary,
  summarizeContextGraph,
} from "./graph/graph-render.js";
export type { ContextGraphSummary } from "./graph/graph-render.js";

// Compile (P5)
export {
  analyzeGraph,
  classifyNodes,
  DEFAULT_HUB_MIN_IN_DEGREE,
} from "./compile/graph-analysis.js";
export type {
  GraphAnalysis,
  GraphAnalysisOptions,
  NodeClassification,
  NodeRole,
} from "./compile/graph-analysis.js";
export { extractDocProfile } from "./compile/doc-profile.js";
export type {
  DocumentOutlineItem,
  DocumentProfile,
  DocumentTableSchema,
} from "./compile/doc-profile.js";
export { describeRules } from "./compile/describe-rules.js";
export type {
  DescribedRule,
  RuleDescriptionGroup,
} from "./compile/describe-rules.js";
export { skillFrontmatterSchema } from "./compile/skill-frontmatter.js";
export type { SkillFrontmatter } from "./compile/skill-frontmatter.js";
export { synthesize } from "./compile/synthesize.js";
export type {
  CompileBudget,
  CompileBudgetEntrypoint,
  CompileCommandPreset,
  CompileResult,
  CompileSections,
  SynthesizeInput,
} from "./compile/synthesize.js";
export { compileContext, CompileConfigMissingError } from "./compile/compile-context.js";

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
  TextEdit,
} from "./engine/types.js";
export { runRules } from "./engine/run-rules.js";
export type { RunRulesContext } from "./engine/run-rules.js";
export { lintFiles } from "./engine/lint-files.js";
export type { LintFilesInput, LintResult } from "./engine/lint-files.js";
export { createSuppressionChecker } from "./engine/suppression.js";
export type { SuppressionChecker } from "./engine/suppression.js";
export {
  formatLintResultJson,
  formatLintResultText,
} from "./engine/format-lint-result.js";
export { estimateTokens } from "./engine/tokens.js";
export { applyEdits, applyFixes } from "./engine/fix.js";
export type { ApplyFixesResult } from "./engine/fix.js";
export { extractColumnIds, extractDefinedIds } from "./engine/defined-ids.js";
export type { IdOccurrence, IdRef } from "./engine/defined-ids.js";
export {
  compileRegex,
  regexFlagsSchema,
  regexStringSchema,
} from "./engine/regex.js";
export { findLineNumber } from "./engine/text-position.js";
export { extractSectionBody } from "./engine/section-body.js";
export { resolveRoutedUrl } from "./engine/site-router.js";

// Primitives (P2.02)
export {
  assertionSchema,
  ASSERTION_TARGETS,
  isProjectAssertion,
  runAssertion,
} from "./engine/primitives/assert.js";
export type {
  Assertion,
  RunAssertionOptions,
} from "./engine/primitives/assert.js";
export { DEFAULT_PLACEHOLDERS } from "./engine/primitives/content.js";
export type {
  PrimitiveContext,
  PrimitiveFinding,
} from "./engine/primitives/types.js";

// Registry + rules (P2.03 / P3)
export {
  defineRule,
  RuleRegistry,
  RuleResolutionError,
} from "./engine/registry.js";
export type {
  ConfigIssue,
  RuleDefinition,
  RuleMetadata,
  RuleResolutionCode,
} from "./engine/registry.js";
export {
  BUILTIN_RULE_DEFINITIONS,
  ruleRegistry,
} from "./engine/rules/index.js";
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
  compileCommandPresetSchema,
  compileConfigSchema,
  customRuleEntrySchema,
  lintConfigSchema,
  ruleEntrySchema,
  ruleEntryUnionSchema,
  severityOverrideSchema,
} from "./config/config-schema.js";
export type {
  CompileConfig,
  CustomRuleConfigEntry,
  LintConfig,
  RuleConfigEntry,
} from "./config/config-schema.js";
export { ConfigError } from "./config/config-error.js";
export { CONFIG_FILE_NAME, findConfig } from "./config/find-config.js";
export { loadConfiguration } from "./config/load-config.js";
export type {
  ConfiguredRule,
  LoadedConfiguration,
} from "./config/load-config.js";
