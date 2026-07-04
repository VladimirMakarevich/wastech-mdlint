import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyFixes,
  buildContextGraph,
  formatLintResultJson,
  formatLintResultText,
  generateConfigSchema,
  lintFiles,
  loadConfiguration,
  loadDocuments
} from "@wastech-mdlint/core";
import type { LintResult, ParsedDocument } from "@wastech-mdlint/core";

export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_RUNTIME_ERROR = 1;
export const EXIT_CODE_USAGE_ERROR = 2;

export type OutputFormat = "text" | "json";
export type FailOn = "error" | "warning" | "off";

// The v2 lint command (D4). `scan` is a hidden alias that dispatches to this same kind.
export type LintCommand = {
  kind: "lint";
  path: string;
  config?: string;
  format: OutputFormat;
  failOn: FailOn;
  fix: boolean;
};

export type GraphCommand = {
  kind: "graph";
  path: string;
  config?: string;
  out: string;
};

export type SchemaCommand = {
  kind: "schema";
  out: string;
};

export type CliCommand = LintCommand | GraphCommand | SchemaCommand;

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
  const loaded = await loadConfiguration({ cwd: command.path, explicitConfigPath: command.config });

  // ESLint-style --fix (audit 4.2): apply deterministic fixes in place, then re-lint the result.
  if (command.fix) {
    await applyFixes({
      cwd: command.path,
      config: loaded.config,
      rules: loaded.rules,
      settings: loaded.settings
    });
  }

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

// The graph command now runs on the v2 config + ContextGraph (post-cutover). The rich graph/slice/
// impact CLI arrives in P4; this keeps `graph` working over the new pipeline in the meantime.
async function handleGraph(command: GraphCommand): Promise<CommandExecutionResult> {
  const loaded = await loadConfiguration({ cwd: command.path, explicitConfigPath: command.config });
  const documents = await loadDocuments(loaded.config.include ?? ["**/*.md"], {
    cwd: command.path,
    exclude: loaded.config.exclude,
    respectGitignore: loaded.config.respectGitignore
  });

  const byRelPath = new Map<string, ParsedDocument>();
  for (const document of documents.values()) {
    byRelPath.set(document.path, document);
  }
  const graph = buildContextGraph(byRelPath, { siteRouter: loaded.settings.siteRouter });

  const outputPath = path.resolve(command.out);
  const outputStats = await stat(outputPath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (outputStats?.isDirectory()) {
    throw new CliUsageError(`Cannot write graph output to directory path: ${command.out}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ root: command.path, configPath: loaded.configPath ?? null, graph }, null, 2)}\n`,
    "utf8"
  );

  return { output: `graph written to ${command.out}\n`, exitCode: EXIT_CODE_SUCCESS };
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

export async function executeCommand(command: CliCommand): Promise<CommandExecutionResult> {
  switch (command.kind) {
    case "lint":
      return handleLint(command);
    case "graph":
      return handleGraph(command);
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
