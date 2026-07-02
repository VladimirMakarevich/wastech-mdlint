#!/usr/bin/env node

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
  ConfigError,
  createAuditResult,
  discoverMarkdownFiles,
  DiscoveryError,
  loadConfig,
  parseMarkdownFiles,
  renderAuditResultJson,
  renderAuditResultText
} from "@wastech-mdlint/core";
import type { AuditResult } from "@wastech-mdlint/core";

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

export type ParsedCommand =
  | { kind: "help" }
  | { kind: "version" }
  | ScanCommand
  | GraphCommand;

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

const HELP_TEXT = `wastech-mdlint

Usage:
  wastech-mdlint lint [path] [--config <file>] [--format text|json] [--fail-on error|warning|off]
  wastech-mdlint graph [path] [--config <file>] --out <file>
  wastech-mdlint --help
  wastech-mdlint --version

Commands:
  lint    Analyze Markdown files (primary command).
  scan    Backward-compatible alias for lint.`;

const SCAN_FORMATS = new Set<OutputFormat>(["text", "json"]);
const FAIL_ON_VALUES = new Set<FailOn>(["error", "warning", "off"]);

function isOptionToken(token: string): boolean {
  return token.startsWith("--");
}

function takeOptionValue(tokens: string[], index: number, optionName: string): string {
  const value = tokens[index + 1];

  if (value === undefined || isOptionToken(value)) {
    throw new CliUsageError(`Missing value for ${optionName}.`);
  }

  return value;
}

function parseScanCommand(tokens: string[], cwd: string): ScanCommand {
  let targetPath = cwd;
  let config: string | undefined;
  let format: OutputFormat = "text";
  let failOn: FailOn = "error";
  let pathAssigned = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!isOptionToken(token)) {
      if (pathAssigned) {
        throw new CliUsageError(`Unexpected argument: ${token}.`);
      }

      targetPath = token;
      pathAssigned = true;
      continue;
    }

    if (token === "--config") {
      config = takeOptionValue(tokens, index, "--config");
      index += 1;
      continue;
    }

    if (token === "--format") {
      const value = takeOptionValue(tokens, index, "--format");

      if (!SCAN_FORMATS.has(value as OutputFormat)) {
        throw new CliUsageError(`Invalid --format value: ${value}. Expected text or json.`);
      }

      format = value as OutputFormat;
      index += 1;
      continue;
    }

    if (token === "--fail-on") {
      const value = takeOptionValue(tokens, index, "--fail-on");

      if (!FAIL_ON_VALUES.has(value as FailOn)) {
        throw new CliUsageError(
          `Invalid --fail-on value: ${value}. Expected error, warning, or off.`
        );
      }

      failOn = value as FailOn;
      index += 1;
      continue;
    }

    throw new CliUsageError(`Unknown option for scan: ${token}.`);
  }

  return {
    kind: "scan",
    path: targetPath,
    config,
    format,
    failOn
  };
}

function parseGraphCommand(tokens: string[], cwd: string): GraphCommand {
  let targetPath = cwd;
  let config: string | undefined;
  let out: string | undefined;
  let pathAssigned = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!isOptionToken(token)) {
      if (pathAssigned) {
        throw new CliUsageError(`Unexpected argument: ${token}.`);
      }

      targetPath = token;
      pathAssigned = true;
      continue;
    }

    if (token === "--config") {
      config = takeOptionValue(tokens, index, "--config");
      index += 1;
      continue;
    }

    if (token === "--out") {
      out = takeOptionValue(tokens, index, "--out");
      index += 1;
      continue;
    }

    throw new CliUsageError(`Unknown option for graph: ${token}.`);
  }

  if (out === undefined) {
    throw new CliUsageError("Missing required option --out for graph.");
  }

  return {
    kind: "graph",
    path: targetPath,
    config,
    out
  };
}

export function parseArgv(argv: string[], cwd: string = process.cwd()): ParsedCommand {
  if (argv.length === 0) {
    throw new CliUsageError("Missing command. Use --help to see available commands.");
  }

  const [command, ...tokens] = argv;

  if (command === "--help" || command === "-h") {
    return { kind: "help" };
  }

  if (command === "--version" || command === "-v") {
    return { kind: "version" };
  }

  if (command === "lint" || command === "scan") {
    return parseScanCommand(tokens, cwd);
  }

  if (command === "graph") {
    return parseGraphCommand(tokens, cwd);
  }

  throw new CliUsageError(`Unknown command: ${command}.`);
}

async function readPackageVersion(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.resolve(moduleDir, "../package.json");
  const packageJsonText = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonText) as { version?: string };

  return packageJson.version ?? "0.0.0";
}

export function resolveScanExitCode(params: {
  failOn: FailOn;
  result: AuditResult;
}): number {
  if (params.failOn === "off") {
    return EXIT_CODE_SUCCESS;
  }

  if (params.failOn === "warning") {
    return params.result.findings.length > 0 ? EXIT_CODE_RUNTIME_ERROR : EXIT_CODE_SUCCESS;
  }

  return params.result.summary.findings.error > 0 ? EXIT_CODE_RUNTIME_ERROR : EXIT_CODE_SUCCESS;
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

export async function executeCommand(command: ParsedCommand): Promise<CommandExecutionResult> {
  switch (command.kind) {
    case "help":
      return {
        output: `${HELP_TEXT}\n`,
        exitCode: EXIT_CODE_SUCCESS
      };
    case "version":
      return {
        output: `${await readPackageVersion()}\n`,
        exitCode: EXIT_CODE_SUCCESS
      };
    case "scan":
      return handleScan(command);
    case "graph":
      return handleGraph(command);
    default: {
      const exhaustiveCheck: never = command;
      return exhaustiveCheck;
    }
  }
}

export async function runCli(
  argv: string[],
  io: {
    cwd?: string;
    stdout?: Pick<NodeJS.WriteStream, "write">;
    stderr?: Pick<NodeJS.WriteStream, "write">;
  } = {}
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  try {
    const command = parseArgv(argv, io.cwd ?? process.cwd());
    const result = await executeCommand(command);
    stdout.write(result.output);
    return result.exitCode;
  } catch (error) {
    if (error instanceof CliUsageError || error instanceof ConfigError || error instanceof DiscoveryError) {
      stderr.write(`${error.message}\n`);
      return EXIT_CODE_USAGE_ERROR;
    }

    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Unexpected error: ${message}\n`);
    return EXIT_CODE_RUNTIME_ERROR;
  }
}

const invokedPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);

if (invokedPath !== undefined && path.resolve(invokedPath) === modulePath) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
