import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError } from "../src/config/load.js";
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
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toBeInstanceOf(ConfigError);
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
    await expect(
      loadConfiguration({ cwd: process.cwd(), explicitConfigPath: "/nope/x.json", registry })
    ).rejects.toThrow(/Config file not found/);
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
