import { symlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";

// @boundary-guard installed-bin-spawn
//
// P12.06. `src/index.ts`'s entrypoint guard got the same `realOrSelf` fix as the CLI's (H-1), but
// nothing spawned it through a *link* — `stdio-integration.test.ts` spawns `dist/index.js` by its
// real path, which passes with the defect present, and P11.01 explicitly deferred an mcp-server
// spawn test ("No new mcp-server spawn test"). That left the fix on this side unguarded: the second
// of the two entrypoints H-1 affected. This file closes that hole, and only that hole — per-tool
// behavior and the whole wire contract stay in `stdio-integration.test.ts`.
//
// Why a link is the only shape that can catch it: an npm-linked install leaves `process.argv[1]`
// pointing at the symlink/junction while `import.meta.url` resolves to the realpath, so an
// undereferenced comparison never matches and `startServer()` never runs. Reverting `realOrSelf` in
// `src/index.ts` must fail THIS test (verified by doing exactly that): the child then starts no
// transport, exits 0 immediately, and `connect()` rejects.
//
// PRECONDITION: `packages/mcp-server/dist/index.js` must already be built — same precondition, and
// same reasoning, as `stdio-integration.test.ts`. `assertBuilt()` fails fast rather than letting a
// stale/missing artifact look like a guard regression. It is the shared helper since W-56 (P16.01),
// because the remedy its message names has to be right in both copies at once.

const DIST_INDEX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);
const SRC_INDEX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/index.ts",
);

assertBuilt(DIST_INDEX, SRC_INDEX);

// Mirrors `stdio-integration.test.ts`'s list; asserted sorted so the six-tool surface (M1) is
// pinned independently of registration order.
const EXPECTED_TOOL_NAMES = [
  "compile-context",
  "context-graph",
  "context-slice",
  "impact-analysis",
  "lint",
  "lint-files",
];

describe("installed-entrypoint shape via symlink/junction (H-1 regression guard)", () => {
  let linkRoot: string;
  let linkedEntry: string;
  let client: Client;

  beforeAll(async () => {
    linkRoot = await mkdtemp(
      path.join(os.tmpdir(), "wastech-mdlint-mcp-link-"),
    );
    if (process.platform === "win32") {
      // Windows needs elevation (or Developer Mode) to symlink a *file*, but directory junctions
      // need neither — and a junction is what npm creates for a workspace/global-linked install
      // there. Node dereferences a junction the same way it dereferences a POSIX symlink, so this
      // reproduces the same argv[1]-vs-import.meta.url mismatch. (Same reasoning as
      // packages/cli/test/bin.e2e.test.ts.)
      const junctionDir = path.join(linkRoot, "dist-junction");
      symlinkSync(path.dirname(DIST_INDEX), junctionDir, "junction");
      linkedEntry = path.join(junctionDir, path.basename(DIST_INDEX));
    } else {
      linkedEntry = path.join(linkRoot, "wastech-mdlint-mcp");
      symlinkSync(DIST_INDEX, linkedEntry);
    }

    // `process.execPath` rather than the shebang, so the missing execute bit on a fresh build is
    // not mistaken for a guard regression (the link itself is what this test varies).
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [linkedEntry],
      stderr: "pipe",
    });
    client = new Client({
      name: "mcp-server-bin-entrypoint",
      version: "0.0.0",
    });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    // `client?` and try/finally: `client` is assigned at the end of `beforeAll`, so a symlink or spawn
    // failure leaves it `undefined` — and this suite's whole point is that a broken entrypoint fails
    // *legibly*, which a TypeError in teardown (with `linkRoot` left behind) is not.
    try {
      await client?.close();
    } finally {
      await rm(linkRoot, { recursive: true, force: true });
    }
  });

  // Explicit 30s timeout, not vitest's 5s default: a cold `process.execPath` start ESM-loads the
  // MCP SDK plus `@wastech-mdlint/core` (remark/unified), which is tight on `windows-latest`. It
  // also bounds the one failure mode worth naming — if the guard regresses the child exits 0 and
  // `connect()` rejects promptly, but the timeout keeps a CI-only stall from hanging the run.
  it("serves the six read-only tools when spawned through the linked entrypoint", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);
  }, 30_000);
});
