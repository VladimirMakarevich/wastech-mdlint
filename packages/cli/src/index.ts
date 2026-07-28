#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXIT_CODE_USAGE_ERROR } from "./commands.js";
import { formatOperationalError } from "./operational-errors.js";
import { runCli } from "./program.js";

const invokedPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);

// npm/pnpm/yarn install `bin` as a symlink on POSIX (node_modules/.bin/wastech-mdlint ->
// ../@wastech-mdlint/cli/dist/index.js). process.argv[1] keeps that symlink path, while
// import.meta.url is resolved by the ESM loader to the target's realpath, so comparing
// path.resolve(invokedPath) (which never dereferences symlinks) against modulePath never matched a
// symlinked invocation — the published bin silently did nothing through npx or a local/global
// install (H-1). realpathSync throws on a path that doesn't exist; falling back to the unresolved
// path there is safe because it can then never equal the other, dereferenced side — the guard
// still blocks execution for that case, same as it does when the module is only imported (e.g. by
// a test).
function realOrSelf(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

// Guards against running the CLI as a side effect of being imported (e.g. by tests); only the
// real bin invocation should parse process.argv and set the process exit code. Both sides are
// dereferenced, not just invokedPath: import.meta.url is only a realpath by Node's *default*
// module resolution — under --preserve-symlinks/--preserve-symlinks-main it keeps the symlink path
// too, and comparing it unresolved against a dereferenced invokedPath would silently reopen H-1 in
// that mode.
if (
  invokedPath !== undefined &&
  realOrSelf(path.resolve(invokedPath)) === realOrSelf(modulePath)
) {
  // `runCli` catches everything its own `try` covers, but that block does not start until after
  // `readPackageVersion()` has already run. A rejection from there (or from anything else outside
  // it) escapes this top-level `await`, and Node terminates an unhandled rejection with exit **1** —
  // the code reserved exclusively for lint findings, so CI could not tell "the linter found
  // problems" from "the CLI could not start" (M-6, reopened at the process boundary). Re-report it
  // through the same formatter and the same exit code the in-process backstop uses (program.ts).
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `Operational error: ${formatOperationalError(error, process.cwd())}\n`,
    );
    process.exitCode = EXIT_CODE_USAGE_ERROR;
  }
}
