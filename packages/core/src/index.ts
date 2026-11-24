// Public barrel for @wastech-mdlint/core.
//
// This is the whole public contract for the v2 pipeline (core-hosts-the-pipeline decision): the CLI
// and MCP hosts import parsing, config, graph, rules, and formatting exclusively through this module.
// The legacy single-package pipeline is gone; this barrel is the whole public surface.

// Parser
export type {
  FrontmatterParseResult,
  FrontmatterValue,
  InlineDirective,
  InlineDirectiveKind,
  ParsedCheckItem,
  ParsedDocument,
  ParsedFrontmatter,
  ParsedHeading,
  ParsedHtmlAnchor,
  ParsedImage,
  ParsedImport,
  ParsedLink,
  ParsedLinkKind,
  ParsedReversedLink,
  ParsedTable,
  ParsedTableRow,
  ParsedUndefinedReference,
} from "./markdown/document-types.js";
export {
  parseDocument,
  parseDocumentWithTree,
} from "./markdown/parse-document.js";
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
  DEFAULT_KNOWN_CLUSTER_NAMES,
  DEFAULT_MIN_CLUSTER_SIZE,
  DEFAULT_NOISE_DIR_NAMES,
  DEFAULT_SAMPLE_SIZE,
} from "./discovery/repo-scan-constants.js";
// Exported for the hosts, not only for core's own walks: `init`'s scan-exclusion disclosure suggests
// an `include` pattern for a pruned directory, and it must splice the same tail every other proposal
// does or it would advertise a narrower set than the scan counted.
export {
  isMarkdownFile,
  MARKDOWN_GLOB_SUFFIX,
} from "./discovery/markdown-extensions.js";
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
  InferenceScope,
  InferredRule,
  RuleInferenceResult,
} from "./discovery/rule-inference.js";

// Agent rule
export { buildAgentRuleMarkdown, cliRunner } from "./discovery/agent-rule.js";
export type { AgentRuleParams } from "./discovery/agent-rule.js";

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
export type {
  ContextGraphSummaryOptions,
  TopologicalSortResult,
} from "./graph/graph-algorithms.js";
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
  ContextSliceOptions,
  ContextSliceResult,
  SliceMatchKind,
} from "./graph/search-index.js";
export {
  classifyChangeImpact,
  classifyImpact,
  getImpactSet,
  ImpactAnalysisError,
  relativizeImpact,
} from "./graph/impact-analysis.js";
export type {
  ChangeImpact,
  DirectlyAffected,
  ImpactClassification,
  TransitivelyAffected,
} from "./graph/impact-analysis.js";
export { loadContext } from "./graph/load-context.js";
export type { GraphContext } from "./graph/load-context.js";

// Git — read-only access to the repository a host was pointed at, for comparing the corpus with a
// base branch. In core rather than in a host because what it feeds (which documents changed, and
// how) is shared computation: two hosts asking git separately would disagree on the base, the
// prefix or the rename rules. The process runner and its environment stay internal, so no caller
// can start git without the settings that keep repository config from running programs.
export {
  GitRepository,
  MINIMUM_GIT_VERSION,
  openGitRepository,
} from "./git/git-repository.js";
export type {
  BlameLine,
  FileCommit,
  GitBase,
  GitChange,
  GitUnavailable,
  GitUnavailableReason,
  OpenGitRepositoryOptions,
} from "./git/git-repository.js";
export { GitCommandError } from "./git/git-command.js";
// How every program the product starts is found, so a host that launches one (the viewer opening a
// file manager) cannot be made to run a same-named file from the repository it serves.
export { findExecutable } from "./find-executable.js";

// Changes — what a branch changed in the corpus, and the diff a reviewer reads. The sequence diff
// under them stays internal: hosts compare texts, not arbitrary sequences.
export { classifyChanges, collectChangeSet } from "./changes/change-set.js";
export {
  eagerContextBudgets,
  eagerContextPaths,
  rankByInfluence,
} from "./changes/influence.js";
export type { EagerContextBudget, RankedChange } from "./changes/influence.js";
export type {
  ChangeSet,
  ClassifiedChanges,
  CorpusMembership,
} from "./changes/change-set.js";
export {
  contextGaps,
  diffText,
  lineCorrespondence,
  lineRangeKept,
  normalizeText,
  tableRowLines,
} from "./changes/text-diff.js";
export type {
  DiffGap,
  DiffHunk,
  DiffLine,
  DiffSegment,
  LineRun,
  TextDiff,
  TextDiffOptions,
} from "./changes/text-diff.js";
export {
  baseLineMap,
  changedSections,
  headChanges,
  introductionChanged,
} from "./changes/head-changes.js";
export type {
  HeadChanges,
  HeadLineChange,
  HeadRemoval,
} from "./changes/head-changes.js";
export { compareFindings } from "./changes/findings-delta.js";
export type {
  FindingLocator,
  FindingsDelta,
} from "./changes/findings-delta.js";
export { replaceDocuments } from "./changes/snapshot.js";
export type { DocumentSwap } from "./changes/snapshot.js";
export { compareEdges, linksIntoChangedLines } from "./changes/link-delta.js";
export type { CodeLineLink, EdgesDelta } from "./changes/link-delta.js";
export {
  computeContextDelta,
  lineLinkTargets,
  swapsTowardBase,
  swapsTowardHead,
} from "./changes/context-delta.js";
export type {
  AffectedDocuments,
  ChangedDocument,
  ContextDelta,
  ContextSide,
  DocumentContextDelta,
  EagerContextChange,
} from "./changes/context-delta.js";
export {
  analyzeSince,
  branchContext,
  reviewBranch,
} from "./changes/branch-review.js";
export type {
  BranchContext,
  BranchReview,
  CorpusSnapshot,
  ReviewedConfig,
  ReviewedDocument,
  SinceAnalysis,
} from "./changes/branch-review.js";
export {
  renderSinceHeader,
  sinceImpact,
  sinceLintResult,
} from "./changes/since-report.js";
export type {
  SinceImpact,
  SinceLintResult,
  SinceSummary,
} from "./changes/since-report.js";
export { documentSections } from "./changes/sections.js";
export type { DocumentSection } from "./changes/sections.js";
export { parseLineFragment } from "./engine/anchor-resolve.js";
export { eagerContextTokens } from "./engine/rules/llm.js";
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
export { lintContext, lintFiles } from "./engine/lint-files.js";
export type {
  LintContextInput,
  LintFilesInput,
  LintResult,
} from "./engine/lint-files.js";
// The ad-hoc entry point over the shared step order: `lintContent` is the MCP `lint` tool's whole
// body. `lintCorpus` itself stays **unexported** on purpose — its callers are `lintFiles`,
// `lintContext` and `lintContent`, all inside core, and it takes an already-parsed corpus plus
// already-resolved rules. A host can hold a parsed corpus only as `loadContext` returned it and
// rules only as `loadConfiguration` returned them, which is exactly what `lintContext` accepts, so
// discovery and severity resolution stay in one place.
export { lintContent } from "./engine/lint-content.js";
export type { LintContentInput } from "./engine/lint-content.js";
export {
  analyzeDirectives,
  createSuppressionChecker,
  DIRECTIVE_DIAGNOSTIC_RULE_ID,
} from "./engine/suppression.js";
export type {
  DirectiveAnalysis,
  DirectiveDiagnostic,
  SuppressionChecker,
} from "./engine/suppression.js";
export {
  formatLintResultJson,
  formatLintResultText,
} from "./engine/format-lint-result.js";
export { estimateTokens } from "./engine/tokens.js";
export { measureDocument } from "./engine/document-metrics.js";
export {
  buildFindingPrompt,
  findingPromptStrategies,
  isBudgetFinding,
  PROMPT_STRATEGY_LABELS,
} from "./engine/fix-prompt.js";
export type {
  FindingPromptInput,
  PromptFinding,
  PromptRuleEntry,
  PromptStrategy,
} from "./engine/fix-prompt.js";
export type { DocumentMetrics } from "./engine/document-metrics.js";
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
export {
  candidateEscapesRoot,
  filePart,
  resolveTargetCandidates,
} from "./engine/path-resolve.js";

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
  findMixedRuleSpellings,
  mixedRuleSpellingMessage,
  RuleRegistry,
  RuleResolutionError,
} from "./engine/registry.js";
export type {
  ConfigIssue,
  MixedRuleSpelling,
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
export {
  duplicateCustomIdMessage,
  findDuplicateCustomIds,
  resolveCustomRule,
} from "./engine/rules/custom.js";
export type {
  CustomIdCollision,
  CustomRuleEntry,
} from "./engine/rules/custom.js";

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
export { loadConfiguration, parseConfiguration } from "./config/load-config.js";
export { editConfigText } from "./config/edit-config.js";
export type { ConfigEdit, ConfigEditPath } from "./config/edit-config.js";
export type {
  ConfiguredRule,
  LoadedConfiguration,
} from "./config/load-config.js";
// Public because `init` has to measure the same corpus the config it writes will lint, and the
// `exclude` that config carries is this list. A host re-deriving it would be a second copy, free to
// disagree with the lint path about which files the counts in the written rationale describe.
//
// `DEFAULT_INCLUDE_GLOBS` for the same reason on the other side: when a draft omits the `include`
// key, this is the scope its files will actually be selected by, and `init`'s disclosure has to
// judge each skipped file against it rather than assume the key it is not writing.
export {
  DEFAULT_EXCLUDE_GLOBS,
  DEFAULT_INCLUDE_GLOBS,
} from "./config/corpus-scope.js";
export { createScopeTester } from "./config/scope-tester.js";
export type { ScopeTester } from "./config/scope-tester.js";
