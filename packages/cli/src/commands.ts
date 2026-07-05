import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyFixes,
  classifyImpact,
  computeGraphCoverage,
  formatLintResultJson,
  formatLintResultText,
  generateConfigSchema,
  getContextSlice,
  ImpactAnalysisError,
  lintFiles,
  loadConfiguration,
  loadContext,
  renderContextGraphDot,
  renderContextGraphMermaid,
  renderContextGraphText,
  renderContextSliceSummary,
  renderImpactSummary,
  summarizeContextGraph
} from "@wastech-mdlint/core";
import type { ImpactClassification, LintMessage, LintResult } from "@wastech-mdlint/core";

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

export type GraphFormat = "human" | "json" | "mermaid" | "dot";

export type GraphCommand = {
  kind: "graph";
  path: string;
  config?: string;
  format: GraphFormat;
};

export type SliceCommand = {
  kind: "slice";
  path: string;
  config?: string;
  query: string;
  depth: number;
  format: OutputFormat;
};

export type ImpactCommand = {
  kind: "impact";
  path: string;
  config?: string;
  file: string;
  format: OutputFormat;
};

export type SchemaCommand = {
  kind: "schema";
  out: string;
};

export type CliCommand = LintCommand | GraphCommand | SliceCommand | ImpactCommand | SchemaCommand;

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

// `graph`/`slice`/`impact` (P4.07) are thin hosts over the P4 core graph modules: this file only
// picks a format and shapes stdout, all traversal/analysis/rendering lives in `@wastech-mdlint/core`.
async function handleGraph(command: GraphCommand): Promise<CommandExecutionResult> {
  const loaded = await loadConfiguration({ cwd: command.path, explicitConfigPath: command.config });
  const { documents, graph } = await loadContext({
    cwd: command.path,
    config: loaded.config,
    settings: loaded.settings
  });

  // The G5 coverage signal is shared by the JSON and human formats (audit B): JSON consumers (CI,
  // MCP, agents) must see `filesOutsideCorpus` too, not just the human reader. Computed lazily via a
  // closure so both call sites can't drift on rootDir/siteRouter and mermaid/dot skip the work.
  const coverage = () =>
    computeGraphCoverage(documents, graph, {
      rootDir: path.resolve(command.path),
      siteRouter: loaded.settings.siteRouter
    });

  if (command.format === "json") {
    return {
      output: `${JSON.stringify(summarizeContextGraph(graph, coverage()), null, 2)}\n`,
      exitCode: EXIT_CODE_SUCCESS
    };
  }
  if (command.format === "mermaid") {
    return { output: `${renderContextGraphMermaid(graph)}\n`, exitCode: EXIT_CODE_SUCCESS };
  }
  if (command.format === "dot") {
    return { output: `${renderContextGraphDot(graph)}\n`, exitCode: EXIT_CODE_SUCCESS };
  }

  return { output: `${renderContextGraphText(graph, coverage())}\n`, exitCode: EXIT_CODE_SUCCESS };
}

async function handleSlice(command: SliceCommand): Promise<CommandExecutionResult> {
  const loaded = await loadConfiguration({ cwd: command.path, explicitConfigPath: command.config });
  const { documents, graph } = await loadContext({
    cwd: command.path,
    config: loaded.config,
    settings: loaded.settings
  });

  // An unresolved query is a legitimate answer (G4 honesty), not a usage error — `getContextSlice`
  // already returns an empty result rather than throwing, so this command always exits 0.
  const result = getContextSlice(graph, documents, command.query, command.depth, loaded.settings.idRef);

  const output =
    command.format === "json" ? `${JSON.stringify(result, null, 2)}\n` : `${renderContextSliceSummary(result)}\n`;

  return { output, exitCode: EXIT_CODE_SUCCESS };
}

// Filters a full-corpus `LintResult` down to the affected-file set. This is host-side presentation,
// not a re-implemented lint pipeline: `impact` must still lint against the *full* graph so GRP rules
// (cycle/orphan detection) see the whole corpus, and only the reported messages/files are narrowed.
function filterLintResult(result: LintResult, affectedFiles: ReadonlySet<string>): LintResult {
  const messages: LintMessage[] = result.messages.filter((message) => affectedFiles.has(message.filePath));
  const files = result.files.filter((file) => affectedFiles.has(file));
  return {
    messages,
    files,
    errorCount: messages.filter((message) => message.severity === "error").length,
    warningCount: messages.filter((message) => message.severity === "warning").length
  };
}

async function handleImpact(command: ImpactCommand): Promise<CommandExecutionResult> {
  const loaded = await loadConfiguration({ cwd: command.path, explicitConfigPath: command.config });
  const { graph } = await loadContext({ cwd: command.path, config: loaded.config, settings: loaded.settings });

  let classification: ImpactClassification;
  try {
    classification = classifyImpact(graph, command.file);
  } catch (error) {
    // ImpactAnalysisError already carries the corpus-relative-path hint; re-throw as CliUsageError so
    // program.ts's existing catch block maps it to exit 2 instead of a bare stack trace.
    if (error instanceof ImpactAnalysisError) {
      throw new CliUsageError(error.message);
    }
    throw error;
  }

  const affectedFiles = new Set<string>([
    classification.file,
    ...classification.directlyAffected.map((entry) => entry.path),
    ...classification.transitivelyAffected.map((entry) => entry.path)
  ]);

  // Inject the graph already built above so lintFiles doesn't rebuild it a second time, and GRP
  // rules see the same full-corpus graph the impact analysis just ran against.
  const fullLintResult = await lintFiles({
    cwd: command.path,
    config: loaded.config,
    rules: loaded.rules,
    settings: loaded.settings,
    graph
  });
  const lint = filterLintResult(fullLintResult, affectedFiles);

  if (command.format === "json") {
    const payload = {
      changedFile: classification.file,
      directlyAffected: classification.directlyAffected,
      transitivelyAffected: classification.transitivelyAffected,
      readingOrder: classification.readingOrder,
      // Parity with the human render (audit C): without `excluded`, a JSON consumer sees a
      // readingOrder shorter than the affected set with no signal that a cycle dropped those nodes.
      excluded: classification.excluded,
      lint
    };
    return { output: `${JSON.stringify(payload, null, 2)}\n`, exitCode: EXIT_CODE_SUCCESS };
  }

  const output = `${renderImpactSummary(classification)}\n\n${formatLintResultText(lint)}`;
  return { output, exitCode: EXIT_CODE_SUCCESS };
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
    case "slice":
      return handleSlice(command);
    case "impact":
      return handleImpact(command);
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
