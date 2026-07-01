export type FindingSeverity = "error" | "warning" | "info";

export type ConfigFileName =
  | "wastech-mdlint.config.json"
  | "wastech-mdlint.config.cjs"
  | "wastech-mdlint.config.mjs";

export type SizeOverride = {
  pattern: string;
  maxBytes: number;
};

export type RequiredSectionRule = {
  pattern: string;
  slugs: string[];
};

export type MarkdownFile = {
  path: string;
  absolutePath: string;
  bytes: number;
  text?: string;
};

export type MarkdownLinkKind =
  | "local-file"
  | "same-file-anchor"
  | "external"
  | "mailto"
  | "other";

export type MarkdownLink = {
  sourcePath: string;
  rawTarget: string;
  kind: MarkdownLinkKind;
  targetPath?: string;
  anchor?: string;
  line?: number;
  column?: number;
};

export type AnchorIndex = Record<string, string[]>;

export type Finding = {
  ruleId: string;
  severity: FindingSeverity;
  path: string;
  line?: number;
  column?: number;
  message: string;
};

export type DependencyGraphNode = {
  path: string;
  bytes: number;
};

export type DependencyGraphEdge = {
  from: string;
  to: string;
  kind: "markdown-link";
};

export type DependencyGraph = {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
};

export type LlmImport = {
  sourcePath: string;
  rawTarget: string;
  targetPath: string;
  line?: number;
  column?: number;
};

export type LlmImportEdge = {
  from: string;
  to: string;
  kind: "eager-import";
};

export type LlmImportCycle = {
  paths: string[];
  line?: number;
  column?: number;
  sourcePath: string;
};

export type EntrypointImportGraph = {
  entrypointPath: string;
  importedPaths: string[];
  missingImports: LlmImport[];
  cycles: LlmImportCycle[];
};

export type LlmImportGraph = {
  entrypoints: string[];
  imports: LlmImport[];
  edges: LlmImportEdge[];
  traversals: EntrypointImportGraph[];
};

export type EntrypointBudgetImportedFile = {
  path: string;
  bytes: number;
  estimatedTokens: number;
};

export type EntrypointBudget = {
  entrypoint: string;
  ownBytes: number;
  ownEstimatedTokens: number;
  importedFiles: EntrypointBudgetImportedFile[];
  totalBytes: number;
  totalEstimatedTokens: number;
  maxTokens: number;
  overLimit: boolean;
  cycles: LlmImportCycle[];
  missingImports: LlmImport[];
};

export type AuditConfig = {
  include: string[];
  exclude: string[];
  size: {
    maxBytesDefault: number;
    overrides: SizeOverride[];
  };
  llm: {
    entrypoints: string[];
    maxTokensPerEntrypoint: number;
  };
  links: {
    checkExternal: boolean;
    ignorePatterns: string[];
  };
  structure: {
    orphanDocs: "error" | "warning" | "off";
    orphanExemptions: string[];
    requiredSections: RequiredSectionRule[];
  };
};

export type LoadedConfig = {
  config: AuditConfig;
  configPath?: string;
};

export type AuditSummary = {
  root: string;
  files: number;
  findings: {
    error: number;
    warning: number;
    info: number;
  };
};

export type AuditResultFile = {
  path: string;
  bytes: number;
};

export type AuditResult = {
  summary: AuditSummary;
  findings: Finding[];
  files: AuditResultFile[];
  graph: DependencyGraph;
  budgets: EntrypointBudget[];
};
