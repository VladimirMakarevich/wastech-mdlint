import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError } from "../src/config/config-error.js";
import { findConfig } from "../src/config/find-config.js";
import { loadConfiguration } from "../src/config/load-config.js";
import { defineRule, RuleRegistry } from "../src/engine/registry.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const registry = new RuleRegistry([
  defineRule({
    metadata: {
      id: "REF-001",
      category: "REF",
      description: "links resolve",
      defaultSeverity: "error",
      scope: "document",
      fixable: false
    },
    optionsSchema: z.object({ exclude: z.array(z.string()).optional() }).strict(),
    check: () => () => {}
  }),
  defineRule({
    metadata: {
      id: "SIZE-001",
      category: "SIZE",
      description: "size budget",
      defaultSeverity: "warning",
      scope: "document",
      fixable: false
    },
    optionsSchema: z.object({ maxBytes: z.number().int().positive() }).strict(),
    check: () => () => {}
  })
]);

async function writeConfig(contents: string, fileName = "wastech-mdlint.config.json"): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-config-"));
  tempDirs.push(root);
  await writeFile(path.join(root, fileName), contents, "utf8");
  return root;
}

describe("loadConfiguration", () => {
  it("parses JSONC with comments and trailing commas (C4)", async () => {
    const root = await writeConfig(
      [
        "{",
        '  // a comment',
        '  "include": ["docs/**/*.md"],',
        '  "rules": [',
        '    { "rule": "ref-001", "severity": "warning" }, // trailing comma next',
        "  ],",
        "}"
      ].join("\n")
    );

    const loaded = await loadConfiguration({ cwd: root, registry });

    expect(loaded.config.include).toEqual(["docs/**/*.md"]);
    expect(loaded.rules).toHaveLength(1);
    expect(loaded.rules[0]?.rule.id).toBe("REF-001");
    expect(loaded.rules[0]?.severity).toBe("warning");
  });

  it("resolves settings and exposes them (C5)", async () => {
    const root = await writeConfig(
      JSON.stringify({
        settings: { siteRouter: { preset: "starlight", contentDir: "src/content/docs" } },
        rules: []
      })
    );

    const loaded = await loadConfiguration({ cwd: root, registry });
    expect(loaded.settings.siteRouter).toEqual({ preset: "starlight", contentDir: "src/content/docs" });
  });

  it("resolves settings.idRef and exposes it for the graph builder (P4.06)", async () => {
    const root = await writeConfig(
      JSON.stringify({
        settings: { idRef: { idPattern: "^REQ-\\d+$", definitions: ["reqs.md"], idColumn: "ID" } },
        rules: []
      })
    );

    const loaded = await loadConfiguration({ cwd: root, registry });
    expect(loaded.settings.idRef).toEqual({ idPattern: "^REQ-\\d+$", definitions: ["reqs.md"], idColumn: "ID" });
  });

  it("rejects a malformed settings.idRef missing idColumn (C7)", async () => {
    const root = await writeConfig(
      JSON.stringify({
        settings: { idRef: { idPattern: "^REQ-\\d+$", definitions: ["reqs.md"] } },
        rules: []
      })
    );

    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(/idColumn/);
  });

  it("rejects unknown top-level keys (C7)", async () => {
    const root = await writeConfig(JSON.stringify({ nonsense: true, rules: [] }));
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(/nonsense/);
  });

  it("reports an unknown rule with a did-you-mean suggestion", async () => {
    const root = await writeConfig(JSON.stringify({ rules: [{ rule: "REF-009" }] }));
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /rules\[0\]: Unknown rule "REF-009"\. Did you mean "REF-001"\?/
    );
  });

  it("reports bad rule options with a path-prefixed error", async () => {
    const root = await writeConfig(JSON.stringify({ rules: [{ rule: "SIZE-001", options: { maxBytes: -1 } }] }));
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /rules\[0\]\.options\.maxBytes:/
    );
  });

  it("throws on invalid JSONC", async () => {
    const root = await writeConfig("{ not valid ");
    // The structured code/hint (M6) accompany the message so an MCP host can render the error
    // contract without re-classifying it.
    const error = await loadConfiguration({ cwd: root, registry }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).hint).toBeTruthy();
  });

  it("returns a zero-config default when no config is found", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-noconfig-"));
    tempDirs.push(root);
    const loaded = await loadConfiguration({ cwd: root, registry });
    expect(loaded.configPath).toBeUndefined();
    expect(loaded.config.include).toEqual(["**/*.md"]);
    expect(loaded.rules).toEqual([]);
  });

  it("errors when an explicit --config path does not exist", async () => {
    const error = await loadConfiguration({
      cwd: process.cwd(),
      explicitConfigPath: "/nope/x.json",
      registry
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toMatch(/Config file not found/);
    expect((error as ConfigError).code).toBe("CONFIG_NOT_FOUND");
    expect((error as ConfigError).hint).toBeTruthy();
  });
});

describe("compile config (P5.05)", () => {
  it("accepts a fully-populated valid compile section", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [],
        compile: {
          outdir: ".claude/skills/wastech-mdlint",
          skill: { name: "docs-skill", description: "Docs skill" },
          sections: { architecture: true, rules: true, dependencies: false, workflow: true },
          commandPreset: "claude",
          hubMinInDegree: 5
        }
      })
    );

    const loaded = await loadConfiguration({ cwd: root, registry });
    expect(loaded.config.compile).toEqual({
      outdir: ".claude/skills/wastech-mdlint",
      skill: { name: "docs-skill", description: "Docs skill" },
      sections: { architecture: true, rules: true, dependencies: false, workflow: true },
      commandPreset: "claude",
      hubMinInDegree: 5
    });
  });

  it("rejects compile: {} for missing skill", async () => {
    const root = await writeConfig(JSON.stringify({ rules: [], compile: {} }));
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(/compile\.skill/);
  });

  it("rejects an empty compile.skill.name", async () => {
    const root = await writeConfig(
      JSON.stringify({ rules: [], compile: { skill: { name: "", description: "d" } } })
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(/compile\.skill\.name/);
  });

  it("rejects an empty compile.skill.description", async () => {
    const root = await writeConfig(
      JSON.stringify({ rules: [], compile: { skill: { name: "s", description: "" } } })
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(/compile\.skill\.description/);
  });

  it.each([0, -1, 1.5])("rejects a hubMinInDegree of %s", async (hubMinInDegree) => {
    const root = await writeConfig(
      JSON.stringify({ rules: [], compile: { skill: { name: "s", description: "d" }, hubMinInDegree } })
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(/compile\.hubMinInDegree/);
  });

  it("rejects an unknown compile.commandPreset value", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [],
        compile: { skill: { name: "s", description: "d" }, commandPreset: "bogus-preset" }
      })
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(/compile\.commandPreset/);
  });

  it("rejects a non-boolean compile.sections.rules", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [],
        compile: { skill: { name: "s", description: "d" }, sections: { rules: "bogus" } }
      })
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(/compile\.sections\.rules/);
  });

  it("rejects an unknown compile.* key (C7)", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [],
        compile: { skill: { name: "s", description: "d" }, bogus: true }
      })
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(/config\.compile:.*"bogus"/);
  });
});

describe("findConfig", () => {
  it("walks up parent directories to locate the config", async () => {
    const root = await writeConfig(JSON.stringify({ rules: [] }));
    const nested = path.join(root, "a", "b", "c");
    await mkdir(nested, { recursive: true });

    const found = await findConfig(nested);
    expect(found).toBe(path.join(root, "wastech-mdlint.config.json"));
  });

  it("returns undefined when no config exists up to the FS root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-empty-"));
    tempDirs.push(root);
    expect(await findConfig(root)).toBeUndefined();
  });
});
