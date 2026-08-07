import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertBuilt } from "../../core/test/support/assert-built.js";
import { PARITY_LINT_FIXTURE } from "../../core/test/support/output-parity.js";

// @boundary-guard host-parity
//
// W-57 / P16.01 §5, the cross-host leg: "each host's rendering against the other's".
//
// The two hosts are thin adapters over one core pipeline, which is exactly why nothing compared them —
// each package tests its own handler, and both pass while rendering the same run differently. Three of
// the defects the deep audit missed were divergences of this shape (a `hint` present in one document
// and not the other, a `--format` word that meant different things on sibling commands, a summary key
// one format carried and the other did not), and every one was found by reading rather than by a test.
//
// Crossing a real process boundary is deliberate and is what distinguishes this from the two
// human-vs-structured suites: the CLI's rendering only exists as bytes on a real stdout, and the MCP
// one only as the `content`/`structuredContent` pair a client actually receives. In-process handler
// calls compare two values that never went through either channel.
//
// PRECONDITION: both `dist/` trees must be built — this spawns the CLI bin and the MCP entrypoint.
// `assertBuilt` fails fast with the remedy (see `packages/core/test/support/assert-built.ts`).

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const CLI_DIST = path.join(repoRoot, "packages/cli/dist/index.js");
const MCP_DIST = path.join(repoRoot, "packages/mcp-server/dist/index.js");

assertBuilt(CLI_DIST, path.join(repoRoot, "packages/cli/src/index.ts"));
assertBuilt(MCP_DIST, path.join(repoRoot, "packages/mcp-server/src/index.ts"));

// Windows writes `\r\n` where POSIX writes `\n`; both hosts render through the same core formatters, so
// normalizing once here keeps a byte comparison honest on every leg rather than per assertion.
function normalize(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

const tempDirs: string[] = [];
let client: Client;
let fixture: string;

// One corpus for both legs, and the lint half of it is the shared one: `PARITY_LINT_FIXTURE` (beside
// the readers in `core/test/support/output-parity.ts`) already produces every location shape and both
// severities, so restating it here with slightly different numbers is exactly the drift the shared
// fixture exists to prevent. What it does not carry is a graph — it is flat and its one link is
// unresolved — so the three linked documents below are added on top for the graph leg, which is only
// meaningful over a corpus that has edges and an entry point.
const FIXTURE_FILES: Record<string, string> = {
  ...PARITY_LINT_FIXTURE.files,
  "docs/index.md": "# Index\n\n[guide](guide.md)\n\n[api](api.md)\n",
  "docs/guide.md": "# Guide\n\n[api](api.md)\n",
  "docs/api.md": "# API\n\n## Requests\n\n## Responses\n",
};

beforeAll(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-hostparity-"));
  tempDirs.push(fixture);
  for (const [relativePath, content] of Object.entries(FIXTURE_FILES)) {
    const absolutePath = path.join(fixture, relativePath);
    // The nested `docs/` directory does not exist under a fresh `mkdtemp` root; without this the write
    // ENOENTs (same helper shape as the other fixture builders in this repo).
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  // `process.execPath`, not the literal "node": child-process behavior is an OS-sensitive area, and
  // this avoids depending on PATH resolution in CI. Same reasoning as `stdio-integration.test.ts`.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_DIST],
    stderr: "pipe",
  });
  client = new Client({ name: "mcp-host-parity", version: "0.0.0" });
  await client.connect(transport);
  // Primes the client's output-schema validator cache, as a real host does.
  await client.listTools();
}, 60_000);

afterAll(async () => {
  // `client?` and try/finally, though the declaration is not optional: `beforeAll` assigns `client`
  // last, so a failing `connect`/`listTools` leaves it genuinely `undefined` here — and a teardown that
  // threw `Cannot read properties of undefined` would replace the real connection failure with a
  // meaningless one *and* leak the `mkdtemp` fixture. The removal is the half nothing else will do.
  try {
    await client?.close();
  } finally {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  }
});

function runCliBin(args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync(process.execPath, [CLI_DIST, ...args], {
    cwd: fixture,
    encoding: "utf8",
    windowsHide: true,
  });
  return { status: result.status, stdout: normalize(result.stdout) };
}

function firstText(result: { content: unknown }): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return normalize(content[0]?.text ?? "");
}

describe("CLI and MCP render the same lint run identically", () => {
  it("emits byte-identical human text from `lint` and `lint-files`", async () => {
    const cli = runCliBin(["lint", fixture]);
    const mcp = await client.callTool({
      name: "lint-files",
      arguments: { cwd: fixture },
    });

    // Both hosts call core's `formatLintResultText`, so this is a byte comparison, not a
    // similar-enough one. A host that reformatted, re-sorted, or re-attributed anything fails here.
    expect(firstText(mcp)).toBe(cli.stdout);
    // Non-vacuous: the fixture really does produce findings on both paths.
    expect(cli.stdout).toContain("REF-001");
    expect(cli.status).toBe(1);
  }, 60_000);

  it("carries the same findings in both machine payloads, under each host's own keys", async () => {
    const cli = runCliBin(["lint", fixture, "--format", "json"]);
    const mcp = await client.callTool({
      name: "lint-files",
      arguments: { cwd: fixture },
    });

    const cliPayload = JSON.parse(cli.stdout) as {
      summary: { files: number; errors: number; warnings: number };
      messages: unknown[];
      files: string[];
    };
    const mcpPayload = mcp.structuredContent as unknown as {
      messages: unknown[];
      files: string[];
      errorCount: number;
      warningCount: number;
    };

    // The findings and the corpus are the *same* documents, message for message and path for path.
    expect(mcpPayload.messages).toEqual(cliPayload.messages);
    expect(mcpPayload.files).toEqual(cliPayload.files);
    expect({
      errors: mcpPayload.errorCount,
      warnings: mcpPayload.warningCount,
      files: mcpPayload.files.length,
    }).toEqual({
      errors: cliPayload.summary.errors,
      warnings: cliPayload.summary.warnings,
      files: cliPayload.summary.files,
    });

    // Where the two deliberately diverge, pinned as the decision it is rather than left to be
    // rediscovered: the CLI wraps the record with a `summary` for a human reader, while MCP returns it
    // verbatim so a typed client reads counts at the top level (W-24, documented in
    // `docs/guide/output.md` — "Where each host puts the findings").
    expect(Object.keys(cliPayload).sort()).toEqual([
      "files",
      "messages",
      "summary",
    ]);
    expect(Object.keys(mcpPayload).sort()).toEqual([
      "errorCount",
      "files",
      "messages",
      "warningCount",
    ]);
  }, 60_000);
});

describe("CLI and MCP render the same graph consistently", () => {
  it("prefixes the CLI graph report with exactly the MCP tool's text block", async () => {
    const cli = runCliBin(["graph", fixture]);
    const mcp = await client.callTool({
      name: "context-graph",
      arguments: { cwd: fixture },
    });

    expect(cli.status).toBe(0);
    // Not equality, and the difference is the point: the CLI renders `renderContextGraphText`, which
    // *begins* with the `formatContextGraphSummary` block the MCP tool returns and then adds clusters,
    // reading order and coverage. Prefix equality is therefore the strongest true statement — and it
    // still fails if either side reorders or reformats the shared block.
    expect(cli.stdout.startsWith(firstText(mcp))).toBe(true);
    // Non-vacuous in both directions: the shared block is substantial, and the CLI really does add to
    // it rather than the two being accidentally equal.
    expect(firstText(mcp)).toContain("entry points (");
    expect(cli.stdout.length).toBeGreaterThan(firstText(mcp).length);
    expect(cli.stdout).toContain("reading order (");
  }, 60_000);
});
