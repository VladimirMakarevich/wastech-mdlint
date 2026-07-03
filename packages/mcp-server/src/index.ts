#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// P0 ships only the package shell. The six read-only tools land in P7 on top of
// @wastech-mdlint/core; keeping the stub tool-free here avoids committing to a tool contract
// (names, input/output schemas) before the phase that designs the structured-output surface.
// The invariant this stub does lock in: transport is stdio-only and the server never loads
// code-plugins (M8).

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
  return new McpServer({
    name: "wastech-mdlint-mcp",
    version: await readPackageVersion()
  });
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

// Only auto-start when run as the real bin; importing this module (e.g. from a smoke test) must
// not spin up a transport that seizes stdio, mirroring the CLI entrypoint guard.
if (invokedPath !== undefined && path.resolve(invokedPath) === modulePath) {
  startServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`wastech-mdlint-mcp: failed to start: ${message}\n`);
    process.exitCode = 1;
  });
}
