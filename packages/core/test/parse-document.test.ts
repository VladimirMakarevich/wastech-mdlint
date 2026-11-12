import { describe, expect, it } from "vitest";

import { parseDocument } from "../src/markdown/parse-document.js";

function parse(content: string, filePath = "doc.md") {
  return parseDocument({ path: filePath, content });
}

describe("parseDocument · headings & sections", () => {
  it("captures heading text, depth, github slug, and line", () => {
    const doc = parse("# Title\n\n## Details\n");

    expect(doc.headings).toEqual([
      { text: "Title", depth: 1, slug: "title", line: 1 },
      { text: "Details", depth: 2, slug: "details", line: 3 },
    ]);
    expect(doc.sections).toEqual(["Title", "Details"]);
  });

  it("dedupes duplicate slugs in document order (github-slugger verbatim)", () => {
    const doc = parse("# Heading\n## Heading\n### Heading\n");

    expect(doc.headings.map((heading) => heading.slug)).toEqual([
      "heading",
      "heading-1",
      "heading-2",
    ]);
  });

  it("preserves CJK / Unicode heading text and slugs verbatim", () => {
    const doc = parse("# 概要 テスト\n## Привет мир\n");

    expect(
      doc.headings.map((heading) => ({
        text: heading.text,
        slug: heading.slug,
      })),
    ).toEqual([
      { text: "概要 テスト", slug: "概要-テスト" },
      { text: "Привет мир", slug: "привет-мир" },
    ]);
  });
});

describe("parseDocument · tables", () => {
  it("keys cells by header and records section + line", () => {
    const doc = parse(
      [
        "## Requirements",
        "",
        "| ID | Owner |",
        "| --- | --- |",
        "| REQ-1 | Ann |",
        "",
      ].join("\n"),
    );

    expect(doc.tables).toHaveLength(1);
    const [table] = doc.tables;
    expect(table?.headers).toEqual(["ID", "Owner"]);
    expect(table?.section).toBe("Requirements");
    expect(table?.line).toBe(3);
    expect(table?.rows).toEqual([
      { line: 5, cells: { ID: "REQ-1", Owner: "Ann" } },
    ]);
  });

  it("defaults missing trailing cells to empty strings", () => {
    const doc = parse(
      ["| A | B |", "| --- | --- |", "| only |", ""].join("\n"),
    );

    expect(doc.tables[0]?.rows[0]?.cells).toEqual({ A: "only", B: "" });
  });

  it("leaves section undefined when a table precedes every heading", () => {
    const doc = parse(["| A |", "| --- |", "| x |", ""].join("\n"));

    expect(doc.tables[0]?.section).toBeUndefined();
  });

  it("assigns the most-recent heading of any level as the section", () => {
    const doc = parse(
      ["## Outer", "", "### Inner", "", "| A |", "| --- |", "| v |", ""].join(
        "\n",
      ),
    );

    expect(doc.tables[0]?.section).toBe("Inner");
  });
});

describe("parseDocument · checklist", () => {
  it("reports checked state, text, section, and line", () => {
    const doc = parse(
      ["## Todos", "", "- [x] done", "- [ ] pending", ""].join("\n"),
    );

    expect(doc.checkItems).toEqual([
      { text: "done", checked: true, section: "Todos", line: 3 },
      { text: "pending", checked: false, section: "Todos", line: 4 },
    ]);
  });

  it("ignores plain (non-task) list items", () => {
    const doc = parse("- plain bullet\n");

    expect(doc.checkItems).toEqual([]);
  });
});

describe("parseDocument · links & images", () => {
  it("keeps label text, anchor, kind, and position for local links", () => {
    const doc = parse("[Guide](docs/guide.md#intro)\n");

    expect(doc.links[0]).toEqual({
      rawTarget: "docs/guide.md#intro",
      text: "Guide",
      anchor: "intro",
      kind: "local-file",
      line: 1,
      column: 1,
    });
  });

  it("classifies same-file anchors, external, mailto, and other schemes", () => {
    const doc = parse(
      [
        "[a](#sec)",
        "[b](https://example.com)",
        "[c](mailto:x@y.z)",
        "[d](vscode://f)",
      ].join("\n"),
    );

    expect(
      doc.links.map((link) => ({ kind: link.kind, anchor: link.anchor })),
    ).toEqual([
      { kind: "same-file-anchor", anchor: "sec" },
      { kind: "external", anchor: undefined },
      { kind: "mailto", anchor: undefined },
      { kind: "other", anchor: undefined },
    ]);
  });

  it("resolves reference-style link definitions", () => {
    const doc = parse("[Guide][g]\n\n[g]: docs/guide.md\n");

    expect(doc.links[0]).toMatchObject({
      rawTarget: "docs/guide.md",
      text: "Guide",
      kind: "local-file",
    });
  });

  it("decodes percent-encoded anchors so they match slugs", () => {
    const doc = parse("[t](a.md#%D1%82%D0%B5%D1%81%D1%82)\n");

    expect(doc.links[0]?.anchor).toBe("тест");
  });

  it("extracts every image target with its line (classification deferred to REF-003)", () => {
    const doc = parse("![doc](d.md)\n![png](a.png)\n");

    expect(doc.images).toEqual([
      { rawTarget: "d.md", line: 1 },
      { rawTarget: "a.png", line: 2 },
    ]);
  });

  it("resolves reference-style image definitions (not just reference-style links)", () => {
    const doc = parse("![Diagram][d]\n\n[d]: assets/diagram.png\n");
    expect(doc.images).toEqual([{ rawTarget: "assets/diagram.png", line: 1 }]);
  });
});

describe("parseDocument · CJK content and anchors", () => {
  it("captures CJK table and checklist content, not just headings", () => {
    const doc = parse(
      [
        "## 概要",
        "",
        "| 項目 | 値 |",
        "| --- | --- |",
        "| 名前 | 山田太郎 |",
        "",
        "- [x] 完了ですタスク",
        "- [ ] 未完了のタスク",
      ].join("\n"),
    );

    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]).toEqual({
      headers: ["項目", "値"],
      section: "概要",
      line: 3,
      rows: [{ line: 5, cells: { 項目: "名前", 値: "山田太郎" } }],
    });
    expect(doc.checkItems).toEqual([
      { text: "完了ですタスク", checked: true, section: "概要", line: 7 },
      { text: "未完了のタスク", checked: false, section: "概要", line: 8 },
    ]);
  });

  it("decodes a percent-encoded CJK anchor so it matches a heading slug", () => {
    const doc = parse("[t](a.md#%E6%A6%82%E8%A6%81)\n");
    expect(doc.links[0]?.anchor).toBe("概要");
  });
});

describe("parseDocument · eager imports", () => {
  it("extracts @path.md imports with position", () => {
    const doc = parse("See @docs/glossary.md for terms.\n");

    expect(doc.imports).toEqual([
      { rawTarget: "@docs/glossary.md", line: 1, column: 5 },
    ]);
  });

  it("does not treat @paths inside code as imports", () => {
    const doc = parse("```\n@docs/ignored.md\n```\n`@inline.md`\n");

    expect(doc.imports).toEqual([]);
  });

  it("gives each import in a multi-line block its own line and column", () => {
    // remark merges these three consecutive lines into one `text` node; the block starts at line 3
    // (not 1) so a fix that only works by coincidence at the top of a file still fails.
    const doc = parse(
      [
        "Intro line.",
        "",
        "@AGENTS.md",
        "@.agents/rules/architecture.md",
        "@.agents/rules/coding-style.md",
        "",
      ].join("\n"),
    );

    expect(doc.imports).toEqual([
      { rawTarget: "@AGENTS.md", line: 3, column: 1 },
      { rawTarget: "@.agents/rules/architecture.md", line: 4, column: 1 },
      { rawTarget: "@.agents/rules/coding-style.md", line: 5, column: 1 },
    ]);
  });

  it("anchors column to the matched import, not an earlier @-substring on the line", () => {
    // `foo@early.md` is not an import (the `@` is not at a word boundary), so only the second token
    // matches — the column must point at that match, not the earlier `@early.md` text on the line.
    const doc = parse("foo@early.md see @late.md here\n");

    expect(doc.imports).toEqual([
      { rawTarget: "@late.md", line: 1, column: 18 },
    ]);
  });

  it("gives repeated identical imports on one line their own columns", () => {
    const doc = parse("@a.md @a.md\n");

    expect(doc.imports).toEqual([
      { rawTarget: "@a.md", line: 1, column: 1 },
      { rawTarget: "@a.md", line: 1, column: 7 },
    ]);
  });

  it("gives each import in separate paragraphs its own line", () => {
    // Two paragraphs are two `text` nodes; each import's line must come from its own node, not from
    // an unrelated `@` elsewhere in the document.
    const doc = parse("@a.md\n\n@b.md\n");

    expect(doc.imports).toEqual([
      { rawTarget: "@a.md", line: 1, column: 1 },
      { rawTarget: "@b.md", line: 3, column: 1 },
    ]);
  });

  it("reports a continuation-line column past the start of that line", () => {
    // Guards the continuation-line column arithmetic: every other multi-line case here lands the
    // import at column 1, which would still pass even if the offset math were degenerate. Here the
    // second line has leading text, so the `@` sits at column 6 of its own physical line.
    const doc = parse("intro\ntext @a.md\n");

    expect(doc.imports).toEqual([{ rawTarget: "@a.md", line: 2, column: 6 }]);
  });

  it("reports the source column when the text node starts mid-line", () => {
    // `**x**` is a separate strong node, so the import's text node starts at column 6, not 1. The
    // first-line column must add the node's own start column, not assume the node begins the line.
    const doc = parse("**x** @a.md\n");

    expect(doc.imports).toEqual([{ rawTarget: "@a.md", line: 1, column: 7 }]);
  });
});

describe("parseDocument · inline-disable directives", () => {
  it("extracts disable / enable / disable-next-line with kind, ids, and line", () => {
    const doc = parse(
      [
        "<!-- wastech-mdlint-disable REF-001 -->",
        "text",
        "<!-- wastech-mdlint-enable REF-001 -->",
        "<!-- wastech-mdlint-disable-next-line TBL-002 -->",
      ].join("\n"),
    );

    expect(doc.directives).toEqual([
      { kind: "disable", ruleIds: ["REF-001"], line: 1 },
      { kind: "enable", ruleIds: ["REF-001"], line: 3 },
      { kind: "disable-next-line", ruleIds: ["TBL-002"], line: 4 },
    ]);
  });

  it("records a directive with no rule ids as all-rules (empty ruleIds)", () => {
    const doc = parse("<!-- wastech-mdlint-disable -->\n");

    expect(doc.directives).toEqual([{ kind: "disable", ruleIds: [], line: 1 }]);
  });

  it("normalizes rule ids to canonical form and accepts comma / space separators", () => {
    const doc = parse("<!-- wastech-mdlint-disable ref001, tbl-2 -->\n");

    expect(doc.directives[0]?.ruleIds).toEqual(["REF-001", "TBL-2"]);
  });

  it("tolerates malformed or unknown directives (ignored, not fatal)", () => {
    const doc = parse(
      [
        "<!-- wastech-mdlint-frobnicate REF-001 -->",
        "<!-- just a comment -->",
      ].join("\n"),
    );

    expect(doc.directives).toEqual([]);
  });
});

describe("parseDocument · determinism", () => {
  it("produces byte-identical output across two parses of the same input", () => {
    const content = [
      "# Title",
      "",
      "| ID | Owner |",
      "| --- | --- |",
      "| REQ-1 | Ann |",
      "",
      "- [x] done",
      "",
      "[Guide](docs/guide.md#intro)",
      "@docs/glossary.md",
      "<!-- wastech-mdlint-disable REF-001 -->",
    ].join("\n");

    const first = parse(content);
    const second = parse(content);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

// Frontmatter used to parse as a thematic break plus a setext H2, inventing the heading
// "name: demo-skill\ndescription: does a thing" and the slug below. Every consumer that reads
// `headings`/`sections` saw that heading, so the parser-level pins here are the root of the fix.
const FRONTMATTER_DOC =
  "---\nname: demo-skill\ndescription: does a thing\n---\n\n# Title\n\nBody text.\n";

describe("parseDocument · frontmatter", () => {
  it("exposes the raw block and its inclusive fence-to-fence line range", () => {
    expect(parse(FRONTMATTER_DOC).frontmatter).toEqual({
      raw: "name: demo-skill\ndescription: does a thing",
      startLine: 1,
      endLine: 4,
    });
  });

  it("produces no heading or section for the block, and the first real heading keeps its slug and line", () => {
    const doc = parse(FRONTMATTER_DOC);

    expect(doc.headings).toEqual([
      { text: "Title", depth: 1, slug: "title", line: 6 },
    ]);
    expect(doc.sections).toEqual(["Title"]);
  });

  it("keeps the frontmatter bytes in `content` so size and offsets stay whole-file", () => {
    expect(parse(FRONTMATTER_DOC).content).toBe(FRONTMATTER_DOC);
  });

  it("exposes absence as an explicit null that survives serialization", () => {
    const doc = parse("# Title\n");

    expect(doc.frontmatter).toBeNull();
    expect("frontmatter" in doc).toBe(true);
    expect(JSON.parse(JSON.stringify(doc))).toHaveProperty("frontmatter", null);
  });

  it("leaves a later `---` as a thematic break that adds no heading", () => {
    const doc = parse(`${FRONTMATTER_DOC}\n---\n\n## Next\n`);

    expect(doc.frontmatter?.endLine).toBe(4);
    expect(doc.headings.map((heading) => heading.text)).toEqual([
      "Title",
      "Next",
    ]);
  });

  it("still parses a mid-document setext H2", () => {
    const doc = parse(`${FRONTMATTER_DOC}\nParagraph\n---\n`);

    expect(
      doc.headings.map((heading) => [heading.text, heading.depth]),
    ).toEqual([
      ["Title", 1],
      ["Paragraph", 2],
    ]);
  });

  it("does not treat an unclosed opening fence as frontmatter", () => {
    const doc = parse("---\nname: x\n\n# Title\n");

    expect(doc.frontmatter).toBeNull();
    expect(doc.headings).toEqual([
      { text: "Title", depth: 1, slug: "title", line: 4 },
    ]);
  });

  it("does not treat an unclosed fence with no heading as frontmatter", () => {
    const doc = parse("---\nname: x\ndescription: y\n");

    expect(doc.frontmatter).toBeNull();
    expect(doc.headings).toEqual([]);
  });

  // Recognition is anchored to the very start of the file. A block that starts one line down is
  // ordinary Markdown again, setext heading included — that is the standard behaviour every
  // remark-based tool and GitHub share.
  it("only recognises a block whose opening fence is the first line", () => {
    const doc = parse("\n---\nname: x\n---\n# T\n");

    expect(doc.frontmatter).toBeNull();
  });

  // The extension does no YAML validation, so a file that opens with a horizontal rule and has a
  // later `---` line has everything between the two treated as frontmatter, real headings included.
  // That is the documented contract (use `***` or `___` for a rule on line 1), pinned here so it
  // stays a deliberate one.
  it("swallows everything up to the next `---` line when line 1 is `---`", () => {
    const doc = parse("---\n\n# Heading\n\ntext\n\n---\n\n# After\n");

    expect(doc.frontmatter).toEqual({
      raw: "\n# Heading\n\ntext\n",
      startLine: 1,
      endLine: 7,
    });
    expect(doc.headings).toEqual([
      { text: "After", depth: 1, slug: "after", line: 9 },
    ]);
  });

  it("recognises an empty block", () => {
    const doc = parse("---\n---\n# T\n");

    expect(doc.frontmatter).toEqual({ raw: "", startLine: 1, endLine: 2 });
    expect(doc.headings).toEqual([{ text: "T", depth: 1, slug: "t", line: 3 }]);
  });

  // Built at runtime: `.gitattributes` forces `eol=lf` on committed files, so a checked-in CRLF
  // fixture would silently become LF.
  it("normalises CRLF in `raw` without moving any line number", () => {
    const doc = parse(FRONTMATTER_DOC.replace(/\n/g, "\r\n"));

    expect(doc.frontmatter).toEqual({
      raw: "name: demo-skill\ndescription: does a thing",
      startLine: 1,
      endLine: 4,
    });
    expect(doc.headings).toEqual([
      { text: "Title", depth: 1, slug: "title", line: 6 },
    ]);
  });

  it("recognises a block behind a UTF-8 byte-order mark", () => {
    const doc = parse(`\uFEFF${FRONTMATTER_DOC}`);

    expect(doc.frontmatter).toEqual({
      raw: "name: demo-skill\ndescription: does a thing",
      startLine: 1,
      endLine: 4,
    });
    expect(doc.headings.map((heading) => heading.slug)).toEqual(["title"]);
  });

  it("extracts no link, import or directive from inside the block, and keeps absolute lines after it", () => {
    const doc = parse(
      [
        "---",
        "see: [x](other.md)",
        "ref: @other.md",
        "<!-- wastech-mdlint-disable -->",
        "---",
        "",
        "# Title",
        "",
        "<!-- wastech-mdlint-disable-next-line REF-001 -->",
        "[real](real.md)",
        "",
      ].join("\n"),
    );

    expect(doc.links.map((link) => [link.rawTarget, link.line])).toEqual([
      ["real.md", 10],
    ]);
    expect(doc.imports).toEqual([]);
    expect(doc.directives).toEqual([
      { kind: "disable-next-line", ruleIds: ["REF-001"], line: 9 },
    ]);
  });
});
