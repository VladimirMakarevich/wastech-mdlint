import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-size-"));
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

describe("SIZE-001 lines metric", () => {
  it("flags a file exceeding the lines error budget", async () => {
    const cwd = await fixtureRepo({ "a.md": "l1\nl2\nl3\nl4\n" });
    const result = await lint(cwd, [rule("SIZE-001", { lines: { error: 2 } })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      severity: "error",
      data: { metric: "lines", actual: 4, errorAt: 2 },
    });
  });
});

describe("SIZE-001 tokens metric", () => {
  it("flags a file exceeding the tokens warn budget", async () => {
    const cwd = await fixtureRepo({ "a.md": `${"x".repeat(40)}\n` });
    const result = await lint(cwd, [rule("SIZE-001", { tokens: { warn: 5 } })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      severity: "warning",
      data: { metric: "tokens", actual: 11, warnAt: 5 },
    });
  });
});

describe("SIZE-001 pass case", () => {
  it("reports nothing when every configured metric stays under budget", async () => {
    const cwd = await fixtureRepo({ "a.md": "short\n" });
    const result = await lint(cwd, [
      rule("SIZE-001", {
        bytes: { warn: 1000 },
        lines: { warn: 100 },
        tokens: { warn: 100 },
      }),
    ]);
    expect(result.messages).toEqual([]);
  });
});

describe("SIZE-001 threshold supersession (P11.13 / SC-2)", () => {
  it("reports one error finding, carrying both thresholds, when a metric crosses warn and error", async () => {
    const cwd = await fixtureRepo({ "a.md": "l1\nl2\nl3\nl4\n" });
    const result = await lint(cwd, [
      rule("SIZE-001", { lines: { warn: 2, error: 3 } }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      severity: "error",
      message: "File exceeds lines error budget: 4 lines > 3.",
      // The suppressed warn finding is lossless: `data` still names the crossed warn threshold.
      data: { metric: "lines", actual: 4, warnAt: 2, errorAt: 3 },
    });
  });

  it("reports one finding under a severity override that would collapse warn and error to the same severity", async () => {
    const cwd = await fixtureRepo({ "a.md": "l1\nl2\nl3\nl4\n" });
    const result = await lintFiles({
      cwd,
      config: { rules: [] },
      rules: [
        {
          rule: ruleRegistry.resolveRule("SIZE-001", {
            lines: { warn: 2, error: 3 },
          }),
          severity: "error",
        },
      ],
      settings: {},
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.severity).toBe("error");
  });

  it("still evaluates each metric independently", async () => {
    const cwd = await fixtureRepo({ "a.md": `${"x".repeat(40)}\nl2\n` });
    const result = await lint(cwd, [
      rule("SIZE-001", { lines: { error: 1 }, tokens: { warn: 5 } }),
    ]);
    expect(
      result.messages.map((message) => [
        message.data?.metric,
        message.severity,
      ]),
    ).toEqual([
      ["lines", "error"],
      ["tokens", "warning"],
    ]);
  });
});

describe("SIZE-001 overrides", () => {
  it("uses the first matching override in list order when multiple patterns match", async () => {
    const cwd = await fixtureRepo({ "special/a.md": `${"x".repeat(100)}\n` });
    const result = await lint(cwd, [
      rule("SIZE-001", {
        bytes: { error: 1000 },
        overrides: [
          { pattern: "special/**", bytes: { error: 10 } },
          { pattern: "**/*.md", bytes: { error: 20 } },
        ],
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({ errorAt: 10 });
  });

  it("falls back to the top-level threshold for a metric the matching override omits", async () => {
    const cwd = await fixtureRepo({ "special/a.md": "l1\nl2\nl3\nl4\n" });
    const result = await lint(cwd, [
      rule("SIZE-001", {
        lines: { error: 2 },
        overrides: [{ pattern: "special/**", bytes: { error: 999999 } }],
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      metric: "lines",
      errorAt: 2,
    });
  });
});
