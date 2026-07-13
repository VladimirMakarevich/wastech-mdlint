import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LintResult } from "@wastech-mdlint/core";
import { afterAll, describe, expect, it } from "vitest";

import { handleLintFiles } from "../src/tools/lint-files.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function structured(result: Awaited<ReturnType<typeof handleLintFiles>>): LintResult {
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

  it("reports a REF-001 error from a real project fixture", async () => {
    const result = await handleLintFiles({ cwd: path.join(fixturesDir, "lint-findings-project") });

    expect(result.isError).toBeFalsy();
    const output = structured(result);
    expect(output.errorCount).toBe(1);
    expect(output.messages[0]!.ruleId).toBe("REF-001");
    const summary = (result.content[0] as { text: string }).text;
    expect(summary).toContain("REF-001");
    expect(summary).toContain("broken.md");
  });

  it("replaces config.include when an explicit patterns arg is passed", async () => {
    const result = await handleLintFiles({
      cwd: path.join(fixturesDir, "basic-project"),
      patterns: ["guide.md"]
    });

    expect(result.isError).toBeFalsy();
    expect(structured(result).files).toEqual(["guide.md"]);
  });

  it("passes a structured CONFIG_INVALID error through on malformed config", async () => {
    const dir = await makeTempDir("mcp-lf-invalid-");
    await writeFile(path.join(dir, "wastech-mdlint.config.json"), "{ not valid ", "utf8");

    const result = await handleLintFiles({ cwd: dir });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("CONFIG_INVALID");
  });
});
