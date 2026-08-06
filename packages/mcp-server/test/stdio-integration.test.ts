import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { compileContext, loadConfiguration } from "@wastech-mdlint/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// M4: the only suite in this package that crosses a real OS process boundary. `smoke.test.ts` and
// `context-slice.test.ts` use `InMemoryTransport`, and every `handle*.test.ts` calls handlers
// in-process — none of those can catch stdio framing bugs, argv/entrypoint-guard breakage, or
// stdout/stderr channel confusion. Here a real `StdioClientTransport → node dist/index.js →
// StdioServerTransport` round trip proves the wire actually works.
//
// PRECONDITION: this requires `packages/mcp-server/dist/index.js` to already be built. It is under
// the documented verification order (`npm run typecheck` is `tsc -b`, which emits before `npm test`
// runs), but a bare `vitest run` on a never-built checkout will fail to spawn — build first.

const DIST_INDEX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);
const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const graphProject = path.join(fixturesDir, "graph-project");
const lintFindingsProject = path.join(fixturesDir, "lint-findings-project");

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const EXPECTED_TOOL_NAMES = [
  "compile-context",
  "context-graph",
  "context-slice",
  "impact-analysis",
  "lint",
  "lint-files",
];

// One persistent connection for the whole file (not one spawn per test): this matches how a real
// host uses the server — a long-lived process fielding many sequential requests — and keeps the
// spawn count and flake surface minimal. Per-tool algorithmic correctness is already pinned by the
// six `handle*.test.ts` files; this file's job is proving the wire survives many calls on one link.
let client: Client;

beforeAll(async () => {
  // `process.execPath`, not the literal "node": cross-platform correctness (child-process behavior is
  // an OS-sensitive area per the testing rules) and it avoids depending on PATH resolution in CI.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST_INDEX],
    stderr: "pipe",
  });
  client = new Client({ name: "mcp-server-stdio-it", version: "0.0.0" });
  await client.connect(transport);

  // Prime the client's output-schema validator cache here rather than relying on an earlier test
  // having called `listTools()`. This is what a real host does, and it is exactly the behavior the
  // error-case assertions below must exercise: with the cache primed, the SDK client validates each
  // tool's `structuredContent` against its advertised schema, so a regression that made an error
  // payload non-conforming would surface — even if a later test is run in isolation.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function structuredOf(
  result: Awaited<ReturnType<Client["callTool"]>>,
): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

// Assert the FULL M6 error payload survives the wire in `structuredContent` (not just the code): a
// regression that dropped `message` or `hint` guidance must fail here. The payload round-trips
// because each schema-carrying tool keeps its success schema strict while attaching schema-compatible
// placeholder success fields on errors (see `errorResult`/`withErrorOutput`); with the validator
// cache primed in `beforeAll`, a non-conforming
// `structuredContent` would be rejected by the client — so this genuinely pins the wire contract.
//
// `hint` handling has two halves (P14.05/W-19). Whenever one is present, the rendered text block must
// contain it — that is the assertion the exit criterion asks for, and it applies uniformly because
// `errorResult` owns the concatenation. Whether one must be present at all is per-call: every guided
// path in this suite requires a non-empty `hint`, and only the callers that opt out with
// `guided: false` (the operational-error path, which deliberately carries none) relax it. Defaulting
// to required is what keeps a future dropped hint failing instead of silently passing.
async function expectToolError(
  name: string,
  args: Record<string, unknown>,
  code: string,
  options: { guided?: boolean } = {},
): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  const error = result.structuredContent as {
    code?: unknown;
    message?: unknown;
    hint?: unknown;
  };
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe("string");
  expect(error.message as string).not.toBe("");

  if (options.guided ?? true) {
    expect(typeof error.hint).toBe("string");
    expect(error.hint as string).not.toBe("");
  }

  // The text block is what a host renders and what a model reads, so a hint that exists only in
  // `structuredContent` is invisible to most callers.
  if (typeof error.hint === "string") {
    expect(firstText(result)).toContain(error.hint);
  }
}

function firstText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? "";
}

// The five file-based tools with the minimum arguments each `inputSchema` requires, so a `cwd` guard
// can be asserted uniformly across all of them. `context-slice.depth` is deliberately omitted rather
// than passed: it is `.min(0)`-constrained, and a value the wire schema rejects would be refused
// pre-handler as a bare `InvalidParams` with no `structuredContent` — never reaching the guard.
function fileBasedToolCalls(
  cwd: string,
): Array<{ name: string; args: Record<string, unknown> }> {
  return [
    { name: "lint-files", args: { cwd } },
    { name: "context-graph", args: { cwd } },
    { name: "context-slice", args: { cwd, query: "guide.md" } },
    { name: "impact-analysis", args: { cwd, file: "guide.md" } },
    { name: "compile-context", args: { cwd } },
  ];
}

describe("mcp-server over stdio", () => {
  it("advertises exactly the six read-only tools with the locked structured-output split", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOL_NAMES);

    // M7 at the wire level: every tool carries the read-only annotation.
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }

    // M1 five-tool scoping at the wire level: compile-context is the deliberate exception with no
    // outputSchema; the other five advertise one.
    for (const tool of tools) {
      if (tool.name === "compile-context") {
        expect(tool.outputSchema).toBeUndefined();
      } else {
        expect(tool.outputSchema).toBeDefined();
      }
    }
  });

  it("lint: fires a rule on success and maps an unknown rule to INVALID_INPUT", async () => {
    const ok = await client.callTool({
      name: "lint",
      arguments: {
        content: "# Title\n\nsome body\nmore body\n",
        rules: [{ rule: "SIZE-001", options: { lines: { error: 1 } } }],
      },
    });
    expect(ok.isError).toBeFalsy();
    expect(structuredOf(ok).errorCount).toBe(1);
    expect(firstText(ok)).toContain("SIZE-001");

    // `SIZE-002` is a near-miss of the real `SIZE-001`, so the error carries a "did you mean" hint —
    // exercising the *guided* INVALID_INPUT path (a bare unknown id like "NOT-A-RULE" yields none).
    await expectToolError(
      "lint",
      { content: "# Title\n", rules: [{ rule: "SIZE-002" }] },
      "INVALID_INPUT",
    );
  });

  it("lint: runs a declarative custom rule and keeps the M6 payload for a malformed one", async () => {
    // P12.04 at the wire: a `{ rule: "custom" }` entry must survive the SDK's pre-handler input
    // validation in both directions. Valid — it lints. Malformed — the failure still arrives as the
    // M6 `{ code, message, hint }` payload (what `expectToolError` checks) rather than an `McpError`
    // protocol error, which is what a narrower wire schema would have produced.
    const ok = await client.callTool({
      name: "lint",
      arguments: {
        content: "| ID | Owner |\n| --- | --- |\n| REQ-1 |  |\n",
        rules: [
          {
            rule: "custom",
            id: "REQ-OWNER",
            options: { assert: { kind: "columnNotEmpty", column: "Owner" } },
          },
        ],
      },
    });
    expect(ok.isError).toBeFalsy();
    const output = structuredOf(ok);
    expect(output.errorCount).toBe(1);
    expect((output.messages as Array<{ ruleId: string }>)[0]!.ruleId).toBe(
      "REQ-OWNER",
    );

    await expectToolError(
      "lint",
      { content: "# Title\n", rules: [{ rule: "custom" }] },
      "INVALID_INPUT",
    );
  });

  it("lint-files: reports REF-001 from a fixture and CONFIG_INVALID on malformed config", async () => {
    const ok = await client.callTool({
      name: "lint-files",
      arguments: { cwd: lintFindingsProject },
    });
    expect(ok.isError).toBeFalsy();
    const output = structuredOf(ok);
    expect(output.errorCount).toBe(1);
    expect((output.messages as Array<{ ruleId: string }>)[0]!.ruleId).toBe(
      "REF-001",
    );

    const dir = await makeTempDir("mcp-it-lf-invalid-");
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      "{ not valid ",
      "utf8",
    );
    await expectToolError("lint-files", { cwd: dir }, "CONFIG_INVALID");
  });

  it("context-graph: returns nodes with a cycle and CONFIG_INVALID on malformed config", async () => {
    const ok = await client.callTool({
      name: "context-graph",
      arguments: { cwd: graphProject },
    });
    expect(ok.isError).toBeFalsy();
    const output = structuredOf(ok);
    expect((output.nodes as unknown[]).length).toBe(7);
    expect((output.cycles as unknown[]).length).toBe(1);

    const dir = await makeTempDir("mcp-it-cg-invalid-");
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      "{ not valid ",
      "utf8",
    );
    await expectToolError("context-graph", { cwd: dir }, "CONFIG_INVALID");
  });

  it("context-slice: resolves a path slice and CONFIG_INVALID on malformed config", async () => {
    // No thrown-error path exists for an unresolved query (that is an honest empty result per the
    // tool's contract), so the error case uses the malformed-config path instead.
    const ok = await client.callTool({
      name: "context-slice",
      arguments: { cwd: graphProject, query: "guide.md", depth: 1 },
    });
    expect(ok.isError).toBeFalsy();
    const output = structuredOf(ok);
    expect(output.matchKind).toBe("path");
    expect(output.files).toEqual(["guide.md", "requirements.md"]);

    const dir = await makeTempDir("mcp-it-cs-invalid-");
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      "{ not valid ",
      "utf8",
    );
    await expectToolError(
      "context-slice",
      { cwd: dir, query: "guide.md" },
      "CONFIG_INVALID",
    );
  });

  it("impact-analysis: classifies a blast radius and TARGET_NOT_FOUND for a missing file", async () => {
    const ok = await client.callTool({
      name: "impact-analysis",
      arguments: { cwd: graphProject, file: "requirements.md" },
    });
    expect(ok.isError).toBeFalsy();
    const output = structuredOf(ok);
    expect(output.directlyAffected).toEqual([
      { path: "design.md", references: 1 },
      { path: "guide.md", references: 1 },
    ]);
    expect(output.transitivelyAffected).toEqual([
      { path: "index.md", depth: 2, via: "guide.md" },
    ]);

    await expectToolError(
      "impact-analysis",
      { cwd: graphProject, file: "missing.md" },
      "TARGET_NOT_FOUND",
    );
  });

  it("compile-context: matches core's oracle on success and COMPILE_CONFIG_MISSING when absent", async () => {
    const dir = await makeTempDir("mcp-it-cc-ok-");
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      JSON.stringify({
        include: ["**/*.md"],
        rules: [{ rule: "REF-001" }],
        compile: { skill: { name: "docs-skill", description: "Docs skill" } },
      }),
      "utf8",
    );
    await writeFile(path.join(dir, "a.md"), "# A\n\n[b](b.md)\n", "utf8");
    await writeFile(path.join(dir, "b.md"), "# B\n", "utf8");

    const ok = await client.callTool({
      name: "compile-context",
      arguments: { cwd: dir },
    });
    expect(ok.isError).toBeFalsy();

    // Independent oracle: core's own pipeline, proving the tool reshapes nothing. This is also the
    // one success path with no `structuredContent` (M1) — its output lives in two text blocks.
    const loaded = await loadConfiguration({ cwd: dir });
    const expected = await compileContext(loaded, dir);
    const content = ok.content as Array<{ text: string }>;
    expect(content[0]!.text).toBe(expected.skillContent);
    expect(content[1]!.text).toBe(
      `Documents: ${expected.metadata.documentCount}, Rules: ${expected.metadata.ruleCount}, ` +
        `Components: ${expected.metadata.componentCount}`,
    );

    const missingDir = await makeTempDir("mcp-it-cc-missing-");
    await writeFile(path.join(missingDir, "a.md"), "# A\n", "utf8");
    // compile-context's success path returns no structuredContent (M1); its error path returns the
    // machine payload in `structuredContent` (no `outputSchema` to conflict with) like every other
    // tool — pinned here at the wire level.
    await expectToolError(
      "compile-context",
      { cwd: missingDir },
      "COMPILE_CONFIG_MISSING",
    );
  });

  // @boundary-guard installed-bin-spawn
  //
  // P14.01/W-18. What this proves that no in-process test can: before the guard, four of these five
  // tools answered a nonexistent `cwd` with a *plausible* success — `No problems found.`, an empty
  // graph, `No match for query`, `File not found in the context graph` — which is the client-visible
  // shape being fixed, and a handler-level assertion would have passed on it just as happily. It also
  // exercises the payload against the client's primed output-schema validator (`beforeAll`), so a
  // rejection whose `structuredContent` did not conform to the tool's advertised `outputSchema` fails
  // here rather than silently reaching a real host.
  //
  // It does NOT cover the `argv[1]`-vs-symlink half of this category — `bin-entrypoint.test.ts` keeps
  // that. Both are tagged because the category is "the built entrypoint, spawned as a real process",
  // and this suite is the only place the five tools' wire responses are visible at all.
  it("rejects a nonexistent cwd with INVALID_INPUT on every file-based tool", async () => {
    // A path under a temp dir that is never created, so the parent exists and only the leaf is
    // missing — the ENOENT case, not a whole-tree-missing accident.
    const parent = await makeTempDir("mcp-it-cwd-missing-");
    const missing = path.join(parent, "no-such-directory");

    for (const { name, args } of fileBasedToolCalls(missing)) {
      await expectToolError(name, args, "INVALID_INPUT");
    }
  });

  // P14.05/W-21. Over the wire because that is where the defect was measured: the field test saw
  // `INTERNAL_ERROR` and "An unexpected internal error occurred." against a directory whose
  // permissions were removed, while the CLI on the same fixture printed `Operational error: EACCES on
  // docs/locked` and exited 2. It also exercises the new code against the client's primed
  // output-schema validator (`beforeAll`) — `OPERATIONAL_ERROR` is a fresh member of the advertised
  // `code` enum, so a payload the enum did not admit would be rejected here.
  //
  // Root ignores directory permissions and Windows has no equivalent model, so the fault only exists
  // for an unprivileged POSIX user; the portable half is pinned by synthetic errno cases in
  // `tool-response.test.ts`.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports an unreadable directory as OPERATIONAL_ERROR naming the errno and the relative path",
    async () => {
      const dir = await makeTempDir("mcp-it-locked-");
      const locked = path.join(dir, "docs", "locked");
      await mkdir(locked, { recursive: true });
      await writeFile(path.join(dir, "a.md"), "# A\n", "utf8");
      await chmod(locked, 0o000);

      try {
        // `guided: false`: this path carries no `hint` by design — an errno-specific remedy would be
        // guesswork — which is exactly the conditional-hint case the exit criterion calls for.
        await expectToolError("lint-files", { cwd: dir }, "OPERATIONAL_ERROR", {
          guided: false,
        });

        const result = await client.callTool({
          name: "lint-files",
          arguments: { cwd: dir },
        });
        expect(structuredOf(result).message).toBe(
          "Operational error: EACCES on docs/locked",
        );
        // The absolute base must not survive the wire in any field of an `OPERATIONAL_ERROR`; only
        // P14.01's `INVALID_INPUT` names a `cwd` absolutely, and there it is the failure itself.
        expect(JSON.stringify(result)).not.toContain(dir);
      } finally {
        await chmod(locked, 0o755);
      }
    },
  );

  // P14.05/W-20 characterization pin, not a fix. The decision was to keep schema rejections
  // contract-exempt (loosening a tool's advertised `inputSchema` purely so the handler can reject the
  // shape better would destroy the discoverability contract a host uses to *construct* valid calls),
  // so this passed before the change and passes after. Its value is failing if that shape ever moves
  // — an SDK upgrade, or a decision to pre-validate — because `docs/guide/mcp-server.md` describes
  // exactly this response to users.
  it("leaves a schema-level rejection outside the structured contract, as documented", async () => {
    const result = await client.callTool({
      name: "context-slice",
      arguments: { cwd: graphProject, query: "guide.md", depth: -1 },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    // Every claim the guide makes about this response: the JSON-RPC number leaks into user-facing
    // text, and the text still names the offending field and its constraint.
    expect(firstText(result)).toContain("-32602");
    expect(firstText(result)).toContain("Input validation error");
    expect(firstText(result)).toContain("depth");
    expect(firstText(result)).toContain("Too small: expected number to be >=0");
  });

  it("rejects a cwd that exists but is a file with INVALID_INPUT on every file-based tool", async () => {
    // The ENOTDIR half of the same guard: `stat` succeeds here, so only the `isDirectory()` check (or
    // a downstream ENOTDIR) can catch it. Asserting on the code rather than platform-formatted text
    // keeps this portable.
    const dir = await makeTempDir("mcp-it-cwd-file-");
    const filePath = path.join(dir, "not-a-directory.md");
    await writeFile(filePath, "# Not a directory\n", "utf8");

    for (const { name, args } of fileBasedToolCalls(filePath)) {
      await expectToolError(name, args, "INVALID_INPUT");
    }
  });
});
