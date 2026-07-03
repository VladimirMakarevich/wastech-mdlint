import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfiguration } from "../src/config/load-config.js";
import { formatLintResultJson } from "../src/engine/format-lint-result.js";
import { lintFiles } from "../src/engine/lint-files.js";

// Core-pipeline integration test (P3.09): a representative multi-rule config over a small fixture
// repo, exercised end-to-end through loadConfiguration → lintFiles, including a determinism check.

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-int-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

const CONFIG = JSON.stringify({
  include: ["**/*.md"],
  exclude: ["ignored/**"],
  rules: [
    { rule: "REF-001" },
    { rule: "TBL-002", options: { columns: ["Owner"] } },
    { rule: "SEC-001", options: { sections: ["Overview"], files: ["docs/**/*.md"] } },
    { rule: "GRP-001" },
    { rule: "SIZE-001", options: { lines: { warn: 1 } } },
    {
      rule: "custom",
      id: "REQ-STATUS",
      options: { files: ["docs/**/*.md"], assert: { kind: "columnInSet", column: "Status", values: ["open", "done"] } }
    }
  ]
});

const REPO = {
  "wastech-mdlint.config.json": CONFIG,
  "docs/reqs.md": [
    "## Overview",
    "",
    "Content.",
    "",
    "| ID | Owner | Status |",
    "| --- | --- | --- |",
    "| REQ-1 |  | bogus |",
    "",
    "[dangling](nope.md)"
  ].join("\n"),
  "docs/missing-overview.md": "## Detail\n\nno overview section here\n",
  "ignored/junk.md": "[broken](also-missing.md)\n"
};

async function runLint(cwd: string) {
  const loaded = await loadConfiguration({ cwd });
  return lintFiles({ cwd, config: loaded.config, rules: loaded.rules, settings: loaded.settings });
}

describe("core pipeline integration", () => {
  it("runs a representative ruleset and aggregates findings across families", async () => {
    const cwd = await fixtureRepo(REPO);
    const result = await runLint(cwd);

    const byRule = new Set(result.messages.map((message) => message.ruleId));
    expect(byRule).toContain("REF-001"); // dangling link in docs/reqs.md
    expect(byRule).toContain("TBL-002"); // empty Owner cell
    expect(byRule).toContain("REQ-STATUS"); // "bogus" not in the allowed Status set
    expect(byRule).toContain("SEC-001"); // docs/missing-overview.md lacks Overview
    expect(byRule).toContain("SIZE-001"); // over the 1-line warn budget

    // Excluded files never enter the corpus.
    expect(result.files).not.toContain("ignored/junk.md");
    expect(result.messages.some((message) => message.filePath === "ignored/junk.md")).toBe(false);
  });

  it("produces byte-identical JSON output across repeated runs (determinism)", async () => {
    const cwd = await fixtureRepo(REPO);
    const first = formatLintResultJson(await runLint(cwd));
    const second = formatLintResultJson(await runLint(cwd));
    expect(first).toBe(second);
  });
});
