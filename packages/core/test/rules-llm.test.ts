import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-llm-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

function rule(id: string, options?: unknown): ConfiguredRule {
  return { rule: ruleRegistry.resolveRule(id, options) };
}

async function lint(cwd: string, rules: ConfiguredRule[]) {
  return lintFiles({ cwd, config: { rules: [] }, rules, settings: {} });
}

describe("SIZE-001 line and token metrics", () => {
  it("flags line and token budgets independently", async () => {
    const cwd = await fixtureRepo({ "a.md": `${"line\n".repeat(10)}` });
    const result = await lint(cwd, [rule("SIZE-001", { lines: { error: 5 }, tokens: { warn: 2 } })]);
    const metrics = result.messages.map((message) => `${message.data?.metric}:${message.severity}`).sort();
    expect(metrics).toEqual(["lines:error", "tokens:warning"]);
  });
});

describe("LLM-001 eager-import budget", () => {
  it("flags an entrypoint whose own + imported tokens exceed the budget", async () => {
    const cwd = await fixtureRepo({
      "CLAUDE.md": `Preamble @docs/big.md\n`,
      "docs/big.md": `${"x".repeat(400)}\n`
    });
    const result = await lint(cwd, [
      rule("LLM-001", { entrypoints: ["CLAUDE.md"], maxTokensPerEntrypoint: 50 })
    ]);
    const overBudget = result.messages.find((message) => message.message.includes("over context budget"));
    expect(overBudget).toMatchObject({ filePath: "CLAUDE.md" });
    expect(overBudget?.data).toMatchObject({ maxTokens: 50 });
  });

  it("reports a missing eager import", async () => {
    const cwd = await fixtureRepo({ "CLAUDE.md": "See @docs/missing.md\n" });
    const result = await lint(cwd, [
      rule("LLM-001", { entrypoints: ["CLAUDE.md"], maxTokensPerEntrypoint: 100000 })
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toMatch(/Missing eager import @docs\/missing\.md/);
  });

  it("detects an eager-import cycle", async () => {
    const cwd = await fixtureRepo({
      "CLAUDE.md": "@a.md\n",
      "a.md": "@b.md\n",
      "b.md": "@a.md\n"
    });
    const result = await lint(cwd, [
      rule("LLM-001", { entrypoints: ["CLAUDE.md"], maxTokensPerEntrypoint: 100000 })
    ]);
    expect(result.messages.some((message) => message.message.includes("Eager import cycle detected"))).toBe(true);
  });
});
