import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { compileContext, loadConfiguration } from "@wastech-mdlint/core";
import { afterAll, describe, expect, it } from "vitest";

import { handleCompileContext } from "../src/tools/compile-context.js";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function textOf(block: unknown): string {
  return (block as { text: string }).text;
}

describe("handleCompileContext", () => {
  it("returns the skill content plus a metadata line matching core's compileContext oracle", async () => {
    const dir = await makeTempDir("mcp-cc-ok-");
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      JSON.stringify({
        include: ["**/*.md"],
        rules: [{ rule: "REF-001" }],
        compile: { skill: { name: "docs-skill", description: "Docs skill" } }
      }),
      "utf8"
    );
    await writeFile(path.join(dir, "a.md"), "# A\n\n[b](b.md)\n", "utf8");
    await writeFile(path.join(dir, "b.md"), "# B\n", "utf8");

    const result = await handleCompileContext({ cwd: dir });
    expect(result.isError).toBeFalsy();

    // Independent oracle: call core's own pipeline directly (not through the shared helper) and prove
    // the tool reshapes nothing — `skillContent` byte-for-byte, metadata line character-for-character.
    // This proves the AC's determinism/parity criterion without hand-computing counts (which depend
    // on describeRules/graph internals) or cross-importing the CLI (mcp-server depends only on core).
    const loaded = await loadConfiguration({ cwd: dir });
    const expected = await compileContext(loaded, dir);

    expect(textOf(result.content![0])).toBe(expected.skillContent);
    expect(textOf(result.content![1])).toBe(
      `Documents: ${expected.metadata.documentCount}, Rules: ${expected.metadata.ruleCount}, ` +
        `Components: ${expected.metadata.componentCount}`
    );
  });

  it("passes the COMPILE_CONFIG_MISSING error through when config.compile is absent", async () => {
    const dir = await makeTempDir("mcp-cc-missing-");
    // No config file → zero-config default has no `compile`.
    await writeFile(path.join(dir, "a.md"), "# A\n", "utf8");

    const result = await handleCompileContext({ cwd: dir });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("COMPILE_CONFIG_MISSING");
    expect((result.structuredContent as { hint?: string }).hint).toBeTruthy();
    expect(textOf(result.content![0])).toContain("config.compile is missing");
  });
});
