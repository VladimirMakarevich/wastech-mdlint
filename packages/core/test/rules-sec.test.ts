import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { applyFixes } from "../src/engine/fix.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-sec-"));
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

describe("SEC-001 required sections", () => {
  it("flags a missing section and scaffolds it with --fix", async () => {
    const cwd = await fixtureRepo({ "a.md": "# Title\n\n## Intro\n" });

    const before = await lint(cwd, [rule("SEC-001", { sections: ["Intro", "Summary"] })]);
    expect(before.messages.map((message) => message.data?.section)).toEqual(["Summary"]);

    await applyFixes({ cwd, config: { rules: [] }, rules: [rule("SEC-001", { sections: ["Intro", "Summary"] })], settings: {} });
    const written = await readFile(path.join(cwd, "a.md"), "utf8");
    expect(written).toContain("## Summary");

    const after = await lint(cwd, [rule("SEC-001", { sections: ["Intro", "Summary"] })]);
    expect(after.messages).toEqual([]);
  });
});

describe("SEC-002 section order", () => {
  it("flags out-of-order sections", async () => {
    const cwd = await fixtureRepo({ "a.md": "## Usage\n## Overview\n" });
    const result = await lint(cwd, [rule("SEC-002", { order: ["Overview", "Usage"] })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({ section: "Usage", expectedAfter: "Overview" });
  });
});

describe("SEC-003 template conformance", () => {
  it("flags files missing a template heading, and skips when the template is absent", async () => {
    const cwd = await fixtureRepo({
      "template.md": "# T\n## Context\n## Decision\n",
      "adr/one.md": "# One\n## Context\n",
      "adr/two.md": "# Two\n## Context\n## Decision\n"
    });

    const conform = await lint(cwd, [
      rule("SEC-003", { template: "template.md", files: ["adr/**/*.md"], level: 2 })
    ]);
    expect(conform.messages).toEqual([
      expect.objectContaining({ filePath: "adr/one.md", data: { section: "Decision", template: "template.md" } })
    ]);

    const missingTemplate = await lint(cwd, [
      rule("SEC-003", { template: "nope.md", files: ["adr/**/*.md"] })
    ]);
    expect(missingTemplate.messages).toHaveLength(1);
    expect(missingTemplate.messages[0]?.message).toMatch(/was not found/);
  });
});

describe("STR-001 required files", () => {
  it("flags a required file that is absent from the project", async () => {
    const cwd = await fixtureRepo({ "README.md": "# Readme\n" });
    const result = await lint(cwd, [rule("STR-001", { files: ["README.md", "CONTRIBUTING.md"] })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({ required: "CONTRIBUTING.md" });
  });
});
