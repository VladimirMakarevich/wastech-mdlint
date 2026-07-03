import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { applyEdits, applyFixes } from "../src/engine/fix.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-tbl-"));
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

const TABLE = ["| ID | Owner | Status |", "| --- | --- | --- |", "| REQ-1 | Ann | open |", "| REQ-2 |  | bogus |"].join(
  "\n"
);

describe("TBL rules", () => {
  it("TBL-001 flags a missing required column (error)", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE });
    const result = await lint(cwd, [rule("TBL-001", { requiredColumns: ["ID", "Priority"] })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ ruleId: "TBL-001", severity: "error", data: { column: "Priority" } });
  });

  it("TBL-002 flags empty cells (warning) and honors column scoping", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE });
    const result = await lint(cwd, [rule("TBL-002", { columns: ["Owner"] })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ ruleId: "TBL-002", severity: "warning", line: 4, fixable: true });
  });

  it("TBL-003 flags values outside the allowed set", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE });
    const result = await lint(cwd, [rule("TBL-003", { column: "Status", values: ["open", "done"] })]);
    expect(result.messages.map((message) => message.data?.value)).toEqual(["bogus"]);
  });

  it("TBL-004 flags values failing the pattern", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE });
    const result = await lint(cwd, [rule("TBL-004", { column: "ID", pattern: "^BUG-" })]);
    expect(result.messages).toHaveLength(2);
  });

  it("TBL-005 enforces a cross-column conditional", async () => {
    const cwd = await fixtureRepo({
      "a.md": ["| Status | Resolution |", "| --- | --- |", "| done |  |"].join("\n")
    });
    const result = await lint(cwd, [
      rule("TBL-005", { when: { column: "Status", equals: "done" }, then: { column: "Resolution", notEmpty: true } })
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.ruleId).toBe("TBL-005");
  });

  it("TBL-006 flags duplicate IDs across files (project)", async () => {
    const cwd = await fixtureRepo({
      "a.md": "| ID |\n| --- |\n| REQ-1 |\n",
      "b.md": "| ID |\n| --- |\n| REQ-1 |\n"
    });
    const result = await lint(cwd, [rule("TBL-006", { column: "ID" })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ ruleId: "TBL-006", filePath: "b.md", data: { firstSeenIn: "a.md" } });
  });
});

describe("TBL-002 --fix", () => {
  it("replaces empty cells with TODO and clears the finding on re-lint", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE });

    const before = await lint(cwd, [rule("TBL-002", { columns: ["Owner"] })]);
    expect(before.messages).toHaveLength(1);

    await applyFixes({ cwd, config: { rules: [] }, rules: [rule("TBL-002", { columns: ["Owner"] })], settings: {} });

    const written = await readFile(path.join(cwd, "a.md"), "utf8");
    expect(written).toContain("| REQ-2 | TODO | bogus |");

    const after = await lint(cwd, [rule("TBL-002", { columns: ["Owner"] })]);
    expect(after.messages).toEqual([]);
  });
});

describe("applyEdits", () => {
  it("applies non-overlapping edits from the end and skips overlaps", () => {
    // Replace "bb" (2..4) and "d" (5..6); both non-overlapping.
    expect(applyEdits("aabbcd", [
      { start: 2, end: 4, newText: "XX" },
      { start: 5, end: 6, newText: "Y" }
    ])).toBe("aaXXcY");

    // Overlapping edits: the later-starting one wins, the overlapping earlier one is skipped.
    expect(applyEdits("aabbcd", [
      { start: 2, end: 5, newText: "Z" },
      { start: 3, end: 6, newText: "Q" }
    ])).toBe("aabQ");
  });
});
