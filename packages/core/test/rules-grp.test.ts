import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigError } from "../src/config/config-error.js";
import {
  loadConfiguration,
  type ConfiguredRule,
} from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { RuleResolutionError } from "../src/engine/registry.js";
import { ruleRegistry } from "../src/engine/rules/index.js";
import type { ResolvedSettings } from "../src/engine/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-grp-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    // Nested keys need their parent directory created, as `rules-size.test.ts` already does — the
    // any-depth entry-point cases below (`docs/README.md`) would otherwise ENOENT.
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

describe("GRP-001 cycles (reads the injected graph)", () => {
  it("detects and de-duplicates a dependency cycle", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "[a](a.md)\n",
    });
    const result = await lint(cwd, [rule("GRP-001")]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.ruleId).toBe("GRP-001");
    expect(result.messages[0]?.message).toContain("Dependency cycle detected");
  });

  it("reports nothing for an acyclic graph", async () => {
    const cwd = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });
    expect((await lint(cwd, [rule("GRP-001")])).messages).toEqual([]);
  });

  // The two edge-kind cases below are two-node cycles, so they opt out of the default
  // `minCycleLength` of 3 — they are about which edges close a cycle, not about the length filter.
  it("detects a cycle formed purely by @import edges (no links)", async () => {
    const cwd = await fixtureRepo({ "a.md": "@b.md\n", "b.md": "@a.md\n" });
    const result = await lint(cwd, [rule("GRP-001", { minCycleLength: 2 })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      cycle: ["a.md", "b.md", "a.md"],
    });
  });

  it("detects a cycle formed purely by id-ref edges when settings.idRef is configured", async () => {
    const cwd = await fixtureRepo({
      "a.md": "| ID |\n| --- |\n| REQ-1 |\n\nSee REQ-2 for context.\n",
      "b.md": "| ID |\n| --- |\n| REQ-2 |\n\nSee REQ-1 for context.\n",
    });
    const settings: ResolvedSettings = {
      idRef: {
        idPattern: "^REQ-\\d+$",
        definitions: ["a.md", "b.md"],
        idColumn: "ID",
      },
    };
    const result = await lint(
      cwd,
      [rule("GRP-001", { minCycleLength: 2 })],
      settings,
    );
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      cycle: ["a.md", "b.md", "a.md"],
    });
  });

  it("builds no id-ref edges (so reports no cycle) when settings.idRef is absent", async () => {
    const cwd = await fixtureRepo({
      "a.md": "| ID |\n| --- |\n| REQ-1 |\n\nSee REQ-2 for context.\n",
      "b.md": "| ID |\n| --- |\n| REQ-2 |\n\nSee REQ-1 for context.\n",
    });
    expect((await lint(cwd, [rule("GRP-001")])).messages).toEqual([]);
  });
});

// W-07: a README indexing a sibling that links back is a documentation shape, not a defect, and at
// `error` severity it failed builds. `minCycleLength` is what makes the two-node back-link and a
// longer chain distinguishable by configuration.
describe("GRP-001 minCycleLength (P13.04 / W-07)", () => {
  const MUTUAL_LINK = {
    "README.md": "See [a](a.md).\n",
    "a.md": "Back to [README](README.md).\n",
  };

  it("reports nothing for a two-document mutual link by default", async () => {
    const result = await lint(await fixtureRepo(MUTUAL_LINK), [
      rule("GRP-001"),
    ]);
    expect(result.messages).toEqual([]);
  });

  it("still reports a three-hop cycle at the same default", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "[a](a.md)\n",
    });
    const result = await lint(cwd, [rule("GRP-001")]);
    expect(result.messages.map((message) => message.data?.cycle)).toEqual([
      ["a.md", "b.md", "c.md", "a.md"],
    ]);
  });

  it("restores the two-document finding when minCycleLength is 2", async () => {
    const result = await lint(await fixtureRepo(MUTUAL_LINK), [
      rule("GRP-001", { minCycleLength: 2 }),
    ]);
    expect(result.messages.map((message) => message.data?.cycle)).toEqual([
      ["README.md", "a.md", "README.md"],
    ]);
  });

  it("suppresses a four-hop cycle when minCycleLength exceeds it", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "[d](d.md)\n",
      "d.md": "[a](a.md)\n",
    });
    expect(
      (await lint(cwd, [rule("GRP-001", { minCycleLength: 5 })])).messages,
    ).toEqual([]);
    expect(
      (await lint(cwd, [rule("GRP-001", { minCycleLength: 4 })])).messages,
    ).toHaveLength(1);
  });

  it("rejects a minCycleLength below 2, which no cycle can be shorter than", () => {
    let thrown: unknown;
    try {
      ruleRegistry.resolveRule("GRP-001", { minCycleLength: 1 });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuleResolutionError);
    expect((thrown as RuleResolutionError).code).toBe("INVALID_OPTIONS");
  });
});

describe("GRP-002 orphans", () => {
  it("flags documents with no incoming references except entry points", async () => {
    const cwd = await fixtureRepo({
      "index.md": "[a](a.md)\n",
      "a.md": "# A\n",
      "orphan.md": "# Orphan\n",
    });
    const result = await lint(cwd, [
      rule("GRP-002", { entryPoints: ["index.md"] }),
    ]);
    expect(result.messages.map((message) => message.filePath)).toEqual([
      "orphan.md",
    ]);
  });

  it("prunes an excluded orphan from the report while it still contributes its outgoing edge", async () => {
    // a.md is reachable only from draft.md, so the two halves are separable: `exclude` scopes
    // reporting, not the corpus-wide graph — the reason the option survived P11.13's removal.
    const files = {
      "index.md": "# Index\n",
      "a.md": "# A\n",
      "draft.md": "[a](a.md)\n",
    };
    const withoutExclude = await lint(await fixtureRepo(files), [
      rule("GRP-002", { entryPoints: ["index.md"] }),
    ]);
    expect(withoutExclude.messages.map((message) => message.filePath)).toEqual([
      "draft.md",
    ]);

    const withExclude = await lint(await fixtureRepo(files), [
      rule("GRP-002", { entryPoints: ["index.md"], exclude: ["draft.md"] }),
    ]);
    // draft.md silenced; a.md still non-orphan because the excluded file's edge survives.
    expect(withExclude.messages).toEqual([]);

    // Same outcome with a `files` list beside it — `exclude` wins over `files` (C1), so the pairing
    // cannot be what makes the filtering work (audit L-4: the exclude-only path above is the one M-2
    // proved could rot untested).
    const withBoth = await lint(await fixtureRepo(files), [
      rule("GRP-002", {
        entryPoints: ["index.md"],
        files: ["**/*.md"],
        exclude: ["draft.md"],
      }),
    ]);
    expect(withBoth.messages).toEqual([]);
  });

  // W-05: with no `entryPoints` the exemption used to be skipped entirely, so a repository's own
  // roots were 55% of the noise that gets a rule disabled.
  it("exempts the default entry points when no entryPoints are configured", async () => {
    const cwd = await fixtureRepo({
      "README.md": "# Readme\n",
      "CLAUDE.md": "# Claude\n",
      "AGENTS.md": "# Agents\n",
      "index.md": "# Index\n",
      "orphan.md": "# Orphan\n",
    });
    const result = await lint(cwd, [rule("GRP-002")]);
    expect(result.messages.map((message) => message.filePath)).toEqual([
      "orphan.md",
    ]);
  });

  // The task requires this be verified rather than assumed: the defaults are slash-free, and
  // `normalizeConfigGlob` turns a slash-free entry into `**/<name>`, so they exempt at any depth.
  it("exempts a nested README/AGENTS through the default patterns' any-depth anchoring", async () => {
    const cwd = await fixtureRepo({
      "docs/README.md": "# Docs\n",
      "packages/x/AGENTS.md": "# Agents\n",
      "docs/guide/index.md": "# Guide\n",
      "docs/stray.md": "# Stray\n",
    });
    const result = await lint(cwd, [rule("GRP-002")]);
    expect(result.messages.map((message) => message.filePath)).toEqual([
      "docs/stray.md",
    ]);
  });

  it("replaces the default entry points rather than extending them when entryPoints is set", async () => {
    const cwd = await fixtureRepo({
      "README.md": "# Readme\n",
      "roots.md": "# Roots\n",
    });
    const result = await lint(cwd, [
      rule("GRP-002", { entryPoints: ["roots.md"] }),
    ]);
    expect(result.messages.map((message) => message.filePath)).toEqual([
      "README.md",
    ]);
  });

  it("names the entryPoints option in the finding, not just the outcome", async () => {
    const cwd = await fixtureRepo({ "orphan.md": "# Orphan\n" });
    const result = await lint(cwd, [rule("GRP-002")]);
    expect(result.messages[0]?.message).toBe(
      "orphan.md has no incoming references; link it from another document or add it to GRP-002's `entryPoints`.",
    );
  });

  it("counts an anchor edge as an incoming reference, not just a plain link", async () => {
    const cwd = await fixtureRepo({
      "index.md": "[a](a.md)\n",
      "a.md": "[see detail](detail.md#detail-heading)\n",
      "detail.md": "## Detail Heading\n",
    });
    const result = await lint(cwd, [
      rule("GRP-002", { entryPoints: ["index.md"] }),
    ]);
    expect(result.messages).toEqual([]);
  });
});

describe("GRP option schemas (P11.13 / SC-1)", () => {
  function resolutionError(id: string, options: unknown): RuleResolutionError {
    let thrown: unknown;
    try {
      ruleRegistry.resolveRule(id, options);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuleResolutionError);
    return thrown as RuleResolutionError;
  }

  it("resolves GRP-001 with no options at all", () => {
    expect(ruleRegistry.resolveRule("GRP-001", {}).id).toBe("GRP-001");
    expect(ruleRegistry.resolveRule("GRP-001", undefined).id).toBe("GRP-001");
  });

  // The dead keys are gone rather than silently ignored, so a config carrying one now fails loudly.
  it.each(["siteRouter", "files", "exclude"])(
    "rejects the removed GRP-001 option %s",
    (key) => {
      const error = resolutionError("GRP-001", {
        [key]: key === "siteRouter" ? { preset: "starlight" } : ["x"],
      });
      expect(error.code).toBe("INVALID_OPTIONS");
      expect(JSON.stringify(error.issues)).toContain(key);
    },
  );

  it("rejects the removed GRP-002 siteRouter option but keeps entryPoints/files/exclude", () => {
    expect(
      resolutionError("GRP-002", { siteRouter: { preset: "starlight" } }).code,
    ).toBe("INVALID_OPTIONS");
    expect(
      ruleRegistry.resolveRule("GRP-002", {
        entryPoints: ["index.md"],
        files: ["docs/**"],
        exclude: ["docs/drafts/**"],
      }).id,
    ).toBe("GRP-002");
  });

  // The acceptance criterion at the config boundary: the removed key is a load-time CONFIG_INVALID
  // (via the default real registry), not a silently ignored option.
  it("fails config loading with CONFIG_INVALID when GRP-001 carries a removed option", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          { rule: "GRP-001", options: { siteRouter: { preset: "starlight" } } },
        ],
      }),
    });

    const error = await loadConfiguration({ cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    // Zod's unrecognized-key wording is not pinned; the offending key name is.
    expect((error as ConfigError).message).toMatch(
      /rules\[0\]\.options:.*siteRouter/,
    );
  });
});

describe("GRP-003 ID chain across stages", () => {
  it("flags a stage id that is not carried into the next stage", async () => {
    const cwd = await fixtureRepo({
      "reqs.md": "| ID |\n| --- |\n| REQ-1 |\n| REQ-2 |\n",
      "design.md": "| Requirement |\n| --- |\n| REQ-1 |\n",
    });
    const result = await lint(cwd, [
      rule("GRP-003", {
        chain: [
          {
            stage: "requirements",
            files: ["reqs.md"],
            idColumn: "ID",
            refColumn: "ID",
          },
          { stage: "design", files: ["design.md"], refColumn: "Requirement" },
        ],
        idPattern: "^REQ-\\d+$",
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      id: "REQ-2",
      fromStage: "requirements",
      toStage: "design",
    });
  });

  it("checks every adjacent stage pair independently, skipping a stage whose idColumn is omitted", async () => {
    const cwd = await fixtureRepo({
      "reqs.md": "| ID |\n| --- |\n| REQ-1 |\n| REQ-2 |\n",
      "design.md": "| Requirement |\n| --- |\n| REQ-1 |\n",
    });
    const result = await lint(cwd, [
      rule("GRP-003", {
        chain: [
          {
            stage: "requirements",
            files: ["reqs.md"],
            idColumn: "ID",
            refColumn: "ID",
          },
          { stage: "design", files: ["design.md"], refColumn: "Requirement" },
          { stage: "tests", files: ["tests.md"], refColumn: "Design" },
        ],
        idPattern: "^REQ-\\d+$",
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      id: "REQ-2",
      fromStage: "requirements",
      toStage: "design",
    });
  });
});
