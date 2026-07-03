import { Command, CommanderError, Option } from "commander";

import { ConfigError, DiscoveryError } from "@wastech-mdlint/core";

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
    // exitOverride() + configureOutput() must run before .command() creates the scan/graph
    // subcommands: commander only copies output/exit settings onto a subcommand at the moment
    // it's created, so subcommands built beforehand would keep writing to the real process
    // streams and calling process.exit, breaking test isolation and IO injection.
    .exitOverride()
    .configureOutput({
      writeOut: (text) => stdout.write(text),
      writeErr: (text) => stderr.write(text)
    });

  program.version(await readPackageVersion(), "-v, --version");

  program
    .command("scan")
    .description("Analyze Markdown files in a directory.")
    // Defaulting to the injected cwd here (not process.cwd()) keeps `scan` with no path argument
    // testable: fixture-driven tests pass a temp directory via io.cwd instead of the real cwd.
    .argument("[path]", "directory to scan", cwd)
    .addOption(new Option("--config <file>", "path to a config file"))
    .addOption(
      new Option("--format <format>", "output format").choices(OUTPUT_FORMATS).default("text")
    )
    .addOption(
      new Option("--fail-on <level>", "minimum severity that causes a non-zero exit code")
        .choices(FAIL_ON_LEVELS)
        .default("error")
    )
    .action(
      async (
        targetPath: string,
        options: { config?: string; format: OutputFormat; failOn: FailOn }
      ) => {
        executionResult = await executeCommand({
          kind: "scan",
          path: targetPath,
          config: options.config,
          format: options.format,
          failOn: options.failOn
        });
      }
    );

  program
    .command("graph")
    .description("Write the Markdown dependency graph to a JSON file.")
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
    if (argv.length === 0) {
      // Commander silently no-ops on zero subcommand args; the pre-commander CLI treated a
      // missing command as a usage error, so preserve that instead of exiting 0 with no output.
      program.outputHelp();
      return EXIT_CODE_USAGE_ERROR;
    }

    await program.parseAsync(argv, { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander reserves exitCode 0 for --help/--version; every other CommanderError (unknown
      // command/option, invalid choice, missing required option) is a parse/usage failure, which
      // this CLI has always reported as EXIT_CODE_USAGE_ERROR (2) rather than commander's own 1.
      return error.exitCode === EXIT_CODE_SUCCESS ? EXIT_CODE_SUCCESS : EXIT_CODE_USAGE_ERROR;
    }

    if (
      error instanceof CliUsageError ||
      error instanceof ConfigError ||
      error instanceof DiscoveryError
    ) {
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
