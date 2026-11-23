import { describe, expect, it } from "vitest";

import { diffText, headChanges, parseDocument } from "@wastech-mdlint/core";

import { type ResolvedTarget } from "../src/corpus.js";
import {
  renderDocument,
  type RenderedDocument,
} from "../src/render-document.js";

// A document rendered with what changed between `base` and `head`, as a changed document's page
// renders it. Only `kept.md` exists, so a link anywhere else resolves to nothing.
function renderChange(base: string, head: string): Promise<RenderedDocument> {
  const resolve = (_from: string, target: string): ResolvedTarget =>
    target === "kept.md"
      ? { kind: "document", path: "kept.md" }
      : { kind: "missing" };
  return renderDocument(
    parseDocument({ path: "doc.md", content: head }),
    {
      resolve,
      resolveEmbedded: (target) => Promise.resolve(resolve("doc.md", target)),
    },
    {
      changes: headChanges(diffText(base, head)),
      basePath: "doc.md",
      baseText: base,
    },
  );
}

// The opening tag of every marked block, in page order, read back from the HTML.
function marks(html: string): string[] {
  return [
    ...html.matchAll(/<([a-z0-9]+)[^>]*data-change="([a-z]+)"[^>]*>/g),
  ].map((match) => `${match[1]} ${match[2]}`);
}

const lines = (...text: string[]) => `${text.join("\n")}\n`;

describe("marking changed blocks", () => {
  it("marks only the changed paragraph", async () => {
    const { html } = await renderChange(
      lines("# T", "", "Kept.", "", "Write in the present tense."),
      lines("# T", "", "Kept.", "", "Write in the past tense."),
    );
    expect(marks(html)).toEqual(["p changed"]);
    expect(html).toContain(
      '<p data-line="5" data-line-end="5" data-change="changed" data-change-hunks="0">Write in the past tense.</p>',
    );
  });

  it("marks the changed list item, not the list", async () => {
    const { html } = await renderChange(
      lines("# T", "", "- one", "- two", "- three"),
      lines("# T", "", "- one", "- two, edited", "- three"),
    );
    expect(marks(html)).toEqual(["li changed"]);
    expect(html).toMatch(
      /<ul>\s*<li data-line="3" data-line-end="3">one<\/li>/,
    );
  });

  it("marks a nested item and not the item it is nested in", async () => {
    const { html } = await renderChange(
      lines("# T", "", "- outer", "  - inner one", "  - inner two"),
      lines("# T", "", "- outer", "  - inner one", "  - inner two, edited"),
    );
    expect(marks(html)).toEqual(["li changed"]);
    expect(html).toContain(
      '<li data-line="5" data-line-end="5" data-change="changed"',
    );
  });

  // Each scrolls or is drawn as a whole, so a change to any of its lines marks the whole of it.
  it("marks a table, a code block and the front matter each as one unit", async () => {
    const base = lines(
      "---",
      "title: Old",
      "---",
      "",
      "# T",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```sh",
      "echo one",
      "echo two",
      "```",
    );
    const head = base
      .replace("title: Old", "title: New")
      .replace("| 1 | 2 |", "| 1 | 3 |")
      .replace("echo two", "echo three");
    const rendered = await renderChange(base, head);
    expect(marks(rendered.html)).toEqual(["div changed", "div changed"]);
    expect(rendered.html).toContain(
      '<div class="source-line" data-line="7" data-line-end="9" data-change="changed" data-change-hunks="0"><table>',
    );
    expect(rendered.html).toContain(
      '<div class="source-line" data-line="11" data-line-end="14" data-change="changed" data-change-hunks="0"><div class="code-block">',
    );
    expect(rendered.frontmatterChange).toEqual({ kind: "changed", hunks: [0] });
  });

  it("marks a new block added, once, however many items it holds", async () => {
    const { html } = await renderChange(
      lines("# T", "", "Kept."),
      lines(
        "# T",
        "",
        "Kept.",
        "",
        "A new paragraph.",
        "",
        "- new item",
        "- another",
      ),
    );
    expect(marks(html)).toEqual(["p added", "li added", "li added"]);
    const nested = await renderChange(
      lines("# T", "", "- kept"),
      lines("# T", "", "- kept", "- new", "  - new inside it"),
    );
    expect(marks(nested.html)).toEqual(["li added"]);
  });

  it("marks a block that lost a line from inside it changed", async () => {
    const { html } = await renderChange(
      lines("# T", "", "| a |", "| - |", "| 1 |", "| 2 |"),
      lines("# T", "", "| a |", "| - |", "| 1 |"),
    );
    expect(marks(html)).toEqual(["div changed"]);
    expect(html).not.toContain("change-removed");
  });

  // The lost line stood between two head lines that belong to different blocks; which block it was
  // part of is read from the base, where it was its paragraph's first line or its last.
  it("marks the block that lost its first or last line, not its neighbor", async () => {
    const first = await renderChange(
      lines("# T", "## H", "Old first line", "Kept line"),
      lines("# T", "## H", "Kept line"),
    );
    expect(marks(first.html)).toEqual(["p changed"]);
    const last = await renderChange(
      lines("# T", "", "Kept line", "Old last line", "## H"),
      lines("# T", "", "Kept line", "## H"),
    );
    expect(marks(last.html)).toEqual(["p changed"]);
  });

  // Removing an item from a loose list removes the blank line beside it too; that line was the
  // list's spacing, not a line its neighbor lost.
  it("leaves the neighbors of a removed loose-list item unmarked", async () => {
    const { html } = await renderChange(
      lines("# T", "", "- one", "", "- two", "", "- three"),
      lines("# T", "", "- one", "", "- three"),
    );
    expect(marks(html)).toEqual([]);
    expect(html).toContain("<summary>1 list item removed</summary>");
  });

  it("marks nothing in a document whose text did not change", async () => {
    const text = lines(
      "---",
      "title: Same",
      "---",
      "",
      "# T",
      "",
      "- a",
      "",
      "Text.",
    );
    const rendered = await renderChange(text, text);
    expect(rendered.html).not.toContain("data-change");
    expect(rendered.html).not.toContain("change-removed");
    expect(rendered.frontmatterChange).toBeUndefined();
  });
});

describe("putting back removed blocks", () => {
  it("folds a removed paragraph between the blocks it stood between", async () => {
    const { html } = await renderChange(
      lines("# T", "", "Before.", "", "Gone <em>now</em>.", "", "After."),
      lines("# T", "", "Before.", "", "After."),
    );
    expect(html).toMatch(
      /<p data-line="3" data-line-end="3">Before\.<\/p>\s*<details class="change-removed"><summary>1 block removed<\/summary><div class="change-removed-body"><p>Gone <em>now<\/em>\.<\/p><\/div><\/details>\s*<p data-line="5" data-line-end="5">After\.<\/p>/,
    );
  });

  it("puts a removed item back inside its list, as an item numbered as it was", async () => {
    const { html } = await renderChange(
      lines("# T", "", "1. one", "2. two", "3. three"),
      lines("# T", "", "1. one", "2. three"),
    );
    expect(html).toMatch(
      /<li data-line="3" data-line-end="3">one<\/li>\s*<li class="change-removed-item"><details class="change-removed"><summary>1 list item removed<\/summary><div class="change-removed-body"><ol start="2"><li>two<\/li><\/ol><\/div><\/details><\/li><li data-line="4"/,
    );
  });

  it("puts back a whole removed list as one block, not item by item", async () => {
    const { html } = await renderChange(
      lines("# T", "", "Kept.", "", "- a", "- b", "", "End."),
      lines("# T", "", "Kept.", "", "End."),
    );
    expect(html).toContain(
      '<summary>1 block removed</summary><div class="change-removed-body"><ul>',
    );
    expect(html).not.toContain("list item removed");
  });

  it("shares one fold between neighbors removed from the same place", async () => {
    const { html } = await renderChange(
      lines("# T", "", "## Gone", "", "Its text.", "", "## Kept"),
      lines("# T", "", "## Kept"),
    );
    expect(html.match(/<details class="change-removed">/g)).toHaveLength(1);
    expect(html).toContain("<summary>2 blocks removed</summary>");
  });

  // The removed copy keeps nothing that ties it to its place in the base: a base line number names
  // a line of another text, and a copied id would let a link land on the removed heading.
  it("drops line numbers and ids from the removed copy", async () => {
    const { html } = await renderChange(
      lines("# T", "", "## Gone heading", "", "## Kept"),
      lines("# T", "", "## Kept"),
    );
    expect(html).toContain("<h2>Gone heading</h2>");
    expect(html).not.toContain('id="gone-heading"');
  });

  it("highlights a removed code block like any other", async () => {
    const { html } = await renderChange(
      lines("# T", "", "```ts", "const gone = 1;", "```", "", "End."),
      lines("# T", "", "End."),
    );
    expect(html).toMatch(
      /<div class="change-removed-body"><div class="code-block"><button class="code-copy"[^>]*>Copy<\/button><pre class="shiki/,
    );
  });

  // A link resolved against what the base held would look fine while pointing nowhere today.
  it("resolves a removed block's links against the current documents", async () => {
    const { html } = await renderChange(
      lines("# T", "", "See [kept](kept.md) and [gone](gone.md).", "", "End."),
      lines("# T", "", "End."),
    );
    expect(html).toContain('<a href="/doc/kept.md">kept</a>');
    expect(html).toMatch(/<a href="gone\.md" class="link-missing"/);
  });

  it("puts back front matter the branch removed, above the text", async () => {
    const { html } = await renderChange(
      lines("---", "title: Gone", "---", "", "# T"),
      lines("# T"),
    );
    expect(html).toMatch(
      /^<details class="change-removed"><summary>1 block removed<\/summary><div class="change-removed-body"><section class="frontmatter" aria-label="Front matter"><pre>title: Gone<\/pre><\/section>/,
    );
  });
});
