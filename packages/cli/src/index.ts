#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCli } from "./program.js";

const invokedPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);

// Guards against running the CLI as a side effect of being imported (e.g. by tests); only the
// real bin invocation should parse process.argv and set the process exit code.
if (invokedPath !== undefined && path.resolve(invokedPath) === modulePath) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
