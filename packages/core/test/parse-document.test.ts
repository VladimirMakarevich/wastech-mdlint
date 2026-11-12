import { describe, expect, it } from "vitest";

import type { Paragraph } from "mdast";

import { parseDocument } from "../src/markdown/parse-document.js";
import { extractUndefinedReferences } from "../src/markdown/undefined-references.js";

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
      { line: 5, cells: { ID: "REQ-1", Owner: "Ann" }, cellCount: 2 },
    ]);
  });

  it("defaults missing trailing cells to empty strings", () => {
    const doc = parse(
      ["| A | B |", "| --- | --- |", "| only |", ""].join("\n"),
    );

    expect(doc.tables[0]?.rows[0]?.cells).toEqual({ A: "only", B: "" });
    // The padding must not hide the short row: the written count stays 1.
    expect(doc.tables[0]?.rows[0]?.cellCount).toBe(1);
  });

  it("keeps the written cell count of an over-long row while cells holds only header keys", () => {
    const doc = parse(
      ["| A | B |", "| --- | --- |", "| 1 | 2 | 3 |", ""].join("\n"),
    );

    expect(doc.tables[0]?.rows[0]).toEqual({
      line: 3,
      cells: { A: "1", B: "2" },
      cellCount: 3,
    });
  });

  it("does not count an escaped pipe as a cell separator", () => {
    const doc = parse(
      ["| A | B |", "| --- | --- |", "| x \\| y | z |", ""].join("\n"),
    );

    expect(doc.tables[0]?.rows[0]).toEqual({
      line: 3,
      cells: { A: "x | y", B: "z" },
      cellCount: 2,
    });
  });

  it("does not count an escaped pipe inside a code span as a separator", () => {
    const doc = parse(
      ["| A | B |", "| --- | --- |", "| `p\\|q` | z |", ""].join("\n"),
    );

    expect(doc.tables[0]?.rows[0]).toEqual({
      line: 3,
      cells: { A: "p|q", B: "z" },
      cellCount: 2,
    });
  });

  // GFM splits table cells before inline parsing, so an unescaped `|` inside backticks is a cell
  // separator — GitHub renders it that way too. The written count follows micromark rather than a
  // hand-rolled tokenizer, so TBL-007 agrees with the renderer and with `cells`.
  it("counts an unescaped pipe inside backticks as a separator, as GFM does", () => {
    const doc = parse(
      ["| A | B |", "| --- | --- |", "| `p|q` | z |", ""].join("\n"),
    );

    expect(doc.tables[0]?.rows[0]?.cellCount).toBe(3);
  });

  it("records the row line of a table inside a blockquote", () => {
    const doc = parse(
      ["Intro", "", "> | A | B |", "> | --- | --- |", "> | 1 |", ""].join("\n"),
    );

    expect(doc.tables[0]?.rows[0]).toMatchObject({ line: 5, cellCount: 1 });
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
      rows: [
        { line: 5, cells: { 項目: "名前", 値: "山田太郎" }, cellCount: 2 },
      ],
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

describe("parseDocument · html anchors", () => {
  it("collects inline `<a id>` and `<a name>` anchors with their lines", () => {
    const doc = parse(
      '# T\n\nSee <a id="custom"></a> here.\n\n<a name="n"></a>\n',
    );

    expect(doc.htmlAnchors).toEqual([
      { id: "custom", line: 3 },
      { id: "n", line: 5 },
    ]);
  });

  it("collects `id` on any element, on the right line of a multi-line block", () => {
    const doc = parse('<div>\n  <p>x</p>\n  <span id="d">y</span>\n</div>\n');

    expect(doc.htmlAnchors).toEqual([{ id: "d", line: 3 }]);
  });

  it("ignores `name` on a non-anchor element and look-alike attributes", () => {
    const doc = parse(
      '<input name="field">\n\n<div data-id="x" aid="y"></div>\n',
    );

    expect(doc.htmlAnchors).toEqual([]);
  });

  // An unanchored search for `id=` used to read text inside another attribute's quoted value as an
  // attribute, and a tag search that ignored quotes found a `<span>` written inside one. Both
  // invented anchors that exist nowhere on the rendered page.
  it("reads nothing from inside a quoted attribute value", () => {
    const doc = parse(
      [
        `<div title="foo id='ghost1'" data-x='name="ghost2"'></div>`,
        "",
        `<a title="a <span id='ghost3'> b > c" id="real">x</a>`,
        "",
      ].join("\n"),
    );

    expect(doc.htmlAnchors).toEqual([{ id: "real", line: 3 }]);
  });

  // HTML drops every repeat of an attribute after the first, in any letter case, so a later `id` or
  // `name` names nothing on the rendered page — including after an empty first value.
  it("keeps only the first occurrence of a repeated attribute", () => {
    const doc = parse(
      [
        '<a id="real" id="ghost1" ID="ghost2" name="n" NAME="ghost3"></a>',
        "",
        '<div id="" id="ghost4"></div>',
        "",
      ].join("\n"),
    );

    expect(doc.htmlAnchors).toEqual([
      { id: "real", line: 1 },
      { id: "n", line: 1 },
    ]);
  });

  // A browser reads the content of these elements as text up to the matching end tag, so a tag
  // written inside a script string or a textarea is not an anchor. Inline HTML is split by remark
  // into one node per tag, which is why the inline and the unclosed cases need state carried across
  // nodes; the `<!--` inside the script must not hide the `</script>` that closes it.
  it("collects nothing inside raw-text elements, block or inline", () => {
    const doc = parse(
      [
        "<script>",
        `const x = '<a id="ghost1">'; // <!--`,
        "</script>",
        "",
        `Inline <style>.c{content:'<a id="ghost2">'}</style> then <a id="after"></a>.`,
        "",
        `<textarea id="box"><a name="ghost3"></a></TEXTAREA><div id="kept"></div>`,
        "",
        'Open <script> here <a id="ghost4"></a>',
        "",
        '<a id="ghost5"></a>',
        "",
      ].join("\n"),
    );

    expect(doc.htmlAnchors).toEqual([
      { id: "after", line: 5 },
      { id: "box", line: 7 },
      { id: "kept", line: 7 },
    ]);
  });

  it("accepts single-quoted, unquoted and uppercase attributes", () => {
    const doc = parse("<a id='s'></a> <A NAME=u></A> <p ID=\"up\"></p>\n");

    expect(doc.htmlAnchors.map((anchor) => anchor.id)).toEqual([
      "s",
      "u",
      "up",
    ]);
  });

  it("collects nothing from comments, inline code, fenced code or frontmatter", () => {
    const doc = parse(
      [
        "---",
        'title: <a id="fm"></a>',
        "---",
        "",
        '<!-- <a id="commented"></a> -->',
        "",
        'Code `<a id="inline"></a>` only.',
        "",
        "```html",
        '<a id="fenced"></a>',
        "```",
        "",
      ].join("\n"),
    );

    expect(doc.htmlAnchors).toEqual([]);
  });

  it("is an empty array for a document with no HTML", () => {
    expect(parse("# Plain\n\ntext\n").htmlAnchors).toEqual([]);
  });
});

// micromark leaves a reference with an undefined label as plain text, so these pins are the only
// thing that makes such a construct visible. The cases fall into two halves: every reference-shaped
// attempt is recorded with a true source position, and nothing that merely looks like one is.
describe("parseDocument · undefined references", () => {
  function refs(content: string) {
    return parse(content).undefinedReferences;
  }

  it("records full, image, collapsed and shortcut forms with source positions", () => {
    expect(refs("[text][missing] ![alt][missing] [m][] [solo]\n")).toEqual([
      {
        label: "missing",
        kind: "link",
        referenceType: "full",
        line: 1,
        column: 1,
      },
      {
        label: "missing",
        kind: "image",
        referenceType: "full",
        line: 1,
        column: 17,
      },
      {
        label: "m",
        kind: "link",
        referenceType: "collapsed",
        line: 1,
        column: 33,
      },
      {
        label: "solo",
        kind: "link",
        referenceType: "shortcut",
        line: 1,
        column: 39,
      },
    ]);
  });

  it("matches definitions case-insensitively and across whitespace, leaving `links` unchanged", () => {
    const doc = parse(
      "[t][def] [t][DEF] [t][ d  e\nf ] [Def][]\n\n[Def]: u.md\n[d e f]: v.md\n",
    );

    expect(doc.undefinedReferences).toEqual([]);
    expect(doc.links.map((link) => link.rawTarget)).toEqual([
      "u.md",
      "u.md",
      "v.md",
      "u.md",
    ]);
  });

  it.each([
    ["a code span", "`[a][b]` and `[solo]`\n"],
    ["a fenced block", "```\n[a][b]\n[solo]\n```\n"],
    ["an inline HTML attribute", '<span title="[a][b]">x</span>\n'],
    ["escaped brackets", "\\[a\\]\\[b\\]\n"],
    ["entity-encoded brackets", "&#91;a&#93;&#91;b&#93;\n"],
    ["frontmatter", "---\nx: [a][b]\n---\n\nBody.\n"],
    ["a footnote call", "Text[^1].\n"],
    ["a collapsed footnote call", "Text [^1][].\n"],
    ["a GitHub alert marker", "> [!NOTE]\n> Read this.\n"],
    ["a failed inline link", "[a](<bad)\n"],
    ["task-list checkboxes", "- [x] done\n- [ ] todo\n"],
    [
      "brackets around a resolved inline link",
      "[[a](u.md)][def]\n\n[def]: z.md\n",
    ],
  ])("records nothing for %s", (_name, content) => {
    expect(refs(content)).toEqual([]);
  });

  // Only `[^1]` itself is footnote syntax. Written as the label of a full reference, a leading `^`
  // renders as literal brackets when undefined, exactly like any other missing label.
  it("records a full link or image reference whose label starts with `^`", () => {
    expect(refs("[text][^missing] ![alt][^gone]\n")).toEqual([
      {
        label: "^missing",
        kind: "link",
        referenceType: "full",
        line: 1,
        column: 1,
      },
      {
        label: "^gone",
        kind: "image",
        referenceType: "full",
        line: 1,
        column: 18,
      },
    ]);
  });

  // Each position used to be found by recounting newlines from the start of the container, which
  // made a paragraph of many undefined references quadratic. The extractor is driven directly over
  // a synthetic paragraph so parse time does not mask that cost: at this size the quadratic shape
  // runs for minutes and times the test out, while a linear scan finishes in milliseconds.
  it("keeps exact positions, in linear time, across a paragraph with many references", () => {
    const count = 50_000;
    const content =
      Array.from({ length: count }, (_, index) => `x [t][m${index}]`).join(
        "\n",
      ) + "\n";
    const paragraph: Paragraph = {
      type: "paragraph",
      children: [],
      position: {
        start: { line: 1, column: 1, offset: 0 },
        end: { line: count, column: 1, offset: content.length - 1 },
      },
    };
    const found = extractUndefinedReferences(paragraph, content, new Map());

    expect(found).toHaveLength(count);
    expect(found[count - 1]).toEqual({
      label: `m${count - 1}`,
      kind: "link",
      referenceType: "full",
      line: count,
      column: 3,
    });
  });

  it("does not make an image of an escaped `!`", () => {
    expect(refs("\\![a][b]\n")).toEqual([
      { label: "b", kind: "link", referenceType: "full", line: 1, column: 3 },
    ]);
  });

  it("reads emphasis and balanced brackets inside link text as one full reference", () => {
    expect(refs("[*em*][missing] [a [b] c][missing]\n")).toEqual([
      {
        label: "missing",
        kind: "link",
        referenceType: "full",
        line: 1,
        column: 1,
      },
      {
        label: "missing",
        kind: "link",
        referenceType: "full",
        line: 1,
        column: 17,
      },
    ]);
  });

  it("keeps the source label of a collapsed reference around a code span", () => {
    expect(refs("[`code`][]\n")).toMatchObject([
      { label: "`code`", referenceType: "collapsed" },
    ]);
  });

  it("reports true source columns on a later line, in a blockquote, table cell and heading", () => {
    const content = [
      "line one",
      "see [x][y] here",
      "",
      "> quote",
      "> and [q][r]",
      "",
      "| A | B |",
      "|---|---|",
      "| [c][d] | e |",
      "",
      "## Head [h][i]",
      "",
    ].join("\n");

    expect(
      refs(content).map((reference) => [
        reference.label,
        reference.line,
        reference.column,
      ]),
    ).toEqual([
      ["y", 2, 5],
      ["r", 5, 7],
      ["d", 9, 3],
      ["i", 11, 9],
    ]);
  });

  it("counts lines the same way under CRLF line endings", () => {
    expect(refs("one\r\ntwo [a][b]\r\n")).toEqual([
      { label: "b", kind: "link", referenceType: "full", line: 2, column: 5 },
    ]);
  });

  it("is deterministic across two parses", () => {
    const content = "[a][x] ![b][y]\n\n| [c][z] |\n|---|\n";
    expect(refs(content)).toEqual(refs(content));
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
