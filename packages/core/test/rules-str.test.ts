import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-str-"));
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

async function lint(cwd: string, rules: ConfiguredRule[]) {
  return lintFiles({ cwd, config: { rules: [] }, rules, settings: {} });
}

describe("STR-001 required files", () => {
  it("reports nothing when every required file (including a glob) is present", async () => {
    const cwd = await fixtureRepo({
      "README.md": "# Readme\n",
      "docs/guide.md": "# Guide\n",
    });
    const result = await lint(cwd, [
      rule("STR-001", { files: ["README.md", "docs/*.md"] }),
    ]);
    expect(result.messages).toEqual([]);
  });

  it("flags each missing required file independently", async () => {
    const cwd = await fixtureRepo({ "README.md": "# Readme\n" });
    const result = await lint(cwd, [
      rule("STR-001", {
        files: ["README.md", "CONTRIBUTING.md", "LICENSE.md"],
      }),
    ]);
    expect(result.messages.map((message) => message.data?.required)).toEqual([
      "CONTRIBUTING.md",
      "LICENSE.md",
    ]);
  });
});
