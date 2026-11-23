import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { parseDocument } from "@wastech-mdlint/core";

import { Corpus } from "../src/corpus.js";
import { DocumentSearch } from "../src/search.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/basic", import.meta.url));

let corpus: Corpus;

beforeAll(async () => {
  corpus = await Corpus.load({ cwd: fixtureRoot });
}, 30_000);

describe("DocumentSearch", () => {
  it("lands on the heading that contains the word", () => {
    const [hit] = new DocumentSearch().search(corpus.documents, "setup");
    expect(hit?.path).toBe("docs/guide.md");
    expect(hit?.href).toBe("/doc/docs/guide.md#setup");
    expect(hit?.title).toBe("Guide");
  });

  it("finds Cyrillic text and keeps the matched word for highlighting", () => {
    const [hit] = new DocumentSearch().search(corpus.documents, "заголовок");
    expect(hit?.path).toBe("docs/guide.md");
    expect(hit?.terms).toContain("заголовок");
  });

  it("matches a word by its beginning while it is still being typed", () => {
    const hits = new DocumentSearch().search(corpus.documents, "fixt");
    expect(hits.map((hit) => hit.path)).toContain("README.md");
  });

  it("builds a snippet from prose, without Markdown link syntax", () => {
    const [hit] = new DocumentSearch().search(
      corpus.documents,
      "external site",
    );
    expect(hit?.path).toBe("README.md");
    expect(hit?.snippet).toContain("an external site");
    expect(hit?.snippet).not.toContain("https://example.com");
  });

  // Front matter is shown as a card, not as text; a word only it contains must not make the page
  // a hit that then shows no such word.
  it("does not search front matter", () => {
    expect(new DocumentSearch().search(corpus.documents, "alpha")).toEqual([]);
  });

  // The title is the hit's headline already; repeating it as the snippet, or linking to the top of
  // the page, tells the reader nothing.
  it("takes the snippet and the landing place from below the title", () => {
    const documents = new Map([
      [
        "a.md",
        parseDocument({
          path: "a.md",
          content:
            "# Save guard\n\nIntro text.\n\n## Details\n\nThe save guard stops a lost edit.\n",
        }),
      ],
    ]);
    const [hit] = new DocumentSearch().search(documents, "guard");
    expect(hit?.href).toBe("/doc/a.md#details");
    expect(hit?.snippet).toBe(
      "Intro text. Details The save guard stops a lost edit.",
    );
  });

  it("returns nothing for a blank query", () => {
    expect(new DocumentSearch().search(corpus.documents, "   ")).toEqual([]);
  });

  // The index follows the corpus by document identity: a replaced document is re-indexed and a
  // removed one stops matching, without rebuilding everything.
  it("follows edits and removals in the corpus it is given", () => {
    const search = new DocumentSearch();
    const documents = new Map(corpus.documents);
    expect(search.search(documents, "quokka")).toEqual([]);

    documents.set(
      "docs/guide.md",
      parseDocument({
        path: "docs/guide.md",
        content: "# Guide\n\nA quokka.\n",
      }),
    );
    expect(search.search(documents, "quokka").map((hit) => hit.path)).toEqual([
      "docs/guide.md",
    ]);
    expect(
      search.search(documents, "setup").map((hit) => hit.path),
    ).not.toContain("docs/guide.md");

    documents.delete("docs/guide.md");
    expect(search.search(documents, "quokka")).toEqual([]);
  });
});
