import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-ctx-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    // Nested fixtures are needed to exercise directory globs such as `drafts/**`; without this the
    // write ENOENTs. Same upgrade the TBL/SEC/REF helpers already carry.
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

describe("CTX-001 placeholder / empty sections", () => {
  it("flags empty and placeholder-only sections but not prose mentions", async () => {
    const cwd = await fixtureRepo({
      "a.md": [
        "## Empty",
        "",
        "## Todo",
        "TODO",
        "## Fine",
        "Mentions TODO but has real prose.",
      ].join("\n"),
    });
    const result = await lint(cwd, [rule("CTX-001")]);
    expect(result.messages.map((message) => message.data?.section)).toEqual([
      "Empty",
      "Todo",
    ]);
  });

  it("unions custom placeholders with the locked defaults", async () => {
    const cwd = await fixtureRepo({ "a.md": "## S\nLATER\n" });
    expect((await lint(cwd, [rule("CTX-001")])).messages).toEqual([]);
    expect(
      (await lint(cwd, [rule("CTX-001", { placeholders: ["LATER"] })]))
        .messages,
    ).toHaveLength(1);
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
      "glossary.md":
        "| Term | Aliases |\n| --- | --- |\n| GraphQL | graphql, gql |\n",
      "doc.md": "We use gql and graphql everywhere.\n",
    });
    const result = await lint(cwd, [
      rule("CTX-003", {
        glossary: "glossary.md",
        termColumn: "Term",
        aliasColumn: "Aliases",
        files: ["doc.md"],
      }),
    ]);
    expect(
      result.messages.map((message) => message.data?.alias).sort(),
    ).toEqual(["gql", "graphql"]);
    expect(
      result.messages.every((message) => message.data?.canonical === "GraphQL"),
    ).toBe(true);
  });

  it("scopes alias scanning to a named section, ignoring the same alias elsewhere", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": "| Term | Aliases |\n| --- | --- |\n| GraphQL | gql |\n",
      "doc.md": [
        "## Intro",
        "",
        "Uses gql here.",
        "",
        "## Notes",
        "",
        "Also mentions gql here.",
      ].join("\n"),
    });
    const result = await lint(cwd, [
      rule("CTX-003", {
        glossary: "glossary.md",
        termColumn: "Term",
        aliasColumn: "Aliases",
        section: "Intro",
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.line).toBe(3);
    expect(result.messages[0]?.data).toMatchObject({
      alias: "gql",
      canonical: "GraphQL",
    });
  });

  it("anchors each alias to its own line when aliases appear out of offset order", async () => {
    // The per-scan-target line index is queried in alias order, not offset order: `graphql` (line 3)
    // is resolved before `gql` (lines 1 and 5), so a forward-only cursor would misplace the later
    // aliases. Aliases are declared `graphql, gql` to fix that traversal order.
    const cwd = await fixtureRepo({
      "glossary.md":
        "| Term | Aliases |\n| --- | --- |\n| GraphQL | graphql, gql |\n",
      "doc.md": [
        "Intro about gql.",
        "",
        "Then graphql here.",
        "",
        "And gql again.",
      ].join("\n"),
    });
    const result = await lint(cwd, [
      rule("CTX-003", {
        glossary: "glossary.md",
        termColumn: "Term",
        aliasColumn: "Aliases",
        files: ["doc.md"],
      }),
    ]);

    expect(
      result.messages.map(
        (message) => `${String(message.data?.alias)}@${message.line}`,
      ),
    ).toEqual(["gql@1", "graphql@3", "gql@5"]);
  });

  it("counts every occurrence, including ones separated by a single space", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": "| Term | Aliases |\n| --- | --- |\n| GraphQL | gql |\n",
      "doc.md": "gql gql gql\n",
    });
    const result = await lint(cwd, [
      rule("CTX-003", {
        glossary: "glossary.md",
        termColumn: "Term",
        aliasColumn: "Aliases",
      }),
    ]);
    expect(result.messages).toHaveLength(3);
    expect(
      result.messages.every((message) => message.data?.alias === "gql"),
    ).toBe(true);
  });

  it("still requires whole-word boundaries (no separator means no match)", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": "| Term | Aliases |\n| --- | --- |\n| GraphQL | gql |\n",
      "doc.md": "gqlgql\n",
    });
    const result = await lint(cwd, [
      rule("CTX-003", {
        glossary: "glossary.md",
        termColumn: "Term",
        aliasColumn: "Aliases",
      }),
    ]);
    expect(result.messages).toEqual([]);
  });
});

// A rule that loaded no aliases can produce no finding, which used to be indistinguishable from a
// corpus that uses canonical terms everywhere: `No problems found.` and exit 0, with the rule inert
// since whichever day the glossary file or a column header was renamed. Every way to get there is
// now one error-severity finding attributed to the `glossary` option, naming the stage that came up
// empty — and `error` specifically, because the default `--fail-on` is `error`, so a warning would
// print and still exit 0.
describe("CTX-003 reports a configuration it cannot honour", () => {
  const WORKING_GLOSSARY =
    "| Term | Aliases |\n| --- | --- |\n| GraphQL | gql |\n";

  async function inertResult(options: Record<string, unknown>) {
    const cwd = await fixtureRepo({
      "glossary.md": WORKING_GLOSSARY,
      "doc.md": "We use gql here.\n",
    });
    return lint(cwd, [rule("CTX-003", options)]);
  }

  it("reports a glossary glob that matched no scanned document", async () => {
    const result = await inertResult({
      glossary: "nope.md",
      termColumn: "Term",
      aliasColumn: "Aliases",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      ruleId: "CTX-003",
      severity: "error",
      // Attributed to the config value, not to a corpus location: the thing to go and fix is the
      // string in the config, and there is no document at this path to attribute it to anyway.
      filePath: "nope.md",
      line: 0,
    });
    expect(result.messages[0]?.message).toContain("nope.md");
    expect(result.errorCount).toBe(1);
  });

  it("reports a glossary whose tables carry no termColumn", async () => {
    const result = await inertResult({
      glossary: "glossary.md",
      termColumn: "Concept",
      aliasColumn: "Aliases",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.severity).toBe("error");
    // Names the column, since the glossary itself resolved and reading it is not the fix.
    expect(result.messages[0]?.message).toContain('"Concept"');
  });

  it("reports an omitted aliasColumn, which can never derive an alias", async () => {
    const result = await inertResult({
      glossary: "glossary.md",
      termColumn: "Term",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toContain("aliasColumn");
  });

  it("reports an aliasColumn naming a header the glossary does not have", async () => {
    // The one inert mode no load-time check could ever catch: the config is well-formed, the
    // glossary is there, the term column is there, and the alias column is a typo.
    const result = await inertResult({
      glossary: "glossary.md",
      termColumn: "Term",
      aliasColumn: "Aliasess",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toContain('"Aliasess"');
  });

  it("stays quiet when the glossary does yield aliases", async () => {
    // The guard against the diagnostic firing on a working configuration: a rule that reports its
    // own health on every clean run is the same defect wearing the opposite sign.
    const result = await inertResult({
      glossary: "glossary.md",
      termColumn: "Term",
      aliasColumn: "Aliases",
      files: ["doc.md"],
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      severity: "warning",
      filePath: "doc.md",
      data: { alias: "gql", canonical: "GraphQL" },
    });
    expect(result.errorCount).toBe(0);
  });
});

// The CTX half of the shared `exclude` matrix. Both documents trip all three rules at once
// (an empty section, an unchecked box, an alias); `glossary.md` has no headings and no checklist, so
// it stays clean under CTX-001/CTX-002 and is self-skipped by CTX-003.
const CONTENT_DOC = "## Empty\n\n## Tasks\n\n- [ ] wire gql\n";
const GLOSSARY = "| Term | Aliases |\n| --- | --- |\n| GraphQL | gql |\n";

const CTX_SCOPE_CASES: readonly { id: string; options: object }[] = [
  { id: "CTX-001", options: {} },
  { id: "CTX-002", options: {} },
  {
    id: "CTX-003",
    options: {
      glossary: "glossary.md",
      termColumn: "Term",
      aliasColumn: "Aliases",
    },
  },
];

describe("CTX file scope (exclude)", () => {
  async function reportedFiles(
    cwd: string,
    configured: ConfiguredRule,
  ): Promise<string[]> {
    const result = await lint(cwd, [configured]);
    return [
      ...new Set(result.messages.map((message) => message.filePath)),
    ].sort(compareStrings);
  }

  it.each(CTX_SCOPE_CASES)(
    "$id drops an excluded document, with and without `files`",
    async ({ id, options }) => {
      const cwd = await fixtureRepo({
        "glossary.md": GLOSSARY,
        "docs/a.md": CONTENT_DOC,
        "drafts/b.md": CONTENT_DOC,
      });

      expect(await reportedFiles(cwd, rule(id, options))).toEqual([
        "docs/a.md",
        "drafts/b.md",
      ]);
      // The unscoped shape — `exclude` with no `files` beside it to carry the filtering.
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
});
