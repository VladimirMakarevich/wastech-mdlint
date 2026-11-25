#!/usr/bin/env node

import { stat } from "node:fs/promises";
import os from "node:os";

import { isStructuredError } from "@wastech-mdlint/core";

import { parseCliArgs, USAGE } from "./cli-args.js";
import { isLoopbackHost } from "./security.js";
import { startViewer } from "./server.js";

// This file is the bin and nothing imports it, so it runs unconditionally. The CLI package needs an
// entrypoint guard because its modules are also imported by tests; here everything testable lives in
// the other modules.

const EXIT_USAGE = 2;

const args = parseCliArgs(process.argv.slice(2));

if (args.kind === "help") {
  process.stdout.write(USAGE);
} else if (args.kind === "error") {
  process.stderr.write(`wastech-mdlint-viewer: ${args.message}\n\n${USAGE}`);
  process.exitCode = EXIT_USAGE;
} else if (
  (await stat(args.cwd).catch(() => undefined))?.isDirectory() !== true
) {
  // Checked here, with the path as the user typed it, because the error the loader would throw
  // instead names the absolute path and reads as a crash rather than a typo.
  process.stderr.write(`wastech-mdlint-viewer: not a directory: ${args.cwd}\n`);
  process.exitCode = EXIT_USAGE;
} else {
  try {
    // Loading parses the whole corpus and takes seconds on a large repository; without this line
    // the terminal shows nothing until the address appears.
    process.stdout.write("wastech-mdlint-viewer: loading documents…\n");
    const viewer = await startViewer(args);
    process.stdout.write(
      `wastech-mdlint-viewer: ${viewer.documentCount} documents at ${viewer.url}\n`,
    );
    // On stderr, like any problem: nothing is wrong with the viewer, but something the user asked
    // for (a `--base`, say) cannot be done as asked.
    for (const notice of viewer.notices) {
      process.stderr.write(`wastech-mdlint-viewer: ${notice}\n`);
    }
    if (args.allowConfigWrites) {
      process.stdout.write(
        "wastech-mdlint-viewer: the config page can save changes to the config file.\n",
      );
    }
    if (!isLoopbackHost(args.host)) {
      process.stdout.write(
        `wastech-mdlint-viewer: bound to ${args.host}, so other machines on the network can read these documents.\n`,
      );
    }
    let closing = false;
    const shutdown = (signal: NodeJS.Signals) => {
      // A second signal while closing quits at once, with the code a shell gives a process that
      // signal ended: 128 plus its number, 130 for Ctrl+C and 143 for a SIGTERM. Closing waits for
      // the git and lint work already running, and a git that hangs - on a network file system, a
      // lock, a credential prompt it was told not to show - would otherwise leave the terminal with
      // no way to stop the viewer but killing it from elsewhere.
      if (closing) {
        process.exit(128 + os.constants.signals[signal]);
      }
      closing = true;
      void viewer.close().then(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (error) {
    if (isStructuredError(error)) {
      process.stderr.write(`wastech-mdlint-viewer: ${error.message}\n`);
      if (error.hint !== undefined) {
        process.stderr.write(`${error.hint}\n`);
      }
    } else {
      process.stderr.write(
        `wastech-mdlint-viewer: ${(error as Error).message}\n`,
      );
    }
    process.exitCode = 1;
  }
}
