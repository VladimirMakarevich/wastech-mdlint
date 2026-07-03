import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyzeLlmImports,
  buildDependencyGraph,
  buildEntrypointBudgets,
  checkFileSizes,
  checkLocalLinks,
  checkStructureRules,
  createAuditResult,
  discoverMarkdownFiles,
  formatLintResultJson,
  formatLintResultText,
  generateConfigSchema,
  lintFiles,
  loadConfig,
  loadConfiguration,
  parseMarkdownFiles,
  renderAuditResultJson,
  renderAuditResultText
} from "@wastech-mdlint/core";
import type { AuditResult, LintResult } from "@wastech-mdlint/core";

export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_RUNTIME_ERROR = 1;
export const EXIT_CODE_USAGE_ERROR = 2;

export type OutputFormat = "text" | "json";
export type FailOn = "error" | "warning" | "off";

export type ScanCommand = {
  kind: "scan";
  path: string;
  config?: string;
  format: OutputFormat;
  failOn: FailOn;
};

export type GraphCommand = {
  kind: "graph";
  path: string;
  config?: string;
  out: string;
};

// New v2 lint command (D4). Named in P2.07; becomes the default (with scan as a hidden alias) at the
// P3.09 cutover.
export type LintCommand = {
  kind: "lint";
  path: string;
  config?: string;
  format: OutputFormat;
  failOn: FailOn;
};

export type SchemaCommand = {
  kind: "schema";
  out: string;
};

export type CliCommand = ScanCommand | GraphCommand | LintCommand | SchemaCommand;

export type CommandExecutionResult = {
  output: string;
  exitCode: number;
};

export class CliUsageError extends Error {
  readonly exitCode = EXIT_CODE_USAGE_ERROR;

  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function resolveScanExitCode(params: { failOn: FailOn; result: AuditResult }): number {
  if (params.failOn === "off") {
    return EXIT_CODE_SUCCESS;
  }

  if (params.failOn === "warning") {
    return params.result.findings.length > 0 ? EXIT_CODE_RUNTIME_ERROR : EXIT_CODE_SUCCESS;
  }

  return params.result.summary.findings.error > 0 ? EXIT_CODE_RUNTIME_ERROR : EXIT_CODE_SUCCESS;
}

// Exit codes (roadmap §8): 0 pass / 1 findings at the fail-on threshold / 2 operational (thrown as
// ConfigError etc. and mapped in program.ts).
export function resolveLintExitCode(params: { failOn: FailOn; result: LintResult }): number {
  if (params.failOn === "off") {
    return EXIT_CODE_SUCCESS;
  }

  if (params.failOn === "warning") {
    return params.result.errorCount + params.result.warningCount > 0
      ? EXIT_CODE_RUNTIME_ERROR
      : EXIT_CODE_SUCCESS;
  }

  return params.result.errorCount > 0 ? EXIT_CODE_RUNTIME_ERROR : EXIT_CODE_SUCCESS;
}

async function handleLint(command: LintCommand): Promise<CommandExecutionResult> {
  const loaded = await loadConfiguration({
    cwd: command.path,
    explicitConfigPath: command.config
  });
  const result = await lintFiles({
    cwd: command.path,
    config: loaded.config,
    rules: loaded.rules,
    settings: loaded.settings
  });
  const output =
    command.format === "json" ? formatLintResultJson(result) : formatLintResultText(result);

  return { output, exitCode: resolveLintExitCode({ failOn: command.failOn, result }) };
}

async function handleSchema(command: SchemaCommand): Promise<CommandExecutionResult> {
  const outputPath = path.resolve(command.out);
  const outputStats = await stat(outputPath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (outputStats?.isDirectory()) {
    throw new CliUsageError(`Cannot write schema output to directory path: ${command.out}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generateConfigSchema(), "utf8");

  return { output: `schema written to ${command.out}\n`, exitCode: EXIT_CODE_SUCCESS };
}

async function handleScan(command: ScanCommand): Promise<CommandExecutionResult> {
  const loadedConfig = await loadConfig({
    rootPath: command.path,
    explicitConfigPath: command.config
  });
  const files = await discoverMarkdownFiles({
    rootPath: command.path,
    config: loadedConfig.config
  });
  const parsed = await parseMarkdownFiles(files);
  const findings = checkLocalLinks({
    files: parsed.files,
    links: parsed.links,
    anchorIndex: parsed.anchorIndex
  });
  const sizeFindings = checkFileSizes({
    files: parsed.files,
    config: loadedConfig.config
  });
  const llmImports = analyzeLlmImports({
    files: parsed.files,
    config: loadedConfig.config
  });
  const budgets = buildEntrypointBudgets({
    files: parsed.files,
    config: loadedConfig.config,
    importGraph: llmImports.importGraph
  });
  const graph = buildDependencyGraph({
    files: parsed.files,
    links: parsed.links
  });
  const structureFindings = checkStructureRules({
    graph,
    config: loadedConfig.config
  });
  const result = createAuditResult({
    rootPath: command.path,
    files: parsed.files,
    findings: [
      ...findings,
      ...sizeFindings,
      ...structureFindings,
      ...llmImports.findings,
      ...budgets.findings
    ],
    graph,
    budgets: budgets.budgets
  });
  const output =
    command.format === "json"
      ? renderAuditResultJson(result)
      : renderAuditResultText(result, loadedConfig.config.structure.orphanDocs);

  return {
    output,
    exitCode: resolveScanExitCode({
      failOn: command.failOn,
      result
    })
  };
}

async function handleGraph(command: GraphCommand): Promise<CommandExecutionResult> {
  const loadedConfig = await loadConfig({
    rootPath: command.path,
    explicitConfigPath: command.config
  });
  const files = await discoverMarkdownFiles({
    rootPath: command.path,
    config: loadedConfig.config
  });
  const parsed = await parseMarkdownFiles(files);
  const graph = buildDependencyGraph({
    files: parsed.files,
    links: parsed.links
  });
  const outputPath = path.resolve(command.out);
  const outputDir = path.dirname(outputPath);
  const outputStats = await stat(outputPath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  });

  if (outputStats?.isDirectory()) {
    throw new CliUsageError(`Cannot write graph output to directory path: ${command.out}`);
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        root: command.path,
        configPath: loadedConfig.configPath ?? null,
        graph
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    output: `graph written to ${command.out}\n`,
    exitCode: EXIT_CODE_SUCCESS
  };
}

export async function executeCommand(command: CliCommand): Promise<CommandExecutionResult> {
  switch (command.kind) {
    case "scan":
      return handleScan(command);
    case "graph":
      return handleGraph(command);
    case "lint":
      return handleLint(command);
    case "schema":
      return handleSchema(command);
    default: {
      const exhaustiveCheck: never = command;
      return exhaustiveCheck;
    }
  }
}

// Resolves relative to this module's own compiled location (packages/cli/dist/commands.js), one
// level under dist/, so it keeps finding packages/cli/package.json regardless of which entrypoint
// (index.ts, or a test importing this module directly) triggered the read.
export async function readPackageVersion(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.resolve(moduleDir, "../package.json");
  const packageJsonText = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonText) as { version?: string };

  return packageJson.version ?? "0.0.0";
}
