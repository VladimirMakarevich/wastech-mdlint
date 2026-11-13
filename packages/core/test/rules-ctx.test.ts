import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { applyFixes } from "../src/engine/fix.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { RuleResolutionError } from "../src/engine/registry.js";
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

  // Frontmatter used to be a setext H2 whose "section" ran to the next heading, so it took part in
  // the empty-section scan under a name made of YAML text. Only real sections may be judged now,
  // and the reported line must still be the absolute source line. `---` is configured as a
  // placeholder because the old section body was exactly its own setext underline: with the
  // defaults that body is never empty, so the invented section would pass unnoticed and this test
  // could not tell the old parse from the new one.
  it("judges only real sections in a document with frontmatter", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "---\ntitle: x\n---\n\n# Title\n\n## Empty\n\n## Filled\n\ntext\n",
    });
    const result = await lint(cwd, [
      rule("CTX-001", { placeholders: ["---"] }),
    ]);
    expect(
      result.messages.map((message) => [message.line, message.data?.section]),
    ).toEqual([[7, "Empty"]]);
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

describe("CTX-004 descriptive link text", () => {
  async function linkTexts(content: string, options?: unknown) {
    const cwd = await fixtureRepo({ "a.md": content });
    const result = await lint(cwd, [rule("CTX-004", options)]);
    return result.messages.map((message) => message.data?.text);
  }

  it("reports default phrases as warnings at the link", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "# T\n\nSee [here](b.md) or [подробнее](c.md).\n\nRead the [installation guide](d.md).\n",
    });

    const result = await lint(cwd, [rule("CTX-004")]);
    expect(
      result.messages.map(({ ruleId, severity, filePath, line, message }) => ({
        ruleId,
        severity,
        filePath,
        line,
        message,
      })),
    ).toEqual([
      {
        ruleId: "CTX-004",
        severity: "warning",
        filePath: "a.md",
        line: 3,
        message:
          'Link text "here" does not describe its target; name what the link leads to.',
      },
      {
        ruleId: "CTX-004",
        severity: "warning",
        filePath: "a.md",
        line: 3,
        message:
          'Link text "подробнее" does not describe its target; name what the link leads to.',
      },
    ]);
    expect(result.errorCount).toBe(0);
  });

  it("replaces the defaults with `phrases`", async () => {
    expect(
      await linkTexts("[here](a.md) [Docs](b.md)\n", { phrases: ["docs"] }),
    ).toEqual(["Docs"]);
  });

  it("extends the defaults with `additionalPhrases`", async () => {
    expect(
      await linkTexts("[here](a.md) [docs](b.md) [guide](c.md)\n", {
        additionalPhrases: ["Docs!"],
      }),
    ).toEqual(["here", "docs"]);
  });

  it("extends a replaced list when both are given", async () => {
    expect(
      await linkTexts("[here](a.md) [docs](b.md) [see](c.md)\n", {
        phrases: ["docs"],
        additionalPhrases: ["see"],
      }),
    ).toEqual(["docs", "see"]);
  });

  it("validates its options and resolves bare", () => {
    expect(() => ruleRegistry.resolveRule("CTX-004")).not.toThrow();
    for (const options of [
      { phrases: [] },
      { phrases: ["..."] },
      { additionalPhrases: ["→"] },
      { phrases: "here" },
      { bogus: true },
    ]) {
      expect(() => ruleRegistry.resolveRule("CTX-004", options)).toThrow(
        RuleResolutionError,
      );
    }
  });

  it("honours an inline disable on the link's line", async () => {
    expect(
      await linkTexts(
        "<!-- wastech-mdlint-disable-next-line CTX-004 -->\nSee [here](a.md).\n",
      ),
    ).toEqual([]);
  });
});

// The CTX half of the shared `exclude` matrix. Both documents trip all four rules at once
// (an empty section, an unchecked box, an alias, a "here" link); `glossary.md` has no headings, no
// checklist and no links, so it stays clean under CTX-001/CTX-002/CTX-004 and is self-skipped by
// CTX-003.
const CONTENT_DOC =
  "## Empty\n\n## Tasks\n\n- [ ] wire gql\n\nSee [here](a.md).\n";
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
  { id: "CTX-004", options: {} },
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

describe("CTX-003 --fix", () => {
  const GLOSSARY = [
    "| Term | Aliases |",
    "| --- | --- |",
    "| GraphQL | gql |",
    "| API key | apikey, key |",
    "| Token | tok, tok id |",
    "",
  ].join("\n");
  const OPTIONS = {
    glossary: "glossary.md",
    termColumn: "Term",
    aliasColumn: "Aliases",
  };

  async function fixTwice(cwd: string, options: unknown = OPTIONS) {
    const input = {
      cwd,
      config: { rules: [] },
      rules: [rule("CTX-003", options)],
      settings: {},
    };
    const first = await applyFixes(input);
    const afterFirst = await readFile(path.join(cwd, "a.md"), "utf8");
    const second = await applyFixes(input);
    const afterSecond = await readFile(path.join(cwd, "a.md"), "utf8");
    return { first, afterFirst, second, afterSecond };
  }

  it("replaces an alias in prose, keeps the text around it, and is a no-op the second time", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": GLOSSARY,
      "a.md": "We call the gql endpoint (gql!) twice.\n",
    });
    const { first, afterFirst, second, afterSecond } = await fixTwice(cwd);
    expect(first.fixedFiles).toEqual(["a.md"]);
    expect(afterFirst).toBe("We call the GraphQL endpoint (GraphQL!) twice.\n");
    expect(second.fixedFiles).toEqual([]);
    expect(afterSecond).toBe(afterFirst);
    await expect(readFile(path.join(cwd, "glossary.md"), "utf8")).resolves.toBe(
      GLOSSARY,
    );
  });

  it("skips code spans, code blocks, link and definition targets, HTML and front matter, but fixes link text", async () => {
    const content = [
      "---",
      "title: gql",
      "---",
      "",
      "Use `gql` and [the gql docs](gql.md) and [ref][r].",
      "",
      "```",
      "gql",
      "```",
      "",
      "<div>gql</div>",
      "",
      "[r]: gql.md",
      "",
    ].join("\n");
    const cwd = await fixtureRepo({ "glossary.md": GLOSSARY, "a.md": content });
    const before = await lint(cwd, [rule("CTX-003", OPTIONS)]);
    expect(
      before.messages.map((message) => [message.line, message.fixable]),
    ).toEqual([
      [2, undefined],
      [5, undefined],
      [5, true],
      [5, undefined],
      [8, undefined],
      [11, undefined],
      [13, undefined],
    ]);
    const { afterFirst, afterSecond } = await fixTwice(cwd);
    // The one fixable finding is the only change in the file.
    expect(afterFirst).toBe(
      content.replace("[the gql docs]", "[the GraphQL docs]"),
    );
    expect(afterSecond).toBe(afterFirst);
  });

  it("rewrites a heading only when no anchor link points into its document", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": GLOSSARY,
      "a.md": "# The gql guide\n\nText.\n",
      "b.md": "# The gql notes\n\nText.\n",
      "c.md": "[see](a.md#the-gql-guide)\n",
    });
    const before = await lint(cwd, [rule("CTX-003", OPTIONS)]);
    expect(
      before.messages.map((message) => [message.filePath, message.fixable]),
    ).toEqual([
      ["a.md", undefined],
      ["b.md", true],
      // The link target in c.md is reported too, and is never a place to rewrite.
      ["c.md", undefined],
    ]);
    await fixTwice(cwd);
    await expect(readFile(path.join(cwd, "a.md"), "utf8")).resolves.toBe(
      "# The gql guide\n\nText.\n",
    );
    await expect(readFile(path.join(cwd, "b.md"), "utf8")).resolves.toBe(
      "# The GraphQL notes\n\nText.\n",
    );
  });

  it("does not substitute a canonical term that contains an alias", async () => {
    // `key` is an alias of `API key`, so replacing `key` would produce text that still holds `key`.
    const cwd = await fixtureRepo({
      "glossary.md": GLOSSARY,
      "a.md": "Rotate the key and the apikey.\n",
    });
    const before = await lint(cwd, [rule("CTX-003", OPTIONS)]);
    expect(
      before.messages.map((message) => [message.data?.alias, message.fixable]),
    ).toEqual([
      ["apikey", undefined],
      ["key", undefined],
    ]);
    const { first, afterFirst } = await fixTwice(cwd);
    expect(first.fixedFiles).toEqual([]);
    expect(afterFirst).toBe("Rotate the key and the apikey.\n");
  });

  // Each replacement is harmless alone, but together `foo baz` becomes `bar qux`, which is itself
  // an alias. Judged one at a time both look fixable, and a second `--fix` would then rewrite the
  // result again; judged as one span, neither is fixed and the file never changes.
  // In `[gql]` and `[gql][]` the text is also the label that finds `[gql]: …`, so replacing it would
  // leave the link pointing nowhere and the definition unused — which REF-009 would then delete,
  // so a second `--fix` would change the file again. A full `[the gql][gql]` keeps its label apart
  // from its text, and that text is fixed.
  it("leaves shortcut and collapsed reference labels alone, also beside REF-009 on a second run", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": GLOSSARY,
      "a.md": "See [gql], [gql][] and [the gql][gql].\n\n[gql]: g.md\n",
    });
    const rules = [rule("CTX-003", OPTIONS), rule("REF-009")];
    const input = { cwd, config: { rules: [] }, rules, settings: {} };

    // Four alias occurrences on line 1 — the shortcut label, the collapsed label, the full
    // reference's text and its label — and one in the definition. Only the full reference's text is
    // fixable. Counted rather than listed: findings on one line with one message carry no column, so
    // their relative order is not part of the contract.
    const before = await lint(cwd, rules);
    expect(
      before.messages.map((message) => [message.ruleId, message.line]),
    ).toEqual([
      ["CTX-003", 1],
      ["CTX-003", 1],
      ["CTX-003", 1],
      ["CTX-003", 1],
      ["CTX-003", 3],
    ]);
    expect(
      before.messages.filter((message) => message.fixable === true),
    ).toHaveLength(1);

    await applyFixes(input);
    const fixed = await readFile(path.join(cwd, "a.md"), "utf8");
    expect(fixed).toBe(
      "See [gql], [gql][] and [the GraphQL][gql].\n\n[gql]: g.md\n",
    );
    expect((await applyFixes(input)).fixedFiles).toEqual([]);
    await expect(readFile(path.join(cwd, "a.md"), "utf8")).resolves.toBe(fixed);
  });

  // The rewrite is byte-exact but Markdown is read from context, so a term can be reported and still
  // be unsafe to write. Each case below changes how the line parses if the alias is replaced: a
  // canonical `A\\|B` (parsed from the glossary as `A|B`) adds a table column, `C*` opens emphasis,
  // and `example.com` after `user@` makes an email autolink. Each is reported without `fixable`,
  // and the plain alias on the last line is still fixed.
  it("withholds a rewrite that would change how the surrounding Markdown parses", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": [
        "| Term | Aliases |",
        "| --- | --- |",
        "| A\\|B | tbl |",
        "| C* | star |",
        "| example.com | dom |",
        "| GraphQL | gql |",
        "",
      ].join("\n"),
      "a.md": [
        "| Name | Note |",
        "| --- | --- |",
        "| tbl | x |",
        "",
        "A star here.",
        "",
        "Mail user@dom today.",
        "",
        "Plain gql.",
        "",
      ].join("\n"),
    });
    const before = await lint(cwd, [rule("CTX-003", OPTIONS)]);
    expect(
      before.messages.map((message) => [
        message.line,
        message.data?.alias,
        message.fixable,
      ]),
    ).toEqual([
      [3, "tbl", undefined],
      [5, "star", undefined],
      [7, "dom", undefined],
      [9, "gql", true],
    ]);
    const { afterFirst, afterSecond } = await fixTwice(cwd);
    expect(afterFirst.split("\n").slice(0, 8)).toEqual([
      "| Name | Note |",
      "| --- | --- |",
      "| tbl | x |",
      "",
      "A star here.",
      "",
      "Mail user@dom today.",
      "",
    ]);
    expect(afterFirst.split("\n")[8]).toBe("Plain GraphQL.");
    expect(afterSecond).toBe(afterFirst);
  });

  // `[gql]` with no `[gql]: …` definition renders as plain text, but `[GraphQL]` would become a link
  // to the `[GraphQL]: …` definition. So an alias between literal brackets is never rewritten,
  // with or without REF-009 beside it — and with it, the definition stays unused, so REF-009 is
  // the one that removes it, once.
  it.each([
    ["alone", false],
    ["beside REF-009", true],
  ])(
    "does not turn literal [alias] text into a reference link (%s)",
    async (_label, withRef009) => {
      const content = "See [gql] and [the gql here].\n\n[GraphQL]: g.md\n";
      const cwd = await fixtureRepo({
        "glossary.md": GLOSSARY,
        "a.md": content,
      });
      const rules = withRef009
        ? [rule("CTX-003", OPTIONS), rule("REF-009")]
        : [rule("CTX-003", OPTIONS)];
      const input = { cwd, config: { rules: [] }, rules, settings: {} };

      const before = await lint(cwd, [rule("CTX-003", OPTIONS)]);
      expect(before.messages.map((message) => message.fixable)).toEqual([
        undefined,
        undefined,
      ]);

      await applyFixes(input);
      const first = await readFile(path.join(cwd, "a.md"), "utf8");
      expect(first).toBe(
        withRef009 ? "See [gql] and [the gql here].\n\n" : content,
      );
      expect((await applyFixes(input)).fixedFiles).toEqual([]);
      await expect(readFile(path.join(cwd, "a.md"), "utf8")).resolves.toBe(
        first,
      );
    },
  );

  it("withholds replacements that together spell another alias, so a second run changes nothing", async () => {
    const content = "We use foo baz here.\n";
    const cwd = await fixtureRepo({
      "glossary.md": [
        "| Term | Aliases |",
        "| --- | --- |",
        "| bar | foo |",
        "| qux | baz |",
        "| other | bar qux |",
        "",
      ].join("\n"),
      "a.md": content,
    });
    const before = await lint(cwd, [rule("CTX-003", OPTIONS)]);
    expect(
      before.messages.map((message) => [message.data?.alias, message.fixable]),
    ).toEqual([
      ["foo", undefined],
      ["baz", undefined],
    ]);
    const { first, afterFirst, second, afterSecond } = await fixTwice(cwd);
    expect(first.fixedFiles).toEqual([]);
    expect(afterFirst).toBe(content);
    expect(second.fixedFiles).toEqual([]);
    expect(afterSecond).toBe(content);
  });

  // REF-002's fix turns `#GQL` into `#gql` in the same run, so the `# gql` heading becomes a link
  // target even though no fragment matched it exactly beforehand — and the graph has no edge for a
  // fragment that did not resolve. Renaming the heading in that run would break the link REF-002
  // just repaired, from the same file and from another.
  it("leaves a heading alone when REF-002 is fixing a case-only link to it in the same run", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": GLOSSARY,
      "a.md": "# gql\n\nSee [top](#GQL).\n",
      "b.md": "Read [a](a.md#Gql).\n",
    });
    const rules = [rule("REF-002"), rule("CTX-003", OPTIONS)];
    const input = { cwd, config: { rules: [] }, rules, settings: {} };

    const before = await lint(cwd, rules);
    expect(
      before.messages.map((message) => [
        message.ruleId,
        message.filePath,
        message.fixable,
      ]),
    ).toEqual([
      ["CTX-003", "a.md", undefined],
      ["REF-002", "a.md", true],
      ["REF-002", "b.md", true],
    ]);

    await applyFixes(input);
    const a = await readFile(path.join(cwd, "a.md"), "utf8");
    const b = await readFile(path.join(cwd, "b.md"), "utf8");
    expect(a).toBe("# gql\n\nSee [top](#gql).\n");
    expect(b).toBe("Read [a](a.md#gql).\n");
    // What remains is CTX-003 alone: the heading it may not rename, and the now-lowercase fragments,
    // which are link targets and so are reported but never rewritten.
    expect(
      (await lint(cwd, rules)).messages.map((message) => [
        message.ruleId,
        message.filePath,
        message.line,
        message.fixable,
      ]),
    ).toEqual([
      ["CTX-003", "a.md", 1, undefined],
      ["CTX-003", "a.md", 3, undefined],
      ["CTX-003", "b.md", 1, undefined],
    ]);

    expect((await applyFixes(input)).fixedFiles).toEqual([]);
    await expect(readFile(path.join(cwd, "a.md"), "utf8")).resolves.toBe(a);
    await expect(readFile(path.join(cwd, "b.md"), "utf8")).resolves.toBe(b);
  });

  it("resolves aliases overlapping at the same start longest first, in one run", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": GLOSSARY,
      "a.md": "Send the tok id and a tok.\n",
    });
    const before = await lint(cwd, [rule("CTX-003", OPTIONS)]);
    expect(
      before.messages.map((message) => [message.data?.alias, message.fixable]),
    ).toEqual([
      ["tok id", true],
      ["tok", undefined],
      ["tok", true],
    ]);
    const { afterFirst, second, afterSecond } = await fixTwice(cwd);
    expect(afterFirst).toBe("Send the Token and a Token.\n");
    expect(second.fixedFiles).toEqual([]);
    expect(afterSecond).toBe(afterFirst);
  });

  it("rewrites only the configured section, and leaves out-of-scope files alone", async () => {
    const content = "# Overview\n\nThe gql API.\n\n# Other\n\nThe gql API.\n";
    const cwd = await fixtureRepo({
      "glossary.md": GLOSSARY,
      "a.md": content,
      "drafts/b.md": content,
    });
    await fixTwice(cwd, {
      ...OPTIONS,
      section: "Overview",
      exclude: ["drafts/**"],
    });
    await expect(readFile(path.join(cwd, "a.md"), "utf8")).resolves.toBe(
      "# Overview\n\nThe GraphQL API.\n\n# Other\n\nThe gql API.\n",
    );
    await expect(
      readFile(path.join(cwd, "drafts", "b.md"), "utf8"),
    ).resolves.toBe(content);
  });

  // Built at runtime: `.gitattributes` forces LF on committed files.
  it("keeps CRLF line endings, including inside a multi-line paragraph", async () => {
    const cwd = await fixtureRepo({
      "glossary.md": GLOSSARY,
      "a.md": "First gql line\r\nsecond gql line\r\n",
    });
    const { afterFirst, afterSecond } = await fixTwice(cwd);
    expect(afterFirst).toBe("First GraphQL line\r\nsecond GraphQL line\r\n");
    expect(afterSecond).toBe(afterFirst);
  });

  // Section scanning moved from an extracted, `\r`-stripped body to source offsets so a match can be
  // rewritten in place. The findings themselves must not move: same lines, same order, on LF and on
  // CRLF alike, including for a nested section that runs to the next same-level heading.
  it("reports the same section-scoped findings and lines on LF and CRLF", async () => {
    const lf = [
      "# Intro",
      "gql before",
      "## Overview",
      "gql one",
      "### Sub",
      "gql two",
      "## Next",
      "gql after",
      "",
    ].join("\n");
    const cwd = await fixtureRepo({
      "glossary.md": GLOSSARY,
      "lf.md": lf,
      "crlf.md": lf.replace(/\n/g, "\r\n"),
    });
    const result = await lint(cwd, [
      rule("CTX-003", { ...OPTIONS, section: "Overview" }),
    ]);
    expect(
      result.messages.map((message) => [message.filePath, message.line]),
    ).toEqual([
      ["crlf.md", 4],
      ["crlf.md", 6],
      ["lf.md", 4],
      ["lf.md", 6],
    ]);
  });
});
