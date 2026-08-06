import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LintResult } from "@wastech-mdlint/core";
import { afterAll, describe, expect, it } from "vitest";

import { handleLintFiles } from "../src/tools/lint-files.js";
import {
  lintMessagesAsRows,
  PARITY_LINT_FIXTURE,
  readLintFindingLines,
  readLintSummaryLine,
} from "../../core/test/support/output-parity.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function structured(
  result: Awaited<ReturnType<typeof handleLintFiles>>,
): LintResult {
  return result.structuredContent as unknown as LintResult;
}

describe("handleLintFiles", () => {
  it("lints via the zero-config `**/*.md` fallback when no config or patterns are given", async () => {
    const dir = await makeTempDir("mcp-lf-empty-");
    await writeFile(path.join(dir, "a.md"), "# A\n", "utf8");
    await writeFile(path.join(dir, "b.md"), "# B\n", "utf8");

    const result = await handleLintFiles({ cwd: dir });

    expect(result.isError).toBeFalsy();
    expect(structured(result).files.sort()).toEqual(["a.md", "b.md"]);
  });

  // The default `exclude` is core's, not the CLI's (P13.02): both hosts reach the corpus through
  // `resolveCorpusScope`, so an agent asking this tool about a repository with a dependency tree gets
  // the same pruned corpus a `lint` run would — and does not spend its context on `node_modules`.
  it("inherits the lint-time default exclude with no config present (P13.02)", async () => {
    const dir = await makeTempDir("mcp-lf-default-exclude-");
    await mkdir(path.join(dir, "docs"), { recursive: true });
    await mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(dir, "docs", "a.md"), "# A\n", "utf8");
    await writeFile(
      path.join(dir, "node_modules", "pkg", "README.md"),
      "# Dep\n",
      "utf8",
    );

    const result = await handleLintFiles({ cwd: dir });

    expect(result.isError).toBeFalsy();
    expect(structured(result).files).toEqual(["docs/a.md"]);
  });

  it("reports a REF-001 error from a real project fixture", async () => {
    const result = await handleLintFiles({
      cwd: path.join(fixturesDir, "lint-findings-project"),
    });

    expect(result.isError).toBeFalsy();
    const output = structured(result);
    expect(output.errorCount).toBe(1);
    expect(output.messages[0]!.ruleId).toBe("REF-001");
    const summary = (result.content[0] as { text: string }).text;
    expect(summary).toContain("REF-001");
    expect(summary).toContain("broken.md");
  });

  // W-24's other half: this tool returns the raw `LintResult`, so its counts are top-level
  // `errorCount`/`warningCount` where the CLI's JSON puts them under `summary`. Both key sets are
  // pinned (see `lint.test.ts` for the ad-hoc tool) so the documented divergence cannot drift
  // unnoticed in either direction.
  it("returns the raw LintResult keys, with `files` and top-level counts", async () => {
    const result = await handleLintFiles({
      cwd: path.join(fixturesDir, "lint-findings-project"),
    });

    expect(
      Object.keys(result.structuredContent as Record<string, unknown>).sort(),
    ).toEqual(["errorCount", "files", "messages", "warningCount"]);
    // No `summary` wrapper: a typed client reads the record, which is why the shapes differ at all.
    expect(result.structuredContent).not.toHaveProperty("summary");
  });

  // @boundary-guard host-parity
  //
  // W-57 / P16.01 §5. Every MCP success carries two documents — a human `content` block and
  // `structuredContent` — and until now nothing checked that the first renders the second. The shared
  // readers in `core/test/support/output-parity.ts` parse the text back into rows and restate the
  // location rule, so this is two formulations of the same findings rather than one helper agreeing
  // with itself. The CLI twin lives in `packages/cli/test/lint.e2e.test.ts`; the cross-host leg, where
  // the two hosts are compared to each other, is in `test/host-parity.test.ts`.
  it("renders its own structured messages in the text block", async () => {
    // The corpus and its expected location set both come from `PARITY_LINT_FIXTURE`, beside the readers:
    // all three location shapes the human formatter branches on in one corpus, stated once so this
    // suite, the CLI twin and the cross-host guard cannot drift from each other.
    const dir = await makeTempDir("mcp-lf-parity-");
    for (const [relativePath, content] of Object.entries(
      PARITY_LINT_FIXTURE.files,
    )) {
      await writeFile(path.join(dir, relativePath), content, "utf8");
    }

    const result = await handleLintFiles({ cwd: dir });
    expect(result.isError).toBeFalsy();

    const text = (result.content[0] as { text: string }).text;
    const rows = readLintFindingLines(text);

    expect(rows).toEqual(lintMessagesAsRows(structured(result).messages));
    expect(rows.map((row) => row.location).sort()).toEqual(
      PARITY_LINT_FIXTURE.locations,
    );
    expect(readLintSummaryLine(text)).toEqual({
      total: structured(result).errorCount + structured(result).warningCount,
      errors: structured(result).errorCount,
      warnings: structured(result).warningCount,
    });
  });

  // W-35: the value `helpUri` carries over the wire is now a page, not a restatement of `ruleId`.
  it("crosses `helpUri` as a documentation URL", async () => {
    const result = await handleLintFiles({
      cwd: path.join(fixturesDir, "lint-findings-project"),
    });

    expect(structured(result).messages[0]!.helpUri).toBe(
      "https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/rules/REF-001.md",
    );
  });

  it("replaces config.include when an explicit patterns arg is passed", async () => {
    const result = await handleLintFiles({
      cwd: path.join(fixturesDir, "basic-project"),
      patterns: ["guide.md"],
    });

    expect(result.isError).toBeFalsy();
    expect(structured(result).files).toEqual(["guide.md"]);
  });

  // P14.01. Fast feedback on the module whose fix was the refactor: `lint-files` used to recompute
  // `cwd ?? process.cwd()` outside the shared resolver, so guarding only the resolver would have left
  // it answering `No problems found.` here. The wire-level acceptance evidence is in
  // `stdio-integration.test.ts`.
  it("rejects a nonexistent cwd with INVALID_INPUT instead of reporting a clean corpus", async () => {
    const parent = await makeTempDir("mcp-lf-cwd-missing-");

    const result = await handleLintFiles({
      cwd: path.join(parent, "no-such-directory"),
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe(
      "INVALID_INPUT",
    );
  });

  // W-21/P14.05. Fast in-process feedback on the operational classifier; the wire-level evidence is
  // in `stdio-integration.test.ts`. This is the field test's own scenario — a directory inside the
  // corpus with its permissions removed — which used to come back as `INTERNAL_ERROR` and "An
  // unexpected internal error occurred.", dropping the errno and the path that are the entire
  // actionable content.
  //
  // Root ignores directory permissions and Windows has no equivalent model, so the fault only exists
  // for an unprivileged POSIX user — the same precondition, and the same guard, as the CLI's
  // write-failure tests. The portable half of this behavior is pinned by synthetic errno cases in
  // `tool-response.test.ts`, which run everywhere.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "classifies an unreadable directory as OPERATIONAL_ERROR naming the errno and the relative path",
    async () => {
      const dir = await makeTempDir("mcp-lf-locked-");
      const locked = path.join(dir, "locked");
      await mkdir(locked, { recursive: true });
      await writeFile(path.join(dir, "a.md"), "# A\n", "utf8");
      await chmod(locked, 0o000);

      try {
        const result = await handleLintFiles({ cwd: dir });

        expect(result.isError).toBe(true);
        const error = result.structuredContent as {
          code: string;
          message: string;
          hint?: string;
        };
        expect(error.code).toBe("OPERATIONAL_ERROR");
        expect(error.message).toBe("Operational error: EACCES on locked");
        // No hint by design — the message already carries the whole remedy-bearing content.
        expect(error.hint).toBeUndefined();
        // The absolute base must not survive anywhere in an `OPERATIONAL_ERROR` payload — the errno's
        // path is rendered relative to it. (P14.01's `INVALID_INPUT` rejection is the deliberate
        // exception: there the `cwd` is itself the broken thing and is named absolutely.)
        expect(JSON.stringify(result)).not.toContain(dir);
      } finally {
        // Without this the shared afterAll `rm(..., { recursive: true })` fails with EACCES.
        await chmod(locked, 0o755);
      }
    },
  );

  it("passes a structured CONFIG_INVALID error through on malformed config", async () => {
    const dir = await makeTempDir("mcp-lf-invalid-");
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      "{ not valid ",
      "utf8",
    );

    const result = await handleLintFiles({ cwd: dir });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe(
      "CONFIG_INVALID",
    );
  });
});
