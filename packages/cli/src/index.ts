#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
