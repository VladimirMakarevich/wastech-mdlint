import path from "node:path";

import { Command, CommanderError, InvalidArgumentError, Option } from "commander";

import { ConfigError, SLICE_RESOLUTION_DESCRIPTION } from "@wastech-mdlint/core";

import {
  CliUsageError,
  EXIT_CODE_RUNTIME_ERROR,
  EXIT_CODE_SUCCESS,
  EXIT_CODE_USAGE_ERROR,
  executeCommand,
  readPackageVersion,
  type CommandExecutionResult,
  type FailOn,
  type GraphFormat,
  type OutputFormat
} from "./commands.js";
import type { ExistingConfigAction, InitPrompter } from "./init-command.js";
import { createInquirerPrompter } from "./init-prompter.js";

export type CliIo = {
  cwd?: string;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  // Test-injection seams for `init` (mirrors the stdout/stderr/cwd seam above): a fake prompter
  // avoids driving real `@inquirer/prompts` TTY rendering in tests. `isTty` overrides the whole
  // interactive-terminal gate below at once (both stdin and stdout); `stdinIsTty`/`stdoutIsTty`
  // override just one side of it, so a test can simulate a stdin TTY paired with piped/redirected
  // stdout (or vice versa) without faking the real global `process.stdin`/`process.stdout`. Only
  // consulted when `isTty` itself is not set.
  initPrompter?: InitPrompter;
  isTty?: boolean;
  stdinIsTty?: boolean;
  stdoutIsTty?: boolean;
};

const OUTPUT_FORMATS: OutputFormat[] = ["text", "json"];
const FAIL_ON_LEVELS: FailOn[] = ["error", "warning", "off"];
const GRAPH_FORMATS: GraphFormat[] = ["human", "json", "mermaid", "dot"];
const EXISTING_CONFIG_ACTIONS: ExistingConfigAction[] = ["overwrite", "merge", "skip"];

// Shared by `slice`'s `--depth`: reject non-integers/negatives at parse time (exit 2) rather than
// letting a bad value reach `getContextSlice` and produce a confusing traversal result.
function parseDepth(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("--depth must be a non-negative integer.");
  }
  return parsed;
}

export async function runCli(argv: string[], io: CliIo = {}): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cwd = io.cwd ?? process.cwd();

  let executionResult: CommandExecutionResult | undefined;

  const program = new Command()
    .name("wastech-mdlint")
    // exitOverride() + configureOutput() must run before .command() creates subcommands: commander
    // only copies output/exit settings onto a subcommand at the moment it's created, so subcommands
    // built beforehand would keep writing to the real process streams / calling process.exit.
    .exitOverride()
    .configureOutput({
      writeOut: (text) => stdout.write(text),
      writeErr: (text) => stderr.write(text)
    });

  program.version(await readPackageVersion(), "-v, --version");

  const lintAction = async (
    targetPath: string,
    options: { config?: string; format: OutputFormat; failOn: FailOn; fix?: boolean }
  ): Promise<void> => {
    executionResult = await executeCommand({
      kind: "lint",
      path: targetPath,
      config: options.config,
      format: options.format,
      failOn: options.failOn,
      fix: options.fix ?? false
    });
  };

  // Register the shared lint options on a command (used by both `lint` and its hidden `scan` alias).
  const addLintCommand = (name: string, hidden: boolean, isDefault: boolean): void => {
    program
      .command(name, { hidden, isDefault })
      .description("Lint Markdown files with the rule engine.")
      .argument("[path]", "directory to lint", cwd)
      .addOption(new Option("--config <file>", "path to a config file"))
      .addOption(new Option("--format <format>", "output format").choices(OUTPUT_FORMATS).default("text"))
      .addOption(
        new Option("--fail-on <level>", "minimum severity that causes a non-zero exit code")
          .choices(FAIL_ON_LEVELS)
          .default("error")
      )
      .addOption(new Option("--fix", "apply deterministic fixes in place, then report what remains"))
      .action(lintAction);
  };

  // `lint` is the default command (D4); `scan` is a hidden, deprecated alias for one minor version.
  addLintCommand("lint", false, true);
  addLintCommand("scan", true, false);

  program
    .command("schema")
    .description("Write the config JSON schema to a local file (no remote URL).")
    .addOption(new Option("--out <file>", "schema output file").default("schema.json"))
    .action(async (options: { out: string }) => {
      executionResult = await executeCommand({ kind: "schema", out: options.out });
    });

  program
    .command("graph")
    .description("Build and summarize the Markdown context graph (clusters, hubs, reading order, coverage).")
    .argument("[path]", "directory to scan", cwd)
    .addOption(new Option("--config <file>", "path to a config file"))
    .addOption(new Option("--format <format>", "output format").choices(GRAPH_FORMATS).default("human"))
    .action(async (targetPath: string, options: { config?: string; format: GraphFormat }) => {
      executionResult = await executeCommand({
        kind: "graph",
        path: targetPath,
        config: options.config,
        format: options.format
      });
    });

  program
    .command("slice")
    .description(`Print the files reachable from a query within --depth hops. ${SLICE_RESOLUTION_DESCRIPTION}`)
    .argument("<query>", "an ID, a heading/anchor slug (#slug), or a file path")
    .addOption(new Option("--config <file>", "path to a config file"))
    .addOption(new Option("--depth <n>", "traversal depth").default(2).argParser(parseDepth))
    .addOption(new Option("--format <format>", "output format").choices(OUTPUT_FORMATS).default("text"))
    .action(async (query: string, options: { config?: string; depth: number; format: OutputFormat }) => {
      executionResult = await executeCommand({
        kind: "slice",
        path: cwd,
        config: options.config,
        query,
        depth: options.depth,
        format: options.format
      });
    });

  program
    .command("impact")
    .description("Classify the blast radius of changing <file> and lint the affected subgraph.")
    .argument("<file>", "repository-relative path of the changed file")
    .addOption(new Option("--config <file>", "path to a config file"))
    .addOption(new Option("--format <format>", "output format").choices(OUTPUT_FORMATS).default("text"))
    .action(async (file: string, options: { config?: string; format: OutputFormat }) => {
      executionResult = await executeCommand({
        kind: "impact",
        path: cwd,
        config: options.config,
        file,
        format: options.format
      });
    });

  program
    .command("compile")
    .description("Generate a deterministic SKILL.md from the document graph, rules, and config.")
    .addOption(new Option("--config <file>", "path to a config file"))
    .addOption(new Option("--outdir <dir>", "directory to write SKILL.md into"))
    .addOption(new Option("--dry-run", "print the generated SKILL.md without writing it"))
    .addOption(new Option("--cwd <dir>", "working directory to compile from").default(cwd))
    .action(async (options: { config?: string; outdir?: string; dryRun?: boolean; cwd: string }) => {
      executionResult = await executeCommand({
        kind: "compile",
        cwd: options.cwd,
        config: options.config,
        outdir: options.outdir,
        dryRun: options.dryRun ?? false
      });
    });

  program
    .command("init")
    .description("Scan the repo, infer a rule set, and preview a wastech-mdlint.config.json draft.")
    .argument("[path]", "directory to scan", cwd)
    .addOption(new Option("-y, --yes", "accept the inferred draft without prompts"))
    .addOption(
      new Option("--on-existing <mode>", "how to handle an existing config under --yes").choices(
        EXISTING_CONFIG_ACTIONS
      )
    )
    .action(async (targetPath: string, options: { yes?: boolean; onExisting?: ExistingConfigAction }) => {
      const yes = options.yes ?? false;
      // Both streams must be real terminals: `@inquirer/prompts` reads from stdin and renders to
      // stdout, so a piped/redirected stdout with a TTY stdin (or vice versa) is just as
      // unusable interactively as neither being one.
      const isTty =
        io.isTty ??
        ((io.stdinIsTty ?? process.stdin.isTTY === true) && (io.stdoutIsTty ?? process.stdout.isTTY === true));

      // Cheap, important: without this, a piped/CI invocation that forgot --yes would otherwise
      // hang forever on the first inquirer prompt instead of failing fast.
      if (!yes && !isTty) {
        throw new CliUsageError("init requires an interactive terminal; pass --yes for non-interactive/CI use.");
      }

      // `targetPath` may be a relative argument like "." or "docs"; resolve it against this run's
      // own `cwd` (the injected `io.cwd`, when set) rather than letting `findConfig`/
      // `scanRepository` fall back to the real `process.cwd()` inside core.
      const resolvedCwd = path.resolve(cwd, targetPath);

      // Construct the real prompter here (not inside commands.ts) so its `confirmDraft` writes
      // through this run's own `stdout` seam instead of the real `process.stdout` — the same
      // stream every other command already writes its output through.
      executionResult = await executeCommand(
        { kind: "init", cwd: resolvedCwd, yes, onExisting: options.onExisting, isTty },
        { prompter: io.initPrompter ?? createInquirerPrompter(stdout) }
      );
    });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    // Ctrl+C during any inquirer prompt (matched on `.name`, not `instanceof` a specific imported
    // class — @inquirer/prompts' own docs recommend this as the version-stable detection) exits
    // gracefully rather than surfacing as an unexpected-error stack trace.
    if (error instanceof Error && error.name === "ExitPromptError") {
      return EXIT_CODE_SUCCESS;
    }

    if (error instanceof CommanderError) {
      // Commander reserves exitCode 0 for --help/--version; every other CommanderError (unknown
      // command/option, invalid choice, missing required option) is a parse/usage failure, reported
      // as EXIT_CODE_USAGE_ERROR (2) rather than commander's own 1.
      return error.exitCode === EXIT_CODE_SUCCESS ? EXIT_CODE_SUCCESS : EXIT_CODE_USAGE_ERROR;
    }

    if (error instanceof CliUsageError || error instanceof ConfigError) {
      stderr.write(`${error.message}\n`);
      return EXIT_CODE_USAGE_ERROR;
    }

    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Unexpected error: ${message}\n`);
    return EXIT_CODE_RUNTIME_ERROR;
  }

  if (executionResult === undefined) {
    // --help / --version resolve entirely inside commander without an action ever running.
    return EXIT_CODE_SUCCESS;
  }

  stdout.write(executionResult.output);
  return executionResult.exitCode;
}
