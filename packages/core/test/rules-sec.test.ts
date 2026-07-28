import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { applyFixes } from "../src/engine/fix.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
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

    const before = await lint(cwd, [
      rule("SEC-001", { sections: ["Intro", "Summary"] }),
    ]);
    expect(before.messages.map((message) => message.data?.section)).toEqual([
      "Summary",
    ]);

    await applyFixes({
      cwd,
      config: { rules: [] },
      rules: [rule("SEC-001", { sections: ["Intro", "Summary"] })],
      settings: {},
    });
    const written = await readFile(path.join(cwd, "a.md"), "utf8");
    expect(written).toContain("## Summary");

    const after = await lint(cwd, [
      rule("SEC-001", { sections: ["Intro", "Summary"] }),
    ]);
    expect(after.messages).toEqual([]);
  });

  // Audit L-6: the scaffold used to be a hard-coded `\n## X\n\nTODO\n`, so fixing a CRLF document
  // left it with mixed line endings. The fixture is built at runtime because `.gitattributes` forces
  // `eol=lf` on committed files, which would silently convert a checked-in CRLF fixture.
  it("scaffolds with CRLF in a CRLF document, leaving no lone LF behind", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# Title\r\n\r\n## Intro\r\n",
    });

    await applyFixes({
      cwd,
      config: { rules: [] },
      rules: [rule("SEC-001", { sections: ["Intro", "Summary"] })],
      settings: {},
    });

    const written = await readFile(path.join(cwd, "a.md"), "utf8");
    expect(written).toBe(
      "# Title\r\n\r\n## Intro\r\n\r\n## Summary\r\n\r\nTODO\r\n",
    );
    expect(written.replace(/\r\n/g, "")).not.toContain("\n");
    expect(written).not.toContain("\r\r");

    const after = await lint(cwd, [
      rule("SEC-001", { sections: ["Intro", "Summary"] }),
    ]);
    expect(after.messages).toEqual([]);
  });

  it("still scaffolds with LF in an LF document", async () => {
    const cwd = await fixtureRepo({ "a.md": "# Title\n\n## Intro\n" });

    await applyFixes({
      cwd,
      config: { rules: [] },
      rules: [rule("SEC-001", { sections: ["Intro", "Summary"] })],
      settings: {},
    });

    await expect(readFile(path.join(cwd, "a.md"), "utf8")).resolves.toBe(
      "# Title\n\n## Intro\n\n## Summary\n\nTODO\n",
    );
  });
});

describe("SEC-002 section order", () => {
  it("flags out-of-order sections", async () => {
    const cwd = await fixtureRepo({ "a.md": "## Usage\n## Overview\n" });
    const result = await lint(cwd, [
      rule("SEC-002", { order: ["Overview", "Usage"] }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      section: "Usage",
      expectedAfter: "Overview",
    });
  });

  it("filters headings by level before checking order", async () => {
    const cwd = await fixtureRepo({
      "a.md": "### Overview\n## Usage\n## Overview\n",
    });

    const unfiltered = await lint(cwd, [
      rule("SEC-002", { order: ["Overview", "Usage"] }),
    ]);
    expect(unfiltered.messages).toEqual([]);

    const filtered = await lint(cwd, [
      rule("SEC-002", { order: ["Overview", "Usage"], level: 2 }),
    ]);
    expect(filtered.messages).toHaveLength(1);
    expect(filtered.messages[0]?.data).toMatchObject({
      section: "Usage",
      expectedAfter: "Overview",
    });
  });

  it("scopes order checking to headings under a given parent section", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "## Section A\n### Two\n### One\n\n## Section B\n### One\n### Two\n",
    });

    const inSectionA = await lint(cwd, [
      rule("SEC-002", { order: ["One", "Two"], section: "Section A" }),
    ]);
    expect(inSectionA.messages).toHaveLength(1);
    expect(inSectionA.messages[0]?.data).toMatchObject({
      section: "Two",
      expectedAfter: "One",
    });

    const inSectionB = await lint(cwd, [
      rule("SEC-002", { order: ["One", "Two"], section: "Section B" }),
    ]);
    expect(inSectionB.messages).toEqual([]);
  });
});

describe("SEC-003 template conformance", () => {
  it("flags files missing a template heading, and skips when the template is absent", async () => {
    const cwd = await fixtureRepo({
      "template.md": "# T\n## Context\n## Decision\n",
      "adr/one.md": "# One\n## Context\n",
      "adr/two.md": "# Two\n## Context\n## Decision\n",
    });

    const conform = await lint(cwd, [
      rule("SEC-003", {
        template: "template.md",
        files: ["adr/**/*.md"],
        level: 2,
      }),
    ]);
    expect(conform.messages).toEqual([
      expect.objectContaining({
        filePath: "adr/one.md",
        data: { section: "Decision", template: "template.md" },
      }),
    ]);

    const missingTemplate = await lint(cwd, [
      rule("SEC-003", { template: "nope.md", files: ["adr/**/*.md"] }),
    ]);
    expect(missingTemplate.messages).toHaveLength(1);
    expect(missingTemplate.messages[0]?.message).toMatch(/was not found/);
  });

  it("rejects an absolute template path without leaking the target file's content", async () => {
    const outsideRoot = await fixtureRepo({
      "secret.md": "# Secret\n## TopSecretSection\n",
    });
    const cwd = await fixtureRepo({ "adr/one.md": "# One\n## Context\n" });

    const result = await lint(cwd, [
      rule("SEC-003", {
        template: path.join(outsideRoot, "secret.md"),
        files: ["adr/**/*.md"],
      }),
    ]);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toMatch(/escapes the analyzed root/);
    expect(
      result.messages.some((message) =>
        message.message.includes("TopSecretSection"),
      ),
    ).toBe(false);
  });

  it("rejects a `..`-escaping relative template path without leaking the target file's content", async () => {
    const outerRoot = await fixtureRepo({
      "secret.md": "# Secret\n## TopSecretSection\n",
      "project/adr/one.md": "# One\n## Context\n",
    });
    const cwd = path.join(outerRoot, "project");

    const result = await lint(cwd, [
      rule("SEC-003", {
        template: "../secret.md",
        files: ["adr/**/*.md"],
      }),
    ]);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toMatch(/escapes the analyzed root/);
    expect(
      result.messages.some((message) =>
        message.message.includes("TopSecretSection"),
      ),
    ).toBe(false);
  });

  it("still loads an in-root template from disk when it is excluded from the corpus", async () => {
    const cwd = await fixtureRepo({
      "templates/template.md": "# T\n## Context\n## Decision\n",
      "adr/one.md": "# One\n## Context\n",
    });

    const result = await lintFiles({
      cwd,
      config: { rules: [], exclude: ["templates/**"] },
      rules: [
        rule("SEC-003", {
          template: "templates/template.md",
          files: ["adr/**/*.md"],
          level: 2,
        }),
      ],
      settings: {},
    });

    expect(result.messages).toEqual([
      expect.objectContaining({
        filePath: "adr/one.md",
        data: { section: "Decision", template: "templates/template.md" },
      }),
    ]);
  });
});

// Audit L-4, the SEC half of P12.01's `exclude` matrix. One fixture serves all three cases: both
// documents violate every case, while `templates/t.md` satisfies SEC-001/SEC-002 (it has `Summary`,
// and neither `Overview` nor `Usage`, which `sectionOrder` skips) and is self-skipped by SEC-003.
const SECTION_DOC = "# Title\n\n## Usage\n\n## Overview\n";
const SECTION_TEMPLATE = "# T\n\n## Context\n\n## Summary\n";

const SEC_SCOPE_CASES: readonly { id: string; options: object }[] = [
  { id: "SEC-001", options: { sections: ["Summary"] } },
  { id: "SEC-002", options: { order: ["Overview", "Usage"] } },
  { id: "SEC-003", options: { template: "templates/t.md", level: 2 } },
];

describe("SEC file scope (exclude)", () => {
  // Distinct paths, not the raw message list: SEC-003 reports once per missing template heading.
  async function reportedFiles(
    cwd: string,
    configured: ConfiguredRule,
  ): Promise<string[]> {
    const result = await lint(cwd, [configured]);
    return [
      ...new Set(result.messages.map((message) => message.filePath)),
    ].sort(compareStrings);
  }

  it.each(SEC_SCOPE_CASES)(
    "$id drops an excluded document, with and without `files`",
    async ({ id, options }) => {
      const cwd = await fixtureRepo({
        "docs/a.md": SECTION_DOC,
        "drafts/b.md": SECTION_DOC,
        "templates/t.md": SECTION_TEMPLATE,
      });

      expect(await reportedFiles(cwd, rule(id, options))).toEqual([
        "docs/a.md",
        "drafts/b.md",
      ]);
      // The M-2 shape — `exclude` with no `files` beside it to carry the filtering.
      expect(
        await reportedFiles(
          cwd,
          rule(id, { ...options, exclude: ["drafts/**"] }),
        ),
      ).toEqual(["docs/a.md"]);
      expect(
        await reportedFiles(
          cwd,
          rule(id, { ...options, files: ["**/*.md"], exclude: ["drafts/**"] }),
        ),
      ).toEqual(["docs/a.md"]);
    },
  );

  // SEC-001's fix hook re-applies the gate itself because `applyFixes` has none — the pattern
  // TBL-002's hook was missing until P12.01. Without it, `--fix` scaffolds into files `check` skipped.
  it("SEC-001 --fix scaffolds only the in-scope document", async () => {
    const cwd = await fixtureRepo({
      "docs/a.md": SECTION_DOC,
      "drafts/b.md": SECTION_DOC,
    });

    const written = await applyFixes({
      cwd,
      config: { rules: [] },
      rules: [
        rule("SEC-001", { sections: ["Summary"], exclude: ["drafts/**"] }),
      ],
      settings: {},
    });
    expect(written.fixedFiles).toEqual(["docs/a.md"]);

    await expect(
      readFile(path.join(cwd, "docs", "a.md"), "utf8"),
    ).resolves.toContain("## Summary");
    await expect(
      readFile(path.join(cwd, "drafts", "b.md"), "utf8"),
    ).resolves.toBe(SECTION_DOC);
  });
});

describe("STR-001 required files", () => {
  it("flags a required file that is absent from the project", async () => {
    const cwd = await fixtureRepo({ "README.md": "# Readme\n" });
    const result = await lint(cwd, [
      rule("STR-001", { files: ["README.md", "CONTRIBUTING.md"] }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      required: "CONTRIBUTING.md",
    });
  });
});
