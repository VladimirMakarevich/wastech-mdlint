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
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-ctx-"));
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

describe("CTX-001 placeholder / empty sections", () => {
  it("flags empty and placeholder-only sections but not prose mentions", async () => {
    const cwd = await fixtureRepo({
      "a.md": ["## Empty", "", "## Todo", "TODO", "## Fine", "Mentions TODO but has real prose."].join("\n")
    });
    const result = await lint(cwd, [rule("CTX-001")]);
    expect(result.messages.map((message) => message.data?.section)).toEqual(["Empty", "Todo"]);
  });

  it("unions custom placeholders with the locked defaults", async () => {
    const cwd = await fixtureRepo({ "a.md": "## S\nLATER\n" });
    expect((await lint(cwd, [rule("CTX-001")])).messages).toEqual([]);
    expect((await lint(cwd, [rule("CTX-001", { placeholders: ["LATER"] })])).messages).toHaveLength(1);
  });
});

describe("CTX-002 checklist completeness", () => {
  it("flags unchecked items, optionally scoped to a section", async () => {
    const cwd = await fixtureRepo({ "a.md": "## Tasks\n- [x] a\n- [ ] b\n" });
    const result = await lint(cwd, [rule("CTX-002", { section: "Tasks" })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({ text: "b" });
  });
});

describe("CTX-003 glossary aliases", () => {
  it("suggests the canonical term for alias usage and skips the glossary itself", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": "| Term | Aliases |\n| --- | --- |\n| GraphQL | graphql, gql |\n",
      "doc.md": "We use gql and graphql everywhere.\n"
    });
    const result = await lint(cwd, [
      rule("CTX-003", { glossary: "glossary.md", termColumn: "Term", aliasColumn: "Aliases", files: ["doc.md"] })
    ]);
    expect(result.messages.map((message) => message.data?.alias).sort()).toEqual(["gql", "graphql"]);
    expect(result.messages.every((message) => message.data?.canonical === "GraphQL")).toBe(true);
  });
});
