#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerTools } from "./tools/index.js";

// The server shell. Tools are registered through the modular seam in tools/index.ts — one
// module per tool — so this file stays the transport/lifecycle owner, not a tool mega-file.
// Every read-only tool is appended to that seam rather than registered here.
// The invariants this shell locks in: transport is stdio-only and the server never loads
// code-plugins.

// Resolves relative to the compiled module (dist/index.js), one level under dist/, so the read
// keeps finding packages/mcp-server/package.json regardless of the caller's cwd — the same
// approach the CLI uses for its version lookup.
async function readPackageVersion(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.resolve(moduleDir, "../package.json");
  const packageJsonText = await readFile(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonText) as { version?: string };

  return packageJson.version ?? "0.0.0";
}

export async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "wastech-mdlint-mcp",
    version: await readPackageVersion(),
  });

  registerTools(server);

  return server;
}

export async function startServer(): Promise<void> {
  const server = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Readiness is announced on stderr, never stdout: stdout is the MCP JSON-RPC channel, so any
  // stray write there would corrupt the protocol stream for the connected host.
  process.stderr.write("wastech-mdlint-mcp: ready (stdio)\n");
}

const invokedPath = process.argv[1];
const modulePath = fileURLToPath(import.meta.url);

// Same symlink defect as the CLI entrypoint (packages/cli/src/index.ts) — see its comment for the
// full explanation. process.argv[1] keeps the node_modules/.bin symlink path while import.meta.url
// resolves to the realpath, so dereferencing before comparing is required for the guard to ever
// match a symlinked invocation.
function realOrSelf(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

// Only auto-start when run as the real bin; importing this module (e.g. from a smoke test) must
// not spin up a transport that seizes stdio, mirroring the CLI entrypoint guard. Both sides are
// dereferenced (not just invokedPath): import.meta.url is only a realpath under Node's default
// module resolution — under --preserve-symlinks/--preserve-symlinks-main it stays the symlink path
// too, and an unresolved comparison there would reject a legitimate bin invocation in that mode.
if (
  invokedPath !== undefined &&
  realOrSelf(path.resolve(invokedPath)) === realOrSelf(modulePath)
) {
  startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`wastech-mdlint-mcp: failed to start: ${message}\n`);
    process.exitCode = 1;
  });
}
