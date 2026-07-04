import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfiguration } from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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
  return lintFiles({ cwd, config: loaded.config, rules: loaded.rules, settings: loaded.settings });
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
            options: { files: ["docs/**/*.md"], assert: { kind: "columnNotEmpty", column: "Owner" } }
          }
        ]
      })
    });

    const result = await lintWithConfig(cwd);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ ruleId: "REQ-OWNER", severity: "error", filePath: "docs/reqs.md" });
  });

  it("runs a project-scope custom rule (columnUnique) from config", async () => {
    const cwd = await repo({
      "a.md": "| ID |\n| --- |\n| X-1 |\n",
      "b.md": "| ID |\n| --- |\n| X-1 |\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom", id: "UNIQUE-ID", options: { assert: { kind: "columnUnique", column: "ID" } } }]
      })
    });

    const result = await lintWithConfig(cwd);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ ruleId: "UNIQUE-ID", filePath: "b.md" });
  });

  it("rejects a custom id that shadows a built-in prefix (C7)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom", id: "REF-100", options: { assert: { kind: "allChecked" } } }]
      })
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(/reserved built-in prefix/);
  });

  it("rejects a custom id that violates the namespaced grammar", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom", id: "nodash", options: { assert: { kind: "allChecked" } } }]
      })
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(/dash-separated/);
  });

  it("rejects an invalid assert shape via the primitive schema", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom", id: "REQ-X", options: { assert: { kind: "columnMatches", column: "C", pattern: "(" } } }]
      })
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(/valid regular expression/);
  });
});
