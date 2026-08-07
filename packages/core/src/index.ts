// Public barrel for @wastech-mdlint/core.
//
// This is the whole public contract for the v2 pipeline (core-hosts-the-pipeline decision): the CLI
// and MCP hosts import parsing, config, graph, rules, and formatting exclusively through this module.
// The legacy single-package pipeline is gone; this barrel is the whole public surface.

// Parser
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
export { compareStrings } from "./deterministic-sort.js";

// Atomic writes — the single write path both hosts use, so no surface re-invents
// truncate-and-write. The newline helpers behind `--fix` stay core-internal.
export { writeFileAtomic, writeFilesAtomic } from "./atomic-write.js";
export type { AtomicFileWrite, AtomicWriteResult } from "./atomic-write.js";

// Repo scan
export {
  classifyPrunedDirName,
  DEFAULT_KNOWN_CLUSTER_NAMES,
  DEFAULT_MIN_CLUSTER_SIZE,
  DEFAULT_NOISE_DIR_NAMES,
  DEFAULT_SAMPLE_SIZE,
} from "./discovery/repo-scan-constants.js";
// Exported for the hosts, not only for core's own walks: `init`'s scan-exclusion disclosure suggests
// an `include` pattern for a pruned directory, and it must splice the same tail every other proposal
// does or it would advertise a narrower set than the scan counted.
export { MARKDOWN_GLOB_SUFFIX } from "./discovery/markdown-extensions.js";
export { detectPackageManager } from "./discovery/package-manager.js";
export type { DetectedPackageManager } from "./discovery/package-manager.js";
export { detectWorkspacePackages } from "./discovery/workspace-packages.js";
export type { WorkspacePackage } from "./discovery/workspace-packages.js";
export { scanRepository } from "./discovery/repo-scan.js";
export type {
  DocCluster,
  DocClusterKind,
  PrunedDirectory,
  PrunedDirectoryReason,
  RepoScanResult,
  ScanPruning,
  ScanRepositoryOptions,
} from "./discovery/repo-scan.js";

// Rule inference
export { inferRuleSet } from "./discovery/rule-inference.js";
export type {
  ClusterRuleInference,
  DetectedPatterns,
  InferredRule,
  RuleInferenceResult,
} from "./discovery/rule-inference.js";

// Config writer
export {
  buildCiWorkflowYaml,
  CI_WORKFLOW_YAML,
  containsJsoncComments,
  generateInitConfig,
  identifyExistingRule,
  PACKAGE_SCHEMA_SEGMENTS,
  resolvePackageSchemaRef,
} from "./discovery/config-writer.js";
export type {
  ExistingConfigDocument,
  ExistingRuleIdentity,
  GeneratedInitConfig,
  GenerateInitConfigParams,
  InitConfigAction,
  ProjectSchemaReason,
} from "./discovery/config-writer.js";

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
// `query` and `getImpactSet` (below) have no host caller: the graph commands and MCP tools reach
// traversal through `getContextSlice` / `impact` / compile, and `query`'s only cross-module callers
// are core's own `graph/search-index.ts` and `compile/compile-context.ts` (besides `impact()` in the
// same module). They stay exported as deliberate library surface all the same. `query` is the
// single traversal every graph feature composes, so a consumer builds on it rather than writing a
// second walk with different visited-set and depth semantics — the "no parallel traversal" property
// the whole graph layer rests on. `getImpactSet` is the raw affected-set closure that
// `classifyImpact` projects into its directly/transitively/reading-order buckets, so it is the
// useful form for a consumer that wants its own classification. Four neighbouring exports in the
// same position were removed for having neither property; these two are an exception on purpose,
// not an oversight.
export { impact, query } from "./graph/query.js";
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

// Compile
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
export {
  compileContext,
  CompileConfigMissingError,
} from "./compile/compile-context.js";

// Skills
export {
  skillModelSchema,
  validateSkill,
  parseSkillFrontmatter,
} from "./skills/skill-model.js";
export type {
  Skill,
  SkillKind,
  SkillValidationIssue,
  SkillValidationResult,
} from "./skills/skill-model.js";

// Engine
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
// The ad-hoc entry point over the shared step order, and the only half of that split a host
// needs: `lintContent` is the MCP `lint` tool's whole body. `lintCorpus` itself stays **unexported**
// on purpose — its two callers are `lintFiles` and `lintContent`, both inside core, and it takes an
// already-parsed corpus plus already-resolved rules, which a host has no way to hold without
// re-assembling the discovery half the split exists to keep in one place.
export { lintContent } from "./engine/lint-content.js";
export type { LintContentInput } from "./engine/lint-content.js";
export { createSuppressionChecker } from "./engine/suppression.js";
export type { SuppressionChecker } from "./engine/suppression.js";
export {
  formatLintResultJson,
  formatLintResultText,
} from "./engine/format-lint-result.js";
export { estimateTokens } from "./engine/tokens.js";
export { applyEdits, applyFixes, FixWriteError } from "./engine/fix.js";
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

// Primitives
export {
  assertionSchema,
  ASSERTION_TARGETS,
  isProjectAssertion,
  runAssertion,
} from "./engine/primitives/assert.js";
export type { Assertion } from "./engine/primitives/assert.js";
export { DEFAULT_PLACEHOLDERS } from "./engine/primitives/content.js";
export type {
  PrimitiveContext,
  PrimitiveFinding,
} from "./engine/primitives/types.js";

// Registry + rules
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

// Schema + docs generation
export { generateConfigSchema } from "./engine/schema.js";
export type { CustomRuleDefinition } from "./engine/schema.js";
export { generateRuleDocs } from "./engine/rule-docs.js";

// Config
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

// Structured error taxonomy — defined once here, shared by cli + mcp-server.
export { TOOL_ERROR_CODES, isStructuredError } from "./errors.js";
export type { StructuredErrorInfo, ToolErrorCode } from "./errors.js";
export { CONFIG_FILE_NAME, findConfig } from "./config/find-config.js";
export { loadConfiguration } from "./config/load-config.js";
export type {
  ConfiguredRule,
  LoadedConfiguration,
} from "./config/load-config.js";
