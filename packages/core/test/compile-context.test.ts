import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

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

  it("keeps a valid compile.skill even when other compile.* fields are malformed", async () => {
    // Finding: the lenient `config.compile` reader must default each malformed field
    // independently — a bad `outdir`/`hubMinInDegree`/`commandPreset` must not discard an
    // otherwise-valid `skill` block and fall through to an empty-frontmatter failure.
    const root = await fixtureRepo({ "a.md": "# A\n" });
    const config = loadedConfig({
      include: ["**/*.md"],
      compile: {
        skill: { name: "docs-skill", description: "Docs skill" },
        outdir: 123,
        hubMinInDegree: "not-a-number",
        commandPreset: "bogus-preset"
      }
    });

    const result = await compileContext(config, root);

    expect(result.skillContent).toContain('name: "docs-skill"');
    expect(result.skillContent).toContain('description: "Docs skill"');
    // Malformed `commandPreset` falls back to the host-neutral default rather than throwing.
    expect(result.skillContent).toContain("### Working with dependencies");
    expect(result.skillContent).not.toContain("!npx wastech-mdlint");
  });

  it("keeps a valid compile.skill.name when compile.skill.description is malformed", async () => {
    // Finding: parsing `compile.skill` as one nested object fails all-or-nothing, so a bad
    // `description` must not also drop an otherwise-valid `name`. A malformed `description` still
    // defaults to `""`, which S1 rejects (empty name/description) and throws — that part is
    // expected and unrelated to this finding. What matters is *which* field the resulting ZodError
    // blames: if `name` had also been wrongly reset to `""` by an all-or-nothing nested parse, the
    // same error would report a second issue for `name` too. Exactly one issue, for `description`
    // only, proves `name` was preserved.
    const root = await fixtureRepo({ "a.md": "# A\n" });
    const config = loadedConfig({
      include: ["**/*.md"],
      compile: { skill: { name: "docs-skill", description: 123 } }
    });

    await expect(compileContext(config, root)).rejects.toBeInstanceOf(ZodError);
    await expect(compileContext(config, root)).rejects.toMatchObject({
      issues: [{ path: ["description"] }]
    });
  });

  it("keeps valid compile.sections.* flags when a sibling flag is malformed", async () => {
    // Finding: parsing `compile.sections` as one nested object fails all-or-nothing, so a bad
    // `rules` flag must not reset every other section flag (`architecture: false` here) back to
    // its default `true`.
    const root = await fixtureRepo({ "a.md": "# A\n" });
    const config = loadedConfig({
      include: ["**/*.md"],
      compile: {
        skill: { name: "s", description: "d" },
        sections: { architecture: false, rules: "bogus", dependencies: true, workflow: false }
      }
    });

    const result = await compileContext(config, root);

    expect(result.skillContent).not.toContain("## Document Architecture");
    expect(result.skillContent).not.toContain("## Workflow");
    expect(result.skillContent).toContain("## Document Dependencies");
    // The malformed `rules` flag defaults to `true` on its own, independent of its siblings.
    expect(result.skillContent).toContain("## Document Rules");
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

  it.each([0, -1, 1.5])(
    "falls back to the default hubMinInDegree for a malformed value (%s)",
    async (hubMinInDegree) => {
      // Finding: `0`/negative/fractional thresholds are malformed for a node-count comparison
      // (`inDegree >= hubMinInDegree`) — they must default like every other malformed `compile.*`
      // field, not silently rewrite role classification.
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
      const malformedResult = await compileContext(
        loadedConfig({
          include: ["**/*.md"],
          compile: { skill: { name: "s", description: "d" }, hubMinInDegree }
        }),
        root
      );

      expect(malformedResult.skillContent).toBe(defaultResult.skillContent);
    }
  );

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
