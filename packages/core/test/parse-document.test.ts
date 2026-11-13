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
      fragmentRange: { start: 22, end: 27 },
    });
  });

  it("records the visible label beside the source label only when inline HTML or a break differs", () => {
    const doc = parse(
      '[<em>here</em>](a.md) [`code` text](b.md) [<b></b>](c.md) [a\\\nb](d.md) [a<br>b](e.md) [a<br class="x">b](f.md) [a<brx>b](g.md)\n',
    );

    expect(
      doc.links.map(({ text, visibleText }) => ({ text, visibleText })),
    ).toEqual([
      { text: "<em>here</em>", visibleText: "here" },
      { text: "code text", visibleText: undefined },
      { text: "<b></b>", visibleText: "" },
      { text: "ab", visibleText: "a\nb" },
      { text: "a<br>b", visibleText: "a\nb" },
      { text: 'a<br class="x">b', visibleText: "a\nb" },
      { text: "a<brx>b", visibleText: "ab" },
    ]);
    expect("visibleText" in doc.links[1]!).toBe(false);
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

  it("extracts every image target with its line and column (classification deferred to REF-003)", () => {
    const doc = parse("![doc](d.md)\nx ![png](a.png)\n");

    expect(doc.images).toEqual([
      { rawTarget: "d.md", line: 1, column: 1 },
      { rawTarget: "a.png", line: 2, column: 3 },
    ]);
  });

  it("records empty and bare-fragment targets verbatim, so REF-008 can see them", () => {
    const doc = parse("[a]() [b](#) [c](<>) ![d]()\n");

    expect(doc.links.map((link) => link.rawTarget)).toEqual(["", "#", ""]);
    expect(doc.images).toEqual([{ rawTarget: "", line: 1, column: 22 }]);
  });

  it("resolves reference-style image definitions (not just reference-style links)", () => {
    const doc = parse("![Diagram][d]\n\n[d]: assets/diagram.png\n");
    expect(doc.images).toEqual([
      { rawTarget: "assets/diagram.png", line: 1, column: 1 },
    ]);
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

  // Same shared source cursor as reversed links: a lone CR is a line break, CRLF is one break.
  it.each([
    ["a lone CR", "x\ry [t][missing]\r"],
    ["CRLF", "x\r\ny [t][missing]\r\n"],
  ])("positions a record after %s on the parser's line", (_name, content) => {
    expect(refs(content)).toEqual([
      {
        label: "missing",
        kind: "link",
        referenceType: "full",
        line: 2,
        column: 3,
      },
    ]);
  });

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
    // remark splits the tags from their content, so masking the tags alone left this scanned.
    ["inline HTML code", "Use <code>[a][b]</code> or <KBD>[solo]</KBD>.\n"],
    // The first `</code>` closes only the inner element, so the brackets after it are still code.
    [
      "nested inline HTML code",
      "<code>a <code>b</code> [c][d] [solo]</code>\n",
    ],
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
      parsed: {
        ok: true,
        value: { name: "demo-skill", description: "does a thing" },
      },
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
      // As YAML the swallowed text is a comment plus a plain scalar, so it parses to a string root;
      // FM-001 reports that shape rather than accepting it as a mapping.
      parsed: { ok: true, value: "text" },
    });
    expect(doc.headings).toEqual([
      { text: "After", depth: 1, slug: "after", line: 9 },
    ]);
  });

  it("recognises an empty block", () => {
    const doc = parse("---\n---\n# T\n");

    expect(doc.frontmatter).toEqual({
      raw: "",
      startLine: 1,
      endLine: 2,
      parsed: { ok: true, value: null },
    });
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
      parsed: {
        ok: true,
        value: { name: "demo-skill", description: "does a thing" },
      },
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
      parsed: {
        ok: true,
        value: { name: "demo-skill", description: "does a thing" },
      },
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

// The YAML parse happens once, here, and every front matter reader trusts it. These pins are the
// security and schema-semantics contract: values stay the author's strings, nothing is constructed
// from a tag, and every way the parser could guess or blow up is a structured error instead.
describe("parseDocument · frontmatter YAML", () => {
  function parsed(block: string) {
    return parse(`---\n${block}\n---\n\n# T\n`).frontmatter?.parsed;
  }

  it("keeps every scalar as the string the author wrote (failsafe schema)", () => {
    expect(
      parsed(
        "version: 1.10\nenabled: yes\ncount: 007\ndate: 2026-01-01\nempty:\ntags: [a, b]\nowner:\n  team: core",
      ),
    ).toEqual({
      ok: true,
      value: {
        version: "1.10",
        enabled: "yes",
        count: "007",
        date: "2026-01-01",
        empty: "",
        tags: ["a", "b"],
        owner: { team: "core" },
      },
    });
  });

  // No type resolution is not the same as no decoding: YAML's string syntax still applies, so a
  // value checked against an allowed set or pattern is the decoded string, not the source bytes.
  it("still decodes quotes, escapes and block scalars as YAML defines them", () => {
    expect(
      parsed(
        "a: \"x\\u0041\"\nb: 'it''s'\nc: |\n  accepted\nd: |-\n  accepted\ne: >-\n  one\n  two",
      ),
    ).toEqual({
      ok: true,
      value: {
        a: "xA",
        b: "it's",
        c: "accepted\n",
        d: "accepted",
        e: "one two",
      },
    });
  });

  it("reports invalid YAML at the file line of the first problem, as one line", () => {
    const result = parsed("title: ok\nbad: [unclosed");

    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.error.line).toBe(3);
      expect(result.error.message).not.toContain("\n");
    }
  });

  it("treats a duplicate key as invalid rather than last-one-wins", () => {
    expect(parsed("a: 1\na: 2")).toEqual({
      ok: false,
      error: { message: "Map keys must be unique", line: 3 },
    });
  });

  it("treats an unknown or non-failsafe tag as invalid and constructs nothing", () => {
    for (const block of [
      "a: !!js/function 'x'",
      "a: !custom 1",
      "a: !!int 3",
    ]) {
      const result = parsed(block);
      expect(result?.ok, block).toBe(false);
      if (result?.ok === false) {
        expect(result.error.line).toBe(2);
        expect(result.error.message).toMatch(/^Unresolved tag/u);
      }
    }
  });

  it("treats a collection used as a key as invalid instead of stringifying it", () => {
    expect(parsed("? [a, b]\n: x")).toEqual({
      ok: false,
      error: { message: "Mapping keys must be plain scalars", line: 2 },
    });
  });

  it("keeps a `__proto__` key as an own property without touching Object.prototype", () => {
    const result = parsed("__proto__:\n  polluted: yes\nb: 1");

    expect(result?.ok).toBe(true);
    if (result?.ok === true) {
      const value = result.value as Record<string, unknown>;
      expect(Object.hasOwn(value, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    }
    expect((Object.prototype as Record<string, unknown>).polluted).toBe(
      undefined,
    );
  });

  it("keeps `<<` an ordinary key instead of merging", () => {
    expect(parsed("base: &b {x: 1}\nc:\n  <<: *b")).toEqual({
      ok: true,
      value: { base: { x: "1" }, c: { "<<": { x: "1" } } },
    });
  });

  it("bounds alias expansion and reports it at the opening fence", () => {
    const bomb = [
      "a: &a [x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c]",
      "e: [*d, *d, *d, *d, *d, *d, *d, *d, *d]",
    ].join("\n");
    const result = parsed(bomb);

    expect(result?.ok).toBe(false);
    if (result?.ok === false) {
      expect(result.error.line).toBe(1);
    }
  });

  it("reports a second YAML document inside the block as invalid", () => {
    // `...` ends a document without being a `---` fence, so the block holds two documents.
    const result = parsed("a: 1\n...\nb: 2");

    expect(result?.ok).toBe(false);
  });

  it("parses a non-mapping root as that value, leaving the shape check to the rules", () => {
    expect(parsed("- a\n- b")).toEqual({ ok: true, value: ["a", "b"] });
  });

  it("gives a CRLF checkout the identical parse", () => {
    const content = "---\nstatus: draft\nbad: [x\n---\n# T\n";

    expect(parse(content.replace(/\n/g, "\r\n")).frontmatter?.parsed).toEqual(
      parse(content).frontmatter?.parsed,
    );
  });
});

// micromark has no construct for `(text)[target]`, so these pins are the only thing that makes it
// visible. The first half proves a reversed link is recorded with its true source position wherever
// prose can hold one; the second half proves nothing that is code, escaped, a real link, or ordinary
// bracketed prose is recorded.
describe("parseDocument · reversed links", () => {
  function reversed(content: string) {
    return parse(content).reversedLinks;
  }

  it.each([
    ["a relative path", "(text)[./a.md]\n", "./a.md"],
    // The URL becomes a GFM autolink between two `text` nodes, so no single node holds the syntax.
    ["a URL", "(text)[https://example.com]\n", "https://example.com"],
    ["a www. autolink", "(text)[www.example.com]\n", "www.example.com"],
  ])(
    "records %s target with text, target and position",
    (_name, content, target) => {
      expect(reversed(content)).toEqual([
        { text: "text", target, line: 1, column: 1 },
      ]);
    },
  );

  it("reads emphasis inside the parens as written and balances nested parens", () => {
    expect(reversed("(*em*)[./a.md] and (a (b)\n c)[./x.md]\n")).toEqual([
      { text: "*em*", target: "./a.md", line: 1, column: 1 },
      { text: "a (b) c", target: "./x.md", line: 1, column: 20 },
    ]);
  });

  it("returns nested records in document order", () => {
    expect(reversed("((a)[./x.md] b)[./y.md]\n")).toEqual([
      { text: "(a)[./x.md] b", target: "./y.md", line: 1, column: 1 },
      { text: "a", target: "./x.md", line: 1, column: 2 },
    ]);
  });

  it("counts blockquote prefixes, table pipes and heading markers in the column", () => {
    expect(reversed("> first\n> then (t)[./a.md]\n")).toEqual([
      { text: "t", target: "./a.md", line: 2, column: 8 },
    ]);
    expect(reversed("| a |\n| - |\n| q (t)[./a.md] |\n")).toEqual([
      { text: "t", target: "./a.md", line: 3, column: 5 },
    ]);
    expect(reversed("## Head (t)[./a.md]\n")).toEqual([
      { text: "t", target: "./a.md", line: 1, column: 9 },
    ]);
  });

  it.each([
    ["a code span", "`(text)[./a.md]`\n"],
    ["a fenced block", "```\n(text)[./a.md]\n```\n"],
    // remark splits `<code>…</code>` into two `html` tag nodes around a `text` node, so masking the
    // tags alone left the content scanned; emphasis inside moves the closing tag one level deeper.
    ["inline HTML code", "Use <code>(text)[./a.md]</code>.\n"],
    ["inline HTML code around emphasis", "<code>a *(t)[./a.md]* b</code>\n"],
    ["an unclosed inline HTML code element", "<kbd>(t)[./a.md]\n"],
    // The first `</code>` closes only the inner element, so the syntax after it is still code.
    [
      "nested inline HTML code",
      "<code>outer <code>inner</code> (t)[./a.md]</code>\n",
    ],
    [
      "nested inline HTML code around emphasis",
      "<kbd>a *<kbd>b</kbd>* (t)[./a.md]</kbd>\n",
    ],
    ["an indented block", "    (text)[./a.md]\n"],
    ["escaped parens", "\\(text\\)[./a.md]\n"],
    ["escaped brackets", "(text)\\[./a.md\\]\n"],
    ["entity-encoded parens", "&#40;text&#41;[./a.md]\n"],
    ["a space before the bracket", "(see below) [1]\n"],
    ["a non-target bracket", "(see below)[1] (sic)[WIP]\n"],
    [
      "a defined shortcut reference",
      "(see the guide)[guide]\n\n[guide]: ./g.md\n",
    ],
    ["a defined full reference", "(note)[x][d]\n\n[d]: ./d.md\n"],
    ["an inline link", "(note)[x](u)\n"],
    ["a closer with no opener", ":)[./a.md]\n"],
    ["empty parens", "()[./a.md]\n"],
    ["whitespace in the bracket", "(text)[./a b.md]\n"],
  ])("does not record %s", (_name, content) => {
    expect(reversed(content)).toEqual([]);
  });

  // Only literal-content elements are skipped: the content of `<b>` renders as prose, so reversed
  // syntax there is on the page; a closed `<code>` before it must not swallow it either.
  it("still records reversed syntax inside an ordinary inline element and after a closed code element", () => {
    expect(reversed("<b>(t)[./a.md]</b> <code>x</code> (u)[./b.md]\n")).toEqual(
      [
        { text: "t", target: "./a.md", line: 1, column: 4 },
        { text: "u", target: "./b.md", line: 1, column: 35 },
      ],
    );
  });

  // A raw-text element holds no markup, so a `<script>` written inside one is text and the first
  // `</script>` really does end it; what follows is prose again.
  // Written mid-paragraph: a line opening with `<script>` is an HTML block, which is masked whole.
  it("ends a raw-text element at its first closing tag, nested opener or not", () => {
    expect(reversed("x <script>a <script> b</script> (t)[./a.md]\n")).toEqual([
      { text: "t", target: "./a.md", line: 1, column: 33 },
    ]);
  });

  // A lone CR is a line break to micromark, so counting LF alone put the record on the line
  // before the one the parser (and an editor) shows. CRLF must still count once, not twice.
  it.each([
    ["a lone CR", "x\r(text)[./a.md]\r"],
    ["CRLF", "x\r\n(text)[./a.md]\r\n"],
  ])("positions a record after %s on the parser's line", (_name, content) => {
    expect(reversed(content)).toEqual([
      { text: "text", target: "./a.md", line: 2, column: 1 },
    ]);
  });

  it("is an empty array for a plain document", () => {
    expect(reversed("# Plain\n\ntext (aside) here.\n")).toEqual([]);
  });
});

describe("parseDocument · first block", () => {
  const first = (content: string) => parse(content).firstBlock;

  it("is null when nothing renders", () => {
    expect(first("")).toBeNull();
    expect(first("---\ntitle: X\n---\n")).toBeNull();
    expect(first("<!-- only a comment -->\n")).toBeNull();
  });

  it("reports a leading heading at its real line, after front matter too", () => {
    expect(first("# Title\n")).toEqual({ type: "heading", line: 1 });
    expect(first("---\ntitle: X\n---\n\n# Title\n")).toEqual({
      type: "heading",
      line: 5,
    });
    expect(first("Title\n=====\n")).toEqual({ type: "heading", line: 1 });
  });

  it("reports leading prose as a paragraph", () => {
    expect(first("Some text.\n\n# Title\n")).toEqual({
      type: "paragraph",
      line: 1,
    });
  });

  it("skips comments, directives and link definitions, but not rendered HTML", () => {
    expect(
      first("<!-- wastech-mdlint-disable -->\n\n[x]: ./y.md\n\n# Title\n"),
    ).toEqual({ type: "heading", line: 5 });
    expect(first("<!-- a -->\n<!-- b -->\n\n# Title\n")).toEqual({
      type: "heading",
      line: 4,
    });
    expect(first('<img src="badge.svg">\n\n# Title\n')).toEqual({
      type: "html",
      line: 1,
    });
  });

  // A heading inside a container is not a document title, so the container is what came first.
  it("reports the container, not a heading nested inside it", () => {
    expect(first("> # Quoted\n")).toEqual({ type: "blockquote", line: 1 });
  });

  it("gives the same lines for a CRLF document", () => {
    expect(first("---\r\ntitle: X\r\n---\r\n\r\nText.\r\n")).toEqual({
      type: "paragraph",
      line: 5,
    });
  });
});

describe("parseDocument · emphasis paragraphs", () => {
  const emphasis = (content: string) => parse(content).emphasisParagraphs;

  it("records a top-level strong or emphasis paragraph with its kind and line", () => {
    expect(emphasis("# T\n\n**Installation**\n\n_Usage_\n")).toEqual([
      { text: "Installation", kind: "strong", line: 3 },
      { text: "Usage", kind: "emphasis", line: 5 },
    ]);
    expect(emphasis("__A__\n\n*B*\n")).toEqual([
      { text: "A", kind: "strong", line: 1 },
      { text: "B", kind: "emphasis", line: 3 },
    ]);
  });

  // Anything besides a single plain-text run is styled prose, not a stand-in heading.
  it("skips mixed paragraphs and nested formatting, code or links", () => {
    expect(emphasis("**A** text\n")).toEqual([]);
    expect(emphasis("**A**\\\n")).toEqual([]);
    expect(emphasis("***A***\n")).toEqual([]);
    expect(emphasis("**Install `npm`**\n")).toEqual([]);
    expect(emphasis("**[link](x.md)**\n")).toEqual([]);
  });

  it("skips emphasis inside a list item, blockquote or table cell", () => {
    expect(emphasis("- **A**\n")).toEqual([]);
    expect(emphasis("> **A**\n")).toEqual([]);
    expect(emphasis("| H |\n| --- |\n| **A** |\n")).toEqual([]);
  });

  it("does not record a setext heading whose text is emphasis", () => {
    expect(emphasis("**A**\n---\n")).toEqual([]);
  });

  it("keeps multi-line text for the rule to judge", () => {
    expect(emphasis("**A\nB**\n")).toEqual([
      { text: "A\nB", kind: "strong", line: 1 },
    ]);
  });

  it("reports the real line after front matter and under CRLF", () => {
    expect(emphasis("---\ntitle: X\n---\n\n**A**\n")).toEqual([
      { text: "A", kind: "strong", line: 5 },
    ]);
    expect(emphasis("# T\r\n\r\n**A**\r\n")).toEqual([
      { text: "A", kind: "strong", line: 3 },
    ]);
  });
});

// The source offsets a `--fix` writes to. Each one is asserted by slicing `content` with it, because
// that is exactly what a fix does: an offset that is right on paper but wrong against the real
// bytes is the defect these fields exist to prevent.
describe("parseDocument · fix offsets", () => {
  function fragmentText(content: string): (string | undefined)[] {
    const doc = parse(content);
    return doc.links.map((link) =>
      link.fragmentRange === undefined
        ? undefined
        : content.slice(link.fragmentRange.start, link.fragmentRange.end),
    );
  }

  it("records the fragment bytes of inline same-file and cross-file links", () => {
    expect(
      fragmentText(
        "[a](#Demo) and [b](docs/b.md#Over-view) and [c]( <c.md#X> )\n",
      ),
    ).toEqual(["Demo", "Over-view", "X"]);
  });

  it("leaves fragmentRange unset where the bytes cannot be located exactly", () => {
    expect(
      fragmentText(
        [
          "[ref][r] [plain](b.md) [esc](#a\\_b) [ent](#a&amp;b) [web](https://x.y/#z)",
          "",
          "[r]: #shared",
          "",
        ].join("\n"),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("records the fragment on CRLF input, including a destination on the next line", () => {
    const content = "Intro\r\n\r\n[a](\r\n#Demo) and [b](#Two)\r\n";
    expect(fragmentText(content)).toEqual(["Demo", "Two"]);
  });

  it("records reference definitions with label, offsets, top-level and referenced", () => {
    const content = [
      "[full][One] [Two][] [three] ![img][Four]",
      "",
      "[one]: a.md",
      "[TWO]: b.md",
      "[three]: c.md",
      "[four]: d.png",
      "[unused]: e.md",
      "",
      "> [quoted]: f.md",
      "",
    ].join("\r\n");
    const doc = parse(content);
    expect(
      doc.referenceDefinitions.map((definition) => [
        definition.label,
        definition.line,
        content.slice(definition.start, definition.end),
        definition.topLevel,
        definition.referenced,
      ]),
    ).toEqual([
      ["one", 3, "[one]: a.md", true, true],
      ["TWO", 4, "[TWO]: b.md", true, true],
      ["three", 5, "[three]: c.md", true, true],
      ["four", 6, "[four]: d.png", true, true],
      ["unused", 7, "[unused]: e.md", true, false],
      ["quoted", 9, "[quoted]: f.md", false, false],
    ]);
  });

  it("excludes the label text of shortcut and collapsed references but keeps full-reference text", () => {
    const content =
      "[gql] [*gql* x][] [the gql][gql]\n\n[gql]: a.md\n[*gql* x]: b.md\n";
    const doc = parse(content);
    expect(
      doc.textSpans.map((span) => content.slice(span.start, span.end)),
    ).toEqual([" ", " ", "the gql"]);
  });

  it("records only the brackets the parse left as literal text", () => {
    const content =
      "[gql] and [real](a.md) and \\[esc\\] and [*x* y] and `[code]`\n";
    const doc = parse(content);
    expect(doc.literalBrackets.map((offset) => content[offset])).toEqual([
      "[",
      "]",
      "[",
      "]",
    ]);
    expect(doc.literalBrackets).toEqual([
      0,
      4,
      content.indexOf("[*x*"),
      content.indexOf("y]") + 1,
    ]);
  });

  it("records only verbatim prose as text spans, with the heading slug where there is one", () => {
    const content = [
      "# Head *api*",
      "",
      "Use `api` and [the api](api.md) or <https://api.x> www.api.com &amp; x",
      "",
      "```",
      "api",
      "```",
      "",
      "<div>api</div>",
      "",
      "tail api\r\nline",
      "",
    ].join("\n");
    const doc = parse(content);
    expect(
      doc.textSpans.map((span) => [
        content.slice(span.start, span.end),
        span.headingSlug,
      ]),
    ).toEqual([
      ["Head ", "head-api"],
      ["api", "head-api"],
      ["Use ", undefined],
      [" and ", undefined],
      ["the api", undefined],
      [" or ", undefined],
      [" ", undefined],
      ["tail api\r\nline", undefined],
    ]);
  });
});
