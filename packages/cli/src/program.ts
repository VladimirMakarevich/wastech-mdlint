import { Command, CommanderError, Option } from "commander";

import { ConfigError } from "@wastech-mdlint/core";

import {
  CliUsageError,
  EXIT_CODE_RUNTIME_ERROR,
  EXIT_CODE_SUCCESS,
  EXIT_CODE_USAGE_ERROR,
  executeCommand,
  readPackageVersion,
  type CommandExecutionResult,
  type FailOn,
  type OutputFormat
} from "./commands.js";

export type CliIo = {
  cwd?: string;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
};

const OUTPUT_FORMATS: OutputFormat[] = ["text", "json"];
const FAIL_ON_LEVELS: FailOn[] = ["error", "warning", "off"];

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
    .description("Write the Markdown context graph to a JSON file.")
    .argument("[path]", "directory to scan", cwd)
    .addOption(new Option("--config <file>", "path to a config file"))
    .requiredOption("--out <file>", "graph output file")
    .action(async (targetPath: string, options: { config?: string; out: string }) => {
      executionResult = await executeCommand({
        kind: "graph",
        path: targetPath,
        config: options.config,
        out: options.out
      });
    });

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
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
