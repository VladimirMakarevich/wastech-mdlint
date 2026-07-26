import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigError } from "../src/config/config-error.js";
import { loadConfiguration } from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-custom-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

async function lintWithConfig(cwd: string) {
  const loaded = await loadConfiguration({ cwd });
  return lintFiles({
    cwd,
    config: loaded.config,
    rules: loaded.rules,
    settings: loaded.settings,
  });
}

describe("declarative custom rule", () => {
  it("runs a document-scope custom rule from config (no rebuild)", async () => {
    const cwd = await repo({
      "docs/reqs.md": "| ID | Owner |\n| --- | --- |\n| REQ-1 |  |\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "REQ-OWNER",
            description: "Every requirement row must have an Owner",
            severity: "error",
            target: "table",
            options: {
              files: ["docs/**/*.md"],
              assert: { kind: "columnNotEmpty", column: "Owner" },
            },
          },
        ],
      }),
    });

    const result = await lintWithConfig(cwd);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      ruleId: "REQ-OWNER",
      severity: "error",
      filePath: "docs/reqs.md",
    });
  });

  it("runs a project-scope custom rule (columnUnique) from config", async () => {
    const cwd = await repo({
      "a.md": "| ID |\n| --- |\n| X-1 |\n",
      "b.md": "| ID |\n| --- |\n| X-1 |\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "UNIQUE-ID",
            options: { assert: { kind: "columnUnique", column: "ID" } },
          },
        ],
      }),
    });

    const result = await lintWithConfig(cwd);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      ruleId: "UNIQUE-ID",
      filePath: "b.md",
    });
  });

  it("rejects a custom id that shadows a built-in prefix (C7)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "REF-100",
            options: { assert: { kind: "allChecked" } },
          },
        ],
      }),
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(
      /reserved built-in prefix/,
    );
  });

  it("rejects a custom id that violates the namespaced grammar", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "nodash",
            options: { assert: { kind: "allChecked" } },
          },
        ],
      }),
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(/dash-separated/);
  });

  it("rejects an invalid assert shape via the primitive schema", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "REQ-X",
            options: {
              assert: { kind: "columnMatches", column: "C", pattern: "(" },
            },
          },
        ],
      }),
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(
      /valid regular expression/,
    );
  });

  it("rejects a target that does not match the assert kind, including the retired 'heading' target (P9.05)", async () => {
    const cwd = await repo({
      "a.md": "# A\n## B\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "ARCH-DEPS",
            target: "heading",
            options: { assert: { kind: "sectionPresent", sections: ["B"] } },
          },
        ],
      }),
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(
      /target "heading" does not match assert kind "sectionPresent" \(expected "section"\)/,
    );
  });

  // Audit M-3: {"rule":"custom"} without `id` used to fall through the permissive standard
  // ruleEntrySchema and crash in resolveCustomRule's canonicalizeRuleId(undefined). These three
  // shapes must now surface as a structured CONFIG_INVALID, not a TypeError.
  it("rejects a custom entry missing id, options, and severity (C7, not a crash)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom" }],
      }),
    });

    const error = await loadConfiguration({ cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).message).toMatch(/config\.rules\.0/);
    expect((error as ConfigError).message).toMatch(
      /"id" and "options\.assert"/,
    );
  });

  it("rejects a custom entry with options but no id (C7, not a crash)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            options: { assert: { kind: "allChecked" } },
          },
        ],
      }),
    });

    const error = await loadConfiguration({ cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).message).toMatch(/config\.rules\.0/);
  });

  it("rejects a custom entry with severity but no id (C7, not a crash)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom", severity: "warning" }],
      }),
    });

    const error = await loadConfiguration({ cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).message).toMatch(/config\.rules\.0/);
  });

  it("rejects a custom entry with id but no options (still CONFIG_INVALID, not a new behavior)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom", id: "REQ-1" }],
      }),
    });

    const error = await loadConfiguration({ cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).message).toMatch(/config\.rules\.0/);
  });
});
