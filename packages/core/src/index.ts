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
export { parseMarkdownFiles } from "./markdown/parse.js";
export {
  createAuditResult,
  renderAuditResultJson,
  renderAuditResultText
} from "./reporting/render.js";
export { checkLocalLinks } from "./rules/local-links.js";
export { checkFileSizes, estimateTokens, resolveMaxBytesForFile } from "./rules/size.js";
export { checkStructureRules } from "./rules/structure.js";
