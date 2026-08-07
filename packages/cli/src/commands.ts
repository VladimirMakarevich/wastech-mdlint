import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyFixes,
  classifyImpact,
  compileContext,
  CompileConfigMissingError,
  computeGraphCoverage,
  FixWriteError,
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
  summarizeContextGraph,
  writeFileAtomic,
} from "@wastech-mdlint/core";
import type {
  CompileResult,
  ImpactClassification,
  LintMessage,
  LintResult,
} from "@wastech-mdlint/core";

import { createInquirerPrompter } from "./init-prompter.js";
import {
  runInitCommand,
  type ExistingConfigAction,
  type InitOutcome,
  type InitPrompter,
} from "./init-command.js";
import { formatWriteFailure, toWriteTargetPath } from "./operational-errors.js";

// Resolution order (P5.05): an explicit `--outdir` wins, then `config.compile.outdir`, then this
// fallback — matching the locked example path in docs/mdlint_v2/requirements/01-configuration.md.
const DEFAULT_COMPILE_OUTDIR = ".claude/skills/wastech-mdlint/";

// The whole exit-code taxonomy (roadmap §8), in one place because the distinction is load-bearing for
// CI: `1` means *the linter found problems*, `2` means *the command could not run*. `1` is therefore
// reserved exclusively for findings at or above `--fail-on` — an operational failure that reuses it
// leaves a CI job unable to tell a broken step from a failing document (P11.10, audit M-6), which is
// why the constant is named for findings rather than for a generic runtime error.
export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_FINDINGS = 1;
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
  // The io-seam working directory a relative `--out` resolves against. Required for the same reason
  // `compile` carries one: resolving against the real `process.cwd()` silently diverges from the
  // injected `cwd` whenever the two differ, so `schema --out schema.json` wrote outside the target
  // directory (audit L-11).
  cwd: string;
  out: string;
};

export type CompileCommand = {
  kind: "compile";
  cwd: string;
  config?: string;
  outdir?: string;
  dryRun: boolean;
};

export type InitCommand = {
  kind: "init";
  cwd: string;
  yes: boolean;
  onExisting?: ExistingConfigAction;
  isTty: boolean;
  withCiWorkflow?: boolean;
  // Whether the CLI's `[path]` argument was actually typed (vs. omitted and defaulted to cwd) —
  // see `InitCommandOptions.pathWasExplicit` for why this must be known this far down (H-3, P11.04).
  pathWasExplicit: boolean;
};

export type CliCommand =
  | LintCommand
  | GraphCommand
  | SliceCommand
  | ImpactCommand
  | SchemaCommand
  | CompileCommand
  | InitCommand;

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

// The only producer of EXIT_CODE_FINDINGS. Operational failures are thrown (as ConfigError,
// CliUsageError, or a bare fs error) and mapped to 2 in program.ts.
export function resolveLintExitCode(params: {
  failOn: FailOn;
  result: LintResult;
}): number {
  if (params.failOn === "off") {
    return EXIT_CODE_SUCCESS;
  }

  if (params.failOn === "warning") {
    return params.result.errorCount + params.result.warningCount > 0
      ? EXIT_CODE_FINDINGS
      : EXIT_CODE_SUCCESS;
  }

  return params.result.errorCount > 0 ? EXIT_CODE_FINDINGS : EXIT_CODE_SUCCESS;
}

async function handleLint(
  command: LintCommand,
): Promise<CommandExecutionResult> {
  const loaded = await loadConfiguration({
    cwd: command.path,
    explicitConfigPath: command.config,
  });

  // ESLint-style --fix (audit 4.2): apply deterministic fixes in place, then re-lint the result.
  if (command.fix) {
    try {
      await applyFixes({
        cwd: command.path,
        config: loaded.config,
        rules: loaded.rules,
        settings: loaded.settings,
      });
    } catch (error) {
      // FixWriteError already names the unwritable file, the files that were fixed, and that the
      // failed one is unchanged; re-throw as CliUsageError so program.ts maps it to exit 2 (an
      // operational failure) instead of a bare stack trace — same precedent as handleImpact/handleCompile.
      if (error instanceof FixWriteError) {
        throw new CliUsageError(error.message);
      }
      throw error;
    }
  }

  const result = await lintFiles({
    cwd: command.path,
    config: loaded.config,
    rules: loaded.rules,
    settings: loaded.settings,
  });
  const output =
    command.format === "json"
      ? formatLintResultJson(result)
      : formatLintResultText(result);

  return {
    output,
    exitCode: resolveLintExitCode({ failOn: command.failOn, result }),
  };
}

// `graph`/`slice`/`impact` (P4.07) are thin hosts over the P4 core graph modules: this file only
// picks a format and shapes stdout, all traversal/analysis/rendering lives in `@wastech-mdlint/core`.
async function handleGraph(
  command: GraphCommand,
): Promise<CommandExecutionResult> {
  const loaded = await loadConfiguration({
    cwd: command.path,
    explicitConfigPath: command.config,
  });
  const { documents, graph } = await loadContext({
    cwd: command.path,
    config: loaded.config,
    settings: loaded.settings,
  });

  // The G5 coverage signal is shared by the JSON and human formats (audit B): JSON consumers (CI,
  // agents) must see `filesOutsideCorpus` too, not just the human reader. The MCP `context-graph`
  // tool now makes this same call for its own `summary` branch (P15.02/W-22) rather than depending on
  // this host. Computed lazily via a closure so both call sites can't drift on rootDir/siteRouter and
  // mermaid/dot skip the work.
  const coverage = () =>
    computeGraphCoverage(documents, graph, {
      rootDir: path.resolve(command.path),
      siteRouter: loaded.settings.siteRouter,
    });

  if (command.format === "json") {
    return {
      output: `${JSON.stringify(summarizeContextGraph(graph, coverage()), null, 2)}\n`,
      exitCode: EXIT_CODE_SUCCESS,
    };
  }
  if (command.format === "mermaid") {
    return {
      output: `${renderContextGraphMermaid(graph)}\n`,
      exitCode: EXIT_CODE_SUCCESS,
    };
  }
  if (command.format === "dot") {
    return {
      output: `${renderContextGraphDot(graph)}\n`,
      exitCode: EXIT_CODE_SUCCESS,
    };
  }

  return {
    output: `${renderContextGraphText(graph, coverage())}\n`,
    exitCode: EXIT_CODE_SUCCESS,
  };
}

async function handleSlice(
  command: SliceCommand,
): Promise<CommandExecutionResult> {
  const loaded = await loadConfiguration({
    cwd: command.path,
    explicitConfigPath: command.config,
  });
  const { documents, graph } = await loadContext({
    cwd: command.path,
    config: loaded.config,
    settings: loaded.settings,
  });

  // An unresolved query is a legitimate answer (G4 honesty), not a usage error — `getContextSlice`
  // already returns an empty result rather than throwing, so this command always exits 0.
  const result = getContextSlice(
    graph,
    documents,
    command.query,
    command.depth,
    loaded.settings.idRef,
  );

  const output =
    command.format === "json"
      ? `${JSON.stringify(result, null, 2)}\n`
      : `${renderContextSliceSummary(result)}\n`;

  return { output, exitCode: EXIT_CODE_SUCCESS };
}

// Filters a full-corpus `LintResult` down to the affected-file set. This is host-side presentation,
// not a re-implemented lint pipeline: `impact` must still lint against the *full* graph so GRP rules
// (cycle/orphan detection) see the whole corpus, and only the reported messages/files are narrowed.
function filterLintResult(
  result: LintResult,
  affectedFiles: ReadonlySet<string>,
): LintResult {
  const messages: LintMessage[] = result.messages.filter((message) =>
    affectedFiles.has(message.filePath),
  );
  const files = result.files.filter((file) => affectedFiles.has(file));
  return {
    messages,
    files,
    errorCount: messages.filter((message) => message.severity === "error")
      .length,
    warningCount: messages.filter((message) => message.severity === "warning")
      .length,
  };
}

async function handleImpact(
  command: ImpactCommand,
): Promise<CommandExecutionResult> {
  const loaded = await loadConfiguration({
    cwd: command.path,
    explicitConfigPath: command.config,
  });
  const { graph } = await loadContext({
    cwd: command.path,
    config: loaded.config,
    settings: loaded.settings,
  });

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
    ...classification.transitivelyAffected.map((entry) => entry.path),
  ]);

  // Inject the graph already built above so lintFiles doesn't rebuild it a second time, and GRP
  // rules see the same full-corpus graph the impact analysis just ran against.
  const fullLintResult = await lintFiles({
    cwd: command.path,
    config: loaded.config,
    rules: loaded.rules,
    settings: loaded.settings,
    graph,
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
      lint,
    };
    return {
      output: `${JSON.stringify(payload, null, 2)}\n`,
      exitCode: EXIT_CODE_SUCCESS,
    };
  }

  const output = `${renderImpactSummary(classification)}\n\n${formatLintResultText(lint)}`;
  return { output, exitCode: EXIT_CODE_SUCCESS };
}

async function handleSchema(
  command: SchemaCommand,
): Promise<CommandExecutionResult> {
  // Resolved against the command's own `cwd`, mirroring `handleCompile`'s `--outdir` handling below:
  // an absolute `--out` is unaffected, and a relative one now lands where the caller is standing.
  const outputPath = path.resolve(command.cwd, command.out);
  const outputStats = await stat(outputPath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });

  if (outputStats?.isDirectory()) {
    throw new CliUsageError(
      `Cannot write schema output to directory path: ${command.out}`,
    );
  }

  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFileAtomic(outputPath, generateConfigSchema());
  } catch (error) {
    // An unwritable destination is an operational failure, not a crash: convert it here so the user
    // sees the path they typed plus the errno instead of a raw fs message carrying the staged temp
    // file's random name (P11.10). `command.out` is echoed as typed — matching the success line and
    // the directory guard above, and the documented exception to naming error paths relative to the
    // working directory (docs/guide/cli.md §Exit codes): an argument the caller chose to spell
    // absolutely is theirs, not ours to rewrite.
    throw new CliUsageError(formatWriteFailure(command.out, error));
  }

  return {
    output: `schema written to ${command.out}\n`,
    exitCode: EXIT_CODE_SUCCESS,
  };
}

// `compile` (P5.05): core owns generation (`compileContext`); this handler only resolves `outdir`
// and does the file I/O, matching the core-hosts-the-pipeline decision.
async function handleCompile(
  command: CompileCommand,
): Promise<CommandExecutionResult> {
  // `--config` is forwarded as typed: core resolves a relative one against the `cwd` below, the same
  // base every other handler gets (P14.04). This handler used to pre-resolve it, back when core
  // resolved against `process.cwd()` instead and `compile`'s named `--cwd` made the divergence
  // reachable from an ordinary invocation.
  const loaded = await loadConfiguration({
    cwd: command.cwd,
    explicitConfigPath: command.config,
  });

  let result: CompileResult;
  try {
    result = await compileContext(loaded, command.cwd);
  } catch (error) {
    // CompileConfigMissingError already carries a guidance hint; re-throw as CliUsageError so
    // program.ts's existing catch block maps it to exit 2 instead of a bare stack trace.
    if (error instanceof CompileConfigMissingError) {
      throw new CliUsageError(error.message);
    }
    throw error;
  }

  if (command.dryRun) {
    return { output: result.skillContent, exitCode: EXIT_CODE_SUCCESS };
  }

  const outdirSetting =
    command.outdir ?? loaded.config.compile?.outdir ?? DEFAULT_COMPILE_OUTDIR;
  const resolvedOutdir = path.resolve(command.cwd, outdirSetting);
  const outputPath = path.join(resolvedOutdir, "SKILL.md");

  // Repository-relative POSIX path in user-visible output (invariant) while the target is inside
  // `--cwd`, and the absolute path once it is not — an `--outdir` above the repository rendered as a
  // chain of `../..` hops nobody can read (P14.02, W-17). Computed before the write so a failure can
  // name the same path the success line would have (P11.10).
  const outputPathForUser = toWriteTargetPath(command.cwd, outputPath);

  try {
    await mkdir(resolvedOutdir, { recursive: true });
    await writeFileAtomic(outputPath, result.skillContent);
  } catch (error) {
    throw new CliUsageError(formatWriteFailure(outputPathForUser, error));
  }

  return {
    output: `SKILL.md written to ${outputPathForUser}\n`,
    exitCode: EXIT_CODE_SUCCESS,
  };
}

// The exit code for each way `init` can end. A switch rather than a predicate so the `never` check
// makes a newly added outcome a *compile* error until someone decides which side of the taxonomy it
// falls on — the distinction is the deliverable of P14.02, and the previous boolean got it wrong for
// `invalid-existing-config` precisely because nobody had to state an answer.
//
// The dividing question is not "was anything written" — four of these six write nothing. It is
// whether *the user asked for* no write (`skip`, declining the draft: exit 0) or the command could
// not do what they asked (an unloadable file to merge into, a failed write: exit 2, W-13).
function initExitCode(outcome: InitOutcome): number {
  switch (outcome) {
    case "written":
    case "skipped":
    case "declined":
      return EXIT_CODE_SUCCESS;
    case "invalid-existing-config":
    case "write-failed":
    case "ci-workflow-write-failed":
      return EXIT_CODE_USAGE_ERROR;
    default: {
      const exhaustiveCheck: never = outcome;
      return exhaustiveCheck;
    }
  }
}

// `init` (P6.04): core generates the config bytes; `runInitCommand` performs the writes. Its output is
// informational on every path (draft / write / abort / partial-write summary) and always goes to
// stdout, including on a failure (P11.09) — only the exit code, via `initExitCode` above, says which
// kind of ending it was.
async function handleInit(
  command: InitCommand,
  prompter: InitPrompter,
): Promise<CommandExecutionResult> {
  const { output, outcome } = await runInitCommand(
    {
      cwd: command.cwd,
      yes: command.yes,
      onExisting: command.onExisting,
      isTty: command.isTty,
      withCiWorkflow: command.withCiWorkflow,
      pathWasExplicit: command.pathWasExplicit,
    },
    prompter,
  );
  return { output, exitCode: initExitCode(outcome) };
}

export async function executeCommand(
  command: CliCommand,
  deps?: { prompter?: InitPrompter },
): Promise<CommandExecutionResult> {
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
    case "compile":
      return handleCompile(command);
    case "init":
      return handleInit(command, deps?.prompter ?? createInquirerPrompter());
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
