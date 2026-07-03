import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-grp-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(path.join(root, relativePath), content, "utf8");
  }
  return root;
}

function rule(id: string, options?: unknown): ConfiguredRule {
  return { rule: ruleRegistry.resolveRule(id, options) };
}

async function lint(cwd: string, rules: ConfiguredRule[]) {
  return lintFiles({ cwd, config: { rules: [] }, rules, settings: {} });
}

describe("GRP-001 cycles (reads the injected graph)", () => {
  it("detects and de-duplicates a dependency cycle", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "[a](a.md)\n"
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
});

describe("GRP-002 orphans", () => {
  it("flags documents with no incoming references except entry points", async () => {
    const cwd = await fixtureRepo({
      "index.md": "[a](a.md)\n",
      "a.md": "# A\n",
      "orphan.md": "# Orphan\n"
    });
    const result = await lint(cwd, [rule("GRP-002", { entryPoints: ["index.md"] })]);
    expect(result.messages.map((message) => message.filePath)).toEqual(["orphan.md"]);
  });
});

describe("GRP-003 ID chain across stages", () => {
  it("flags a stage id that is not carried into the next stage", async () => {
    const cwd = await fixtureRepo({
      "reqs.md": "| ID |\n| --- |\n| REQ-1 |\n| REQ-2 |\n",
      "design.md": "| Requirement |\n| --- |\n| REQ-1 |\n"
    });
    const result = await lint(cwd, [
      rule("GRP-003", {
        chain: [
          { stage: "requirements", files: ["reqs.md"], idColumn: "ID", refColumn: "ID" },
          { stage: "design", files: ["design.md"], refColumn: "Requirement" }
        ],
        idPattern: "^REQ-\\d+$"
      })
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({ id: "REQ-2", fromStage: "requirements", toStage: "design" });
  });
});
