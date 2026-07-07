import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LintConfig } from "../src/config/config-schema.js";
import type { LoadedConfiguration } from "../src/config/load-config.js";
import { compileContext, CompileConfigMissingError } from "../src/compile/compile-context.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-compile-context-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

function loadedConfig(config: LintConfig): LoadedConfiguration {
  return { config, rules: [], settings: config.settings ?? {} };
}

describe("compileContext", () => {
  it("throws CompileConfigMissingError when config.compile is absent", async () => {
    const root = await fixtureRepo({ "a.md": "# A\n" });
    const config = loadedConfig({ include: ["**/*.md"] });

    await expect(compileContext(config, root)).rejects.toBeInstanceOf(CompileConfigMissingError);
    await expect(compileContext(config, root)).rejects.toMatchObject({ code: "COMPILE_CONFIG_MISSING" });
  });

  it("compiles a minimal fixture into a valid CompileResult", async () => {
    const root = await fixtureRepo({ "a.md": "# A\n[b](b.md)\n", "b.md": "# B\n" });
    const config = loadedConfig({
      include: ["**/*.md"],
      compile: { skill: { name: "docs-skill", description: "Docs skill" } }
    });

    const result = await compileContext(config, root);

    expect(result.metadata.documentCount).toBe(2);
    expect(result.skillContent).toContain('name: "docs-skill"');
    expect(result.skillContent).toContain('description: "Docs skill"');
  });

  it("threads compile.hubMinInDegree through to role classification", async () => {
    // Same fixture shape as P5.01's own hub-threshold test: three files link to `bridge.md`
    // (inDegree 3), which is the default `hubMinInDegree` boundary.
    const root = await fixtureRepo({
      "a.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "b.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "bridge.md": "[sink](sink.md)\n",
      "c.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "leaf.md": "# Leaf\n",
      "sink.md": "# Sink\n"
    });

    const defaultResult = await compileContext(
      loadedConfig({ include: ["**/*.md"], compile: { skill: { name: "s", description: "d" } } }),
      root
    );
    const raisedThreshold = await compileContext(
      loadedConfig({
        include: ["**/*.md"],
        compile: { skill: { name: "s", description: "d" }, hubMinInDegree: 4 }
      }),
      root
    );

    expect(defaultResult.skillContent).toContain("| bridge.md | hub | narrative |");
    expect(raisedThreshold.skillContent).toContain("| bridge.md | bridge | narrative |");
  });

  it("names an over-budget entrypoint in the Context Budget section", async () => {
    const root = await fixtureRepo({
      "CLAUDE.md": "Preamble @docs/big.md\n",
      "docs/big.md": `${"x".repeat(400)}\n`
    });
    const config = loadedConfig({
      include: ["**/*.md"],
      compile: { skill: { name: "s", description: "d" } },
      rules: [{ rule: "LLM-001", options: { entrypoints: ["CLAUDE.md"], maxTokensPerEntrypoint: 50 } }]
    });

    const result = await compileContext(config, root);

    expect(result.skillContent).toContain("`CLAUDE.md`:");
    expect(result.skillContent).toContain("exceeds 50");
  });

  it("uses the strictest matching LLM-001 threshold when multiple entries target the same file", async () => {
    // Finding: `rules[]` may configure LLM-001 more than once, and the engine evaluates every
    // entry independently — a later, stricter entry for the same file must not be silently
    // shadowed by an earlier, looser one that "claims" the entrypoint first.
    const root = await fixtureRepo({ "CLAUDE.md": "# Claude\n" });
    const config = loadedConfig({
      include: ["**/*.md"],
      compile: { skill: { name: "s", description: "d" } },
      rules: [
        { rule: "LLM-001", options: { entrypoints: ["CLAUDE.md"], maxTokensPerEntrypoint: 100000 } },
        { rule: "LLM-001", options: { entrypoints: ["CLAUDE.md"], maxTokensPerEntrypoint: 1 } }
      ]
    });

    const result = await compileContext(config, root);

    expect(result.skillContent).toContain("`CLAUDE.md`:");
    expect(result.skillContent).toContain("exceeds 1");
    // Exactly one rendered row for the file, even though two entries matched it.
    expect(result.skillContent.match(/`CLAUDE\.md`:/g)).toHaveLength(1);
  });

  it("computes the same eager-import total as LLM-001 lint for a routed root-relative import", async () => {
    // Finding: LLM-001's own traversal and compile's graph-based budget must resolve a
    // root-relative eager import identically under a configured `siteRouter`, or the two can
    // silently disagree on what an entrypoint eagerly imports and report different totals.
    const root = await fixtureRepo({
      "src/content/docs/entry.md": "# Entry\n@/big.md\n",
      // Under the starlight preset, `@/big.md`'s route path is "big.md" (imports always carry a
      // literal `.md` suffix), whose first router candidate is `<contentDir>/big.md.md` — an
      // unusual but valid repo-relative path, chosen deliberately so this fixture only resolves
      // through real router candidate generation, not a coincidental leading-slash strip.
      "src/content/docs/big.md.md": `${"x".repeat(400)}\n`
    });
    const siteRouter = { preset: "starlight", contentDir: "src/content/docs" };
    const entrypoints = ["src/content/docs/entry.md"];
    const maxTokensPerEntrypoint = 50;

    const lintResult = await lintFiles({
      cwd: root,
      config: { include: ["**/*.md"] },
      rules: [{ rule: ruleRegistry.resolveRule("LLM-001", { entrypoints, maxTokensPerEntrypoint }) }],
      settings: { siteRouter }
    });
    const overBudget = lintResult.messages.find((message) => message.message.includes("over context budget"));
    const lintTotalTokens = overBudget?.data?.totalTokens;

    const config = loadedConfig({
      include: ["**/*.md"],
      compile: { skill: { name: "s", description: "d" } },
      settings: { siteRouter },
      rules: [{ rule: "LLM-001", options: { entrypoints, maxTokensPerEntrypoint } }]
    });
    const compileResult = await compileContext(config, root);

    expect(typeof lintTotalTokens).toBe("number");
    expect(compileResult.skillContent).toContain(
      `\`src/content/docs/entry.md\`: ${lintTotalTokens} estimated tokens exceeds 50`
    );
  });

  it("reports a truthful zero-match budget state when LLM-001 is enabled but its glob matches nothing", async () => {
    // Finding: an active LLM-001 rule whose `entrypoints` glob matches zero corpus files must not
    // be reported as "LLM-001 not enabled" — it is enabled, just misconfigured or aimed at a file
    // that doesn't exist in this corpus.
    const root = await fixtureRepo({ "a.md": "# A\n" });
    const config = loadedConfig({
      include: ["**/*.md"],
      compile: { skill: { name: "s", description: "d" } },
      rules: [{ rule: "LLM-001", options: { entrypoints: ["missing-entrypoint.md"], maxTokensPerEntrypoint: 50 } }]
    });

    const result = await compileContext(config, root);

    expect(result.skillContent).toContain(
      "LLM-001 is enabled, but its configured entrypoints matched no files in this corpus."
    );
    expect(result.skillContent).not.toContain("No entrypoints configured (LLM-001 not enabled).");
  });

  it("is deterministic across repeated calls on the same fixture", async () => {
    const root = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });
    const config = loadedConfig({ include: ["**/*.md"], compile: { skill: { name: "s", description: "d" } } });

    const first = await compileContext(config, root);
    const second = await compileContext(config, root);

    expect(first).toEqual(second);
  });

  it("computes the corpus token estimate against a CJK document's exact character count", async () => {
    // D3's estimator (Math.ceil(text.length / 4)) counts UTF-16 code units, not UTF-8 bytes.
    // `expected` is computed from that locked formula directly against the literal fixture
    // string — not by calling `estimateTokens` itself — so a future regression to a byte-based
    // measure changes only the code under test, not this assertion's expectation, and the test
    // still catches the drift instead of moving in lockstep with it.
    const fileContent = `# 概要\n\n${"日本語のテスト文章です。".repeat(5)}\n`;
    const root = await fixtureRepo({ "doc.md": fileContent });
    const config = loadedConfig({
      include: ["**/*.md"],
      compile: { skill: { name: "概要スキル", description: "日本語の説明文です" } }
    });

    const result = await compileContext(config, root);
    const expected = Math.ceil(fileContent.length / 4);

    expect(expected).toBe(17);
    expect(result.skillContent).toContain(`Corpus token estimate: ${expected} tokens.`);
  });

  it("compiles an empty corpus without throwing", async () => {
    const root = await fixtureRepo({});
    const config = loadedConfig({
      include: ["**/*.md"],
      compile: { skill: { name: "s", description: "d" } }
    });

    const result = await compileContext(config, root);

    expect(result.metadata.documentCount).toBe(0);
    expect(result.skillContent).toContain("(no documents found)");
  });

  it("passes compile.sections and compile.commandPreset through to the rendered output", async () => {
    const root = await fixtureRepo({ "a.md": "# A\n" });
    const config = loadedConfig({
      include: ["**/*.md"],
      compile: {
        skill: { name: "s", description: "d" },
        sections: { architecture: false, rules: true, dependencies: true, workflow: false },
        commandPreset: "claude"
      }
    });

    const result = await compileContext(config, root);

    expect(result.skillContent).not.toContain("## Document Architecture");
    expect(result.skillContent).not.toContain("## Workflow");
    expect(result.skillContent).toContain("!npx wastech-mdlint impact $ARGUMENTS");
  });
});
