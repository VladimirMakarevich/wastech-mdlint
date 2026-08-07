import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ConfigError } from "../src/config/config-error.js";
import { findConfig } from "../src/config/find-config.js";
import { loadConfiguration } from "../src/config/load-config.js";
import { defineRule, RuleRegistry } from "../src/engine/registry.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const registry = new RuleRegistry([
  defineRule({
    metadata: {
      id: "REF-001",
      category: "REF",
      description: "links resolve",
      defaultSeverity: "error",
      scope: "document",
      fixable: false,
    },
    optionsSchema: z
      .object({ exclude: z.array(z.string()).optional() })
      .strict(),
    check: () => () => {},
  }),
  defineRule({
    metadata: {
      id: "SIZE-001",
      category: "SIZE",
      description: "size budget",
      defaultSeverity: "warning",
      scope: "document",
      fixable: false,
    },
    optionsSchema: z.object({ maxBytes: z.number().int().positive() }).strict(),
    check: () => () => {},
  }),
]);

async function writeConfig(
  contents: string,
  fileName = "wastech-mdlint.config.json",
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-config-"));
  tempDirs.push(root);
  await writeFile(path.join(root, fileName), contents, "utf8");
  return root;
}

describe("loadConfiguration", () => {
  it("parses JSONC with comments and trailing commas", async () => {
    const root = await writeConfig(
      [
        "{",
        "  // a comment",
        '  "include": ["docs/**/*.md"],',
        '  "rules": [',
        '    { "rule": "ref-001", "severity": "warning" }, // trailing comma next',
        "  ],",
        "}",
      ].join("\n"),
    );

    const loaded = await loadConfiguration({ cwd: root, registry });

    expect(loaded.config.include).toEqual(["docs/**/*.md"]);
    expect(loaded.rules).toHaveLength(1);
    expect(loaded.rules[0]?.rule.id).toBe("REF-001");
    expect(loaded.rules[0]?.severity).toBe("warning");
  });

  it("resolves settings and exposes them", async () => {
    const root = await writeConfig(
      JSON.stringify({
        settings: {
          siteRouter: { preset: "starlight", contentDir: "src/content/docs" },
        },
        rules: [],
      }),
    );

    const loaded = await loadConfiguration({ cwd: root, registry });
    expect(loaded.settings.siteRouter).toEqual({
      preset: "starlight",
      contentDir: "src/content/docs",
    });
  });

  it("resolves settings.idRef and exposes it for the graph builder", async () => {
    const root = await writeConfig(
      JSON.stringify({
        settings: {
          idRef: {
            idPattern: "^REQ-\\d+$",
            definitions: ["reqs.md"],
            idColumn: "ID",
          },
        },
        rules: [],
      }),
    );

    const loaded = await loadConfiguration({ cwd: root, registry });
    expect(loaded.settings.idRef).toEqual({
      idPattern: "^REQ-\\d+$",
      definitions: ["reqs.md"],
      idColumn: "ID",
    });
  });

  it("rejects a malformed settings.idRef missing idColumn", async () => {
    const root = await writeConfig(
      JSON.stringify({
        settings: {
          idRef: { idPattern: "^REQ-\\d+$", definitions: ["reqs.md"] },
        },
        rules: [],
      }),
    );

    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /idColumn/,
    );
  });

  it("rejects unknown top-level keys", async () => {
    const root = await writeConfig(
      JSON.stringify({ nonsense: true, rules: [] }),
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /nonsense/,
    );
  });

  it("reports an unknown rule with a did-you-mean suggestion", async () => {
    const root = await writeConfig(
      JSON.stringify({ rules: [{ rule: "REF-009" }] }),
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /rules\[0\]: Unknown rule "REF-009"\. Did you mean "REF-001"\?/,
    );
  });

  it("reports bad rule options with a path-prefixed error", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [{ rule: "SIZE-001", options: { maxBytes: -1 } }],
      }),
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /rules\[0\]\.options\.maxBytes:/,
    );
  });

  it("throws on invalid JSONC", async () => {
    const root = await writeConfig("{ not valid ");
    // The structured code/hint accompany the message so an MCP host can render the error
    // contract without re-classifying it.
    const error = await loadConfiguration({ cwd: root, registry }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).hint).toBeTruthy();
  });

  it("returns a zero-config default when no config is found", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "wastech-mdlint-noconfig-"),
    );
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
      registry,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toMatch(/Config file not found/);
    expect((error as ConfigError).code).toBe("CONFIG_NOT_FOUND");
    expect((error as ConfigError).hint).toBeTruthy();
  });

  // One resolution base for `explicitConfigPath`, and the same base the diagnostic
  // renders against. The five CLI handlers and the MCP helper all reach this line, so getting it
  // right here is what makes `--config` mean one thing across the six.
  it("resolves a relative explicit config path against params.cwd, not the process cwd", async () => {
    // The test process runs from the repo root, which is deliberately *not* the fixture dir — the
    // only shape in which the old `path.resolve(explicitConfigPath)` and this one differ.
    const root = await writeConfig(
      JSON.stringify({ include: ["**/*.md"], rules: [] }),
      "custom.config.json",
    );

    const loaded = await loadConfiguration({
      cwd: root,
      explicitConfigPath: "custom.config.json",
      registry,
    });

    expect(loaded.configPath).toBe(path.join(root, "custom.config.json"));
  });

  it("leaves an absolute explicit config path alone", async () => {
    const root = await writeConfig(
      JSON.stringify({ include: ["**/*.md"], rules: [] }),
      "custom.config.json",
    );
    const absolute = path.join(root, "custom.config.json");

    // `path.resolve(base, absolute)` returns `absolute`, so an absolute argument is unaffected by the
    // base — pinned because that is the half of the change nothing else would notice breaking.
    const loaded = await loadConfiguration({
      cwd: os.tmpdir(),
      explicitConfigPath: absolute,
      registry,
    });

    expect(loaded.configPath).toBe(absolute);
  });

  it("reports a missing relative config path as the user typed it", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "wastech-mdlint-relmissing-"),
    );
    tempDirs.push(root);

    const error = await loadConfiguration({
      cwd: root,
      explicitConfigPath: "nope.json",
      registry,
    }).catch((e: unknown) => e);

    expect((error as ConfigError).code).toBe("CONFIG_NOT_FOUND");
    // Resolution and rendering share `params.cwd` now. While they disagreed this read
    // `../nope.json`: a lookup against the process cwd relativized against the analyzed directory,
    // naming a path nobody typed.
    expect((error as ConfigError).message).toBe(
      "Config file not found: nope.json",
    );
    expect((error as ConfigError).message).not.toContain("../");
  });
});

// One notation across both validation stages: `config` root, `.key` for an object key,
// `[n]` for an array index. Stage 1 used to emit `config.rules.0` while stage 2 emitted
// `rules[0].options` for the same array.
const DIAGNOSTIC_LINE = /^- config(\.[A-Za-z_$][\w$]*|\[\d+\])*: \S/;

/**
 * Load a config expected to be rejected and return the diagnostic. Every case below goes through
 * here so the notation invariant and the "names the file" rule are asserted on all of them rather
 * than on whichever one a future author remembers.
 */
async function rejectedConfig(config: unknown): Promise<string> {
  const root = await writeConfig(JSON.stringify(config));
  const error = await loadConfiguration({ cwd: root, registry }).catch(
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(ConfigError);
  expect((error as ConfigError).code).toBe("CONFIG_INVALID");

  const message = (error as ConfigError).message;
  const [header, ...rest] = message.split("\n");
  expect(header).toBe("Invalid config at wastech-mdlint.config.json:");
  expect(rest.length).toBeGreaterThan(0);
  for (const line of rest) {
    expect(line).toMatch(DIAGNOSTIC_LINE);
  }

  return message;
}

describe("config diagnostics", () => {
  it("names the offending key and the allowed values for a severity typo", async () => {
    const message = await rejectedConfig({
      rules: [{ rule: "REF-001", severity: "warn" }],
    });

    expect(message).toContain("config.rules[0].severity");
    expect(message).toContain("error");
    expect(message).toContain("warning");
    expect(message).toContain("off");
  });

  it("names an unrecognized key on a rule entry", async () => {
    const message = await rejectedConfig({
      rules: [{ rule: "REF-001", bogusKey: 1 }],
    });

    expect(message).toContain("config.rules[0]");
    expect(message).toContain("bogusKey");
  });

  it("still names an unrecognized key inside a built-in rule's options", async () => {
    const message = await rejectedConfig({
      rules: [{ rule: "SIZE-001", options: { maxBytes: 10, bogus: 1 } }],
    });

    expect(message).toContain("config.rules[0].options");
    expect(message).toContain("bogus");
  });

  it("names a typo'd key inside a custom rule's assert block", async () => {
    const message = await rejectedConfig({
      rules: [
        {
          rule: "custom",
          id: "REQ-OWNER",
          options: { assert: { kind: "requiredColumns", colums: ["Owner"] } },
        },
      ],
    });

    expect(message).toContain("config.rules[0].options.assert");
    expect(message).toContain("colums");
  });

  it("identifies the shape problem when options.assert is an array", async () => {
    const message = await rejectedConfig({
      rules: [
        {
          rule: "custom",
          id: "REQ-OWNER",
          options: {
            assert: [{ kind: "requiredColumns", columns: ["Owner"] }],
          },
        },
      ],
    });

    expect(message).toContain(
      "config.rules[0].options.assert: Invalid input: expected object, received array",
    );
  });

  it("lists the allowed assertion kinds for an unknown assert.kind", async () => {
    const message = await rejectedConfig({
      rules: [
        {
          rule: "custom",
          id: "REQ-OWNER",
          options: { assert: { kind: "requiredColums", columns: ["Owner"] } },
        },
      ],
    });

    expect(message).toContain("config.rules[0].options.assert.kind");
    expect(message).toContain("requiredColumns");
    expect(message).toContain("columnUnique");
  });

  it("names the config file on a stage-2 (rule resolution) failure too", async () => {
    // `resolveRules` used to throw a bare `Invalid config:`, so the one shape a user hits on a rule
    // typo was the one that never said which file it read.
    const message = await rejectedConfig({
      rules: [{ rule: "SIZE-001", options: { maxBytes: -1 } }],
    });

    expect(message).toContain("config.rules[0].options.maxBytes");
  });

  it("names an ancestor config by its path relative to the analyzed directory", async () => {
    const root = await writeConfig(
      JSON.stringify({ rules: [{ rule: "REF-009" }] }),
    );
    const nested = path.join(root, "docs");
    await mkdir(nested, { recursive: true });

    const error = await loadConfiguration({ cwd: nested, registry }).catch(
      (e: unknown) => e,
    );

    // The walk-up means a config the user never opened can govern the run; "which file?" is only
    // answerable if the diagnostic says so.
    expect((error as ConfigError).message).toContain(
      "Invalid config at ../wastech-mdlint.config.json:",
    );
  });

  it("reports only the first failing stage (no cross-stage aggregation)", async () => {
    // Stage 2 consumes stage 1's *parsed* output, so it cannot run on a shape the schema rejected.
    // Accepted rather than fixed.
    const message = await rejectedConfig({
      rules: [
        { rule: "REF-001", severity: "warn" },
        { rule: "SIZE-001", options: { maxBytes: -1 } },
      ],
    });

    expect(message).toContain("config.rules[0].severity");
    expect(message).not.toContain("config.rules[1]");
  });

  it("reports every issue within one stage at once", async () => {
    // The bound is two passes, not one error per run: each stage already aggregates its own issues.
    const message = await rejectedConfig({
      rules: [
        { rule: "SIZE-001", options: { maxBytes: -1 } },
        { rule: "REF-009" },
      ],
    });

    expect(message).toContain("config.rules[0].options.maxBytes");
    expect(message).toContain('config.rules[1]: Unknown rule "REF-009"');
  });
});

describe("compile config", () => {
  it("accepts a fully-populated valid compile section", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [],
        compile: {
          outdir: ".claude/skills/wastech-mdlint",
          skill: { name: "docs-skill", description: "Docs skill" },
          sections: {
            architecture: true,
            rules: true,
            dependencies: false,
            workflow: true,
          },
          commandPreset: "claude",
          hubMinInDegree: 5,
        },
      }),
    );

    const loaded = await loadConfiguration({ cwd: root, registry });
    expect(loaded.config.compile).toEqual({
      outdir: ".claude/skills/wastech-mdlint",
      skill: { name: "docs-skill", description: "Docs skill" },
      sections: {
        architecture: true,
        rules: true,
        dependencies: false,
        workflow: true,
      },
      commandPreset: "claude",
      hubMinInDegree: 5,
    });
  });

  it("rejects compile: {} for missing skill", async () => {
    const root = await writeConfig(JSON.stringify({ rules: [], compile: {} }));
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /compile\.skill/,
    );
  });

  it("rejects an empty compile.skill.name", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [],
        compile: { skill: { name: "", description: "d" } },
      }),
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /compile\.skill\.name/,
    );
  });

  it("rejects an empty compile.skill.description", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [],
        compile: { skill: { name: "s", description: "" } },
      }),
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /compile\.skill\.description/,
    );
  });

  it.each([0, -1, 1.5])(
    "rejects a hubMinInDegree of %s",
    async (hubMinInDegree) => {
      const root = await writeConfig(
        JSON.stringify({
          rules: [],
          compile: { skill: { name: "s", description: "d" }, hubMinInDegree },
        }),
      );
      await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
        /compile\.hubMinInDegree/,
      );
    },
  );

  it("rejects an unknown compile.commandPreset value", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [],
        compile: {
          skill: { name: "s", description: "d" },
          commandPreset: "bogus-preset",
        },
      }),
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /compile\.commandPreset/,
    );
  });

  it("rejects a non-boolean compile.sections.rules", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [],
        compile: {
          skill: { name: "s", description: "d" },
          sections: { rules: "bogus" },
        },
      }),
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /compile\.sections\.rules/,
    );
  });

  it("rejects an unknown compile.* key", async () => {
    const root = await writeConfig(
      JSON.stringify({
        rules: [],
        compile: { skill: { name: "s", description: "d" }, bogus: true },
      }),
    );
    await expect(loadConfiguration({ cwd: root, registry })).rejects.toThrow(
      /config\.compile:.*"bogus"/,
    );
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

  it("never anchors above the user's home directory", async () => {
    const outer = await mkdtemp(
      path.join(os.tmpdir(), "wastech-mdlint-fakehome-outer-"),
    );
    tempDirs.push(outer);
    await writeFile(
      path.join(outer, "wastech-mdlint.config.json"),
      JSON.stringify({ rules: [] }),
      "utf8",
    );

    const home = path.join(outer, "home");
    const project = path.join(home, "project");
    await mkdir(project, { recursive: true });

    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(home);
    try {
      // A real config sits at `outer`, above the mocked home directory — the walk must stop at
      // `home` and never report it.
      expect(await findConfig(project)).toBeUndefined();
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("still finds a config that sits exactly at the home directory", async () => {
    const home = await mkdtemp(
      path.join(os.tmpdir(), "wastech-mdlint-fakehome-exact-"),
    );
    tempDirs.push(home);
    await writeFile(
      path.join(home, "wastech-mdlint.config.json"),
      JSON.stringify({ rules: [] }),
      "utf8",
    );

    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(home);
    try {
      // The boundary rejects ANCESTORS at/above $HOME, not the starting directory itself — a config
      // living directly at cwd === $HOME must still be found.
      expect(await findConfig(home)).toBe(
        path.join(home, "wastech-mdlint.config.json"),
      );
    } finally {
      homedirSpy.mockRestore();
    }
  });
});
