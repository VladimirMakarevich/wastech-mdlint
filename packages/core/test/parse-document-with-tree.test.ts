import type { Heading } from "mdast";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";

import {
  parseDocument,
  parseDocumentWithTree,
} from "../src/markdown/parse-document.js";

const CONTENT = [
  "---",
  "title: Sample",
  "---",
  "",
  "# Title",
  "",
  "> ## Quoted heading",
  "",
  "- ### Heading in a list",
  "",
  "## Title",
  "",
  "Setext heading",
  "--------------",
  "",
].join("\n");

describe("parseDocumentWithTree", () => {
  // The two entry points are one parse: a renderer reading the tree and a rule reading the facts must
  // never be looking at two different readings of the same file.
  it("returns exactly the document parseDocument returns", () => {
    const params = { path: "docs/sample.md", content: CONTENT };
    expect(parseDocumentWithTree(params).document).toEqual(
      parseDocument(params),
    );
  });

  // The renderer pairs heading nodes with slugs by position. That only works if a pre-order walk of
  // the tree meets the headings in the order `headings` lists them - including headings nested in
  // block quotes and list items, and setext headings - so the pairing is checked node by node.
  it("yields heading nodes in the order and with the depths of document.headings", () => {
    const { document, tree } = parseDocumentWithTree({
      path: "docs/sample.md",
      content: CONTENT,
    });
    const nodes: Heading[] = [];
    visit(tree, "heading", (node: Heading) => {
      nodes.push(node);
    });
    expect(nodes.map((node) => node.depth)).toEqual(
      document.headings.map((h) => h.depth),
    );
    expect(nodes.map((node) => node.position?.start.line)).toEqual(
      document.headings.map((h) => h.line),
    );
    expect(document.headings.map((h) => h.slug)).toEqual([
      "title",
      "quoted-heading",
      "heading-in-a-list",
      "title-1",
      "setext-heading",
    ]);
  });
});
