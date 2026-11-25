import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LintMessage } from "@wastech-mdlint/core";

import { Corpus } from "../src/corpus.js";
import { findingPrompts } from "../src/prompts.js";

// The viewer's part of a fix prompt: picking the findings out of a lint run and telling core about
// this repository - its config's rule entries, where the config is, how to run the CLI. The prompt
// text itself is core's and is tested there.

const VERSION = (
  JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

// A nested config with a SIZE-001 override, and a document over that override's line budget, so the
// budget prompt has to read the override through the config's own rule entries.
const CONFIG = `{
  // Notes run long; everything else is held to 4 lines.
  "include": ["**/*.md"],
  "rules": [
    { "rule": "file-size-budget", "options": { "lines": { "warn": 4 }, "overrides": [{ "pattern": "notes/**", "lines": { "warn": 6 } }] } },
    { "rule": "REF-001" }
  ]
}
`;

let dir: string;
let corpus: Corpus;
let findings: Map<string, LintMessage[]>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "wastech-viewer-prompts-"));
  await mkdir(path.join(dir, "notes"));
  await mkdir(path.join(dir, "lint"));
  await writeFile(path.join(dir, "lint", "wastech-mdlint.config.json"), CONFIG);
  await writeFile(
    path.join(dir, "notes", "long.md"),
    "# Long\n\n1\n\n2\n\n3\n\n[gone](./gone.md)\n",
  );
  await writeFile(path.join(dir, "README.md"), "# Home\n");
  corpus = await Corpus.load({
    cwd: dir,
    configPath: path.join(dir, "lint", "wastech-mdlint.config.json"),
  });
  findings = new Map();
  for (const message of corpus.lint().messages) {
    findings.set(message.filePath, [
      ...(findings.get(message.filePath) ?? []),
      message,
    ]);
  }
}, 30_000);

afterAll(async () => {
  if (dir !== undefined) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("findingPrompts", () => {
  it("offers the size strategies for a size finding, built from the config's own entries", async () => {
    const answer = await findingPrompts({
      corpus,
      findings,
      filePath: "notes/long.md",
      ruleId: "SIZE-001",
      line: 0,
    });
    expect(answer.status).toBe(200);
    if (answer.status !== 200) {
      return;
    }
    expect(answer.body.prompts.map((prompt) => prompt.strategy)).toEqual([
      "compress",
      "split",
      "budget",
    ]);
    const budget = answer.body.prompts[2]!;
    expect(budget.label).toBe("Raise the budget for this path");
    // The rule is configured by its alias, and its override is found all the same.
    expect(budget.text).toContain(
      "- `lines`: warns above 6 - from the `overrides` entry with pattern `notes/**`.",
    );
    // Only the one finding was asked for, not the broken link beside it.
    expect(budget.text).not.toContain("REF-001");
    // The config is named by its path in the repository and the CLI is the pinned release, since
    // this repository installs none.
    expect(budget.text).toContain(
      "under the config `lint/wastech-mdlint.config.json`",
    );
    expect(budget.text).toContain(
      `Run the linter from \`lint/\`, the directory that holds the config: \`npx -y @wastech-mdlint/cli@${VERSION} lint\`.`,
    );
  });

  it("answers all of a document's findings together", async () => {
    const answer = await findingPrompts({
      corpus,
      findings,
      filePath: "notes/long.md",
    });
    expect(answer.status).toBe(200);
    if (answer.status === 200) {
      const text = answer.body.prompts[0]!.text;
      expect(text).toContain("`SIZE-001`");
      expect(text).toContain("`REF-001`");
      expect(text).toContain("## The other findings");
    }
  });

  it("offers only a fix for a finding that is not about size", async () => {
    const answer = await findingPrompts({
      corpus,
      findings,
      filePath: "notes/long.md",
      ruleId: "REF-001",
      line: 9,
    });
    expect(answer.status).toBe(200);
    if (answer.status === 200) {
      expect(answer.body.prompts.map((prompt) => prompt.strategy)).toEqual([
        "fix",
      ]);
    }
  });

  // The page asks for what it showed; after a save the finding may be gone, and a prompt about it
  // would send an agent after something that is no longer there.
  it("refuses a finding that is no longer reported, and a path outside the corpus", async () => {
    expect(
      (
        await findingPrompts({
          corpus,
          findings,
          filePath: "notes/long.md",
          ruleId: "REF-001",
          line: 1,
        })
      ).status,
    ).toBe(409);
    expect(
      (await findingPrompts({ corpus, findings, filePath: "README.md" }))
        .status,
    ).toBe(409);
    for (const filePath of [
      "gone.md",
      "../secret.md",
      "lint/wastech-mdlint.config.json",
    ]) {
      expect(
        (await findingPrompts({ corpus, findings, filePath })).status,
        filePath,
      ).toBe(404);
    }
    expect(
      (
        await findingPrompts({
          corpus,
          findings: undefined,
          filePath: "notes/long.md",
        })
      ).status,
    ).toBe(409);
  });
});
