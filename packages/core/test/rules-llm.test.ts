import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";
import { estimateTokens, TOKEN_ESTIMATE_NOTE } from "../src/engine/tokens.js";
import type { ResolvedSettings } from "../src/engine/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
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

async function lint(
  cwd: string,
  rules: ConfiguredRule[],
  settings: ResolvedSettings = {},
) {
  return lintFiles({ cwd, config: { rules: [] }, rules, settings });
}

describe("SIZE-001 line and token metrics", () => {
  it("flags line and token budgets independently", async () => {
    const cwd = await fixtureRepo({ "a.md": `${"line\n".repeat(10)}` });
    const result = await lint(cwd, [
      rule("SIZE-001", { lines: { error: 5 }, tokens: { warn: 2 } }),
    ]);
    const metrics = result.messages
      .map((message) => `${message.data?.metric}:${message.severity}`)
      .sort();
    expect(metrics).toEqual(["lines:error", "tokens:warning"]);
  });
});

describe("LLM-001 eager-import budget", () => {
  it("flags an entrypoint whose own + imported tokens exceed the budget", async () => {
    const cwd = await fixtureRepo({
      "CLAUDE.md": `Preamble @docs/big.md\n`,
      "docs/big.md": `${"x".repeat(400)}\n`,
    });
    const result = await lint(cwd, [
      rule("LLM-001", {
        entrypoints: ["CLAUDE.md"],
        maxTokensPerEntrypoint: 50,
      }),
    ]);
    const overBudget = result.messages.find((message) =>
      message.message.includes("over context budget"),
    );
    expect(overBudget).toMatchObject({ filePath: "CLAUDE.md" });
    expect(overBudget?.data).toMatchObject({ maxTokens: 50 });
    // The budget finding quotes an estimated token count, so it discloses the estimate.
    expect(overBudget?.message).toContain(TOKEN_ESTIMATE_NOTE);
  });

  it("reports a missing eager import", async () => {
    const cwd = await fixtureRepo({ "CLAUDE.md": "See @docs/missing.md\n" });
    const result = await lint(cwd, [
      rule("LLM-001", {
        entrypoints: ["CLAUDE.md"],
        maxTokensPerEntrypoint: 100000,
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toMatch(
      /Missing eager import @docs\/missing\.md/,
    );
    // A missing import names no token count, so the calibration would be a non-sequitur here.
    expect(result.messages[0]?.message).not.toContain(TOKEN_ESTIMATE_NOTE);
  });

  it("detects an eager-import cycle", async () => {
    const cwd = await fixtureRepo({
      "CLAUDE.md": "@a.md\n",
      "a.md": "@b.md\n",
      "b.md": "@a.md\n",
    });
    const result = await lint(cwd, [
      rule("LLM-001", {
        entrypoints: ["CLAUDE.md"],
        maxTokensPerEntrypoint: 100000,
      }),
    ]);
    expect(
      result.messages.some((message) =>
        message.message.includes("Eager import cycle detected"),
      ),
    ).toBe(true);
  });

  it("resolves a routed root-relative eager import through settings.siteRouter", async () => {
    // Regression pin: LLM-001's resolver now reuses `resolveTargetCandidates`
    // instead of an ad hoc slash-strip, so a root-relative import under a configured `siteRouter`
    // must resolve to the router's candidate — asserted here directly against the rule, not just
    // via a compile-vs-lint parity check that could pass if both sides drifted the same wrong way.
    const entrypointContent = "# Entry\n@/big.md\n";
    const importedContent = `${"x".repeat(400)}\n`;
    const cwd = await fixtureRepo({
      "src/content/docs/entry.md": entrypointContent,
      // Under the starlight preset, `@/big.md`'s route path is "big.md" (imports always carry a
      // literal `.md` suffix), whose first router candidate is `<contentDir>/big.md.md`.
      "src/content/docs/big.md.md": importedContent,
    });
    const siteRouter = { preset: "starlight", contentDir: "src/content/docs" };

    const result = await lint(
      cwd,
      [
        rule("LLM-001", {
          entrypoints: ["src/content/docs/entry.md"],
          maxTokensPerEntrypoint: 50,
        }),
      ],
      { siteRouter },
    );

    const overBudget = result.messages.find((message) =>
      message.message.includes("over context budget"),
    );
    expect(overBudget).toMatchObject({ filePath: "src/content/docs/entry.md" });
    expect(overBudget?.data).toMatchObject({
      totalTokens:
        estimateTokens(entrypointContent) + estimateTokens(importedContent),
      maxTokens: 50,
      importedFiles: 1,
    });
    expect(
      result.messages.some((message) =>
        message.message.includes("Missing eager import"),
      ),
    ).toBe(false);
  });

  it("reports a missing eager import when a routed root-relative target has no router candidate on disk", async () => {
    const cwd = await fixtureRepo({
      "src/content/docs/entry.md": "@/missing.md\n",
    });
    const siteRouter = { preset: "starlight", contentDir: "src/content/docs" };

    const result = await lint(
      cwd,
      [
        rule("LLM-001", {
          entrypoints: ["src/content/docs/entry.md"],
          maxTokensPerEntrypoint: 100000,
        }),
      ],
      { siteRouter },
    );

    expect(result.messages).toHaveLength(1);
    // Pin the exact routed fallback path (first starlight candidate), not just the message prefix
    // — a regression back to the old ad hoc slash-strip resolver would resolve to a different path
    // ("missing.md") and still match a prefix-only assertion.
    expect(result.messages[0]?.message).toBe(
      "Missing eager import @/missing.md; resolved to src/content/docs/missing.md.md.",
    );
    expect(result.messages[0]?.data).toMatchObject({
      targetPath: "src/content/docs/missing.md.md",
    });
  });

  // Import targets resolve relative to the *source* file's directory, so files inside `shared/`
  // import their siblings by bare name.
  const SHARED_SUBTREE = {
    "shared/hub.md": "# Hub\n@missing.md\n@loop.md\n",
    "shared/loop.md": "# Loop\n@hub.md\n",
  };

  // Findings rendered as `path:line message` so a dedup assertion can pin count, identity, and
  // order in one `toEqual` instead of counting matches of a substring.
  function renderMessages(
    messages: { filePath: string; line: number; message: string }[],
  ): string[] {
    return messages.map(
      (message) => `${message.filePath}:${message.line} ${message.message}`,
    );
  }

  it("reports a diagnostic in a shared import subtree once per identity, not once per entrypoint", async () => {
    // Regression fixture for the dedup contract: both entrypoints reach `shared/hub.md`,
    // so each traversal re-derives the same missing import and the same cycle.
    const cwd = await fixtureRepo({
      "one.md": "# One\n@shared/hub.md\n",
      "two.md": "# Two\n@shared/hub.md\n",
      ...SHARED_SUBTREE,
    });

    const result = await lint(cwd, [
      rule("LLM-001", {
        entrypoints: ["one.md", "two.md"],
        maxTokensPerEntrypoint: 100000,
      }),
    ]);

    // The whole list, not a filtered count — this pins emission count *and* order together.
    expect(renderMessages(result.messages)).toEqual([
      "shared/hub.md:2 Missing eager import @missing.md; resolved to shared/missing.md.",
      "shared/loop.md:2 Eager import cycle detected: shared/hub.md -> shared/loop.md -> shared/hub.md.",
    ]);
  });

  it("emits the same findings regardless of which entrypoint reaches the subtree first", async () => {
    // `shared/hub.md` is both an entrypoint and a node inside the other entrypoint's closure, so
    // renaming the root flips sorted traversal order around it. Identical output either way is what
    // makes "the retained finding does not depend on entrypoint order" observable.
    const runs = await Promise.all(
      ["a-entry.md", "z-entry.md"].map(async (rootName) => {
        const cwd = await fixtureRepo({
          [rootName]: "# Root\n@shared/hub.md\n",
          ...SHARED_SUBTREE,
        });
        const result = await lint(cwd, [
          rule("LLM-001", {
            entrypoints: [rootName, "shared/hub.md"],
            maxTokensPerEntrypoint: 100000,
          }),
        ]);
        return renderMessages(result.messages);
      }),
    );

    const expected = [
      "shared/hub.md:2 Missing eager import @missing.md; resolved to shared/missing.md.",
      "shared/loop.md:2 Eager import cycle detected: shared/hub.md -> shared/loop.md -> shared/hub.md.",
    ];
    expect(runs).toEqual([expected, expected]);
  });

  it("keeps one budget finding per entrypoint when entrypoints share an imported file", async () => {
    // Over-dedup guard: budget findings are per entrypoint by definition, so routing them through
    // the same identity map must stay a no-op even when the closures are identical.
    const cwd = await fixtureRepo({
      "one.md": "# One\n@shared/big.md\n",
      "two.md": "# Two\n@shared/big.md\n",
      "shared/big.md": `${"x".repeat(400)}\n`,
    });

    const result = await lint(cwd, [
      rule("LLM-001", {
        entrypoints: ["one.md", "two.md"],
        maxTokensPerEntrypoint: 50,
      }),
    ]);

    expect(
      result.messages.every((message) =>
        message.message.includes("over context budget"),
      ),
    ).toBe(true);
    expect(result.messages.map((message) => message.filePath)).toEqual([
      "one.md",
      "two.md",
    ]);
  });

  it("keeps a cycle closed at a different import edge as its own finding", async () => {
    // The same two-file loop entered from `a.md` vs `b.md` closes on a different import edge, so it
    // is a different file and line the user has to fix. Dedup is by location + message precisely so
    // these two are not collapsed into one report that names only half the loop.
    const cwd = await fixtureRepo({
      "one.md": "# One\n@a.md\n",
      "two.md": "# Two\n@b.md\n",
      "a.md": "# A\n@b.md\n",
      "b.md": "# B\n@a.md\n",
    });

    const result = await lint(cwd, [
      rule("LLM-001", {
        entrypoints: ["one.md", "two.md"],
        maxTokensPerEntrypoint: 100000,
      }),
    ]);

    expect(renderMessages(result.messages)).toEqual([
      "a.md:2 Eager import cycle detected: b.md -> a.md -> b.md.",
      "b.md:2 Eager import cycle detected: a.md -> b.md -> a.md.",
    ]);
  });
});
