import { describe, expect, it } from "vitest";

import { buildContextGraph } from "../src/graph/build-context-graph.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";

function docs(entries: Record<string, string>): Map<string, ParsedDocument> {
  const map = new Map<string, ParsedDocument>();
  for (const [filePath, content] of Object.entries(entries)) {
    map.set(filePath, parseDocument({ path: filePath, content }));
  }
  return map;
}

describe("buildContextGraph · link vs anchor typing", () => {
  it("types a fragment-free link as link and a fragment link as anchor, carrying text/rawTarget", () => {
    const graph = buildContextGraph(
      docs({
        "a.md": "[see B](b.md) and [see B section](b.md#sec)\n",
        "b.md": "## Sec\n"
      })
    );

    expect(graph.edges).toEqual([
      { from: "a.md", to: "b.md", type: "anchor", line: 1, text: "see B section", rawTarget: "b.md#sec" },
      { from: "a.md", to: "b.md", type: "link", line: 1, text: "see B", rawTarget: "b.md" }
    ]);
  });
});

describe("buildContextGraph · self-refs are skipped", () => {
  it("skips a same-file fragment self-ref and an explicit same-file anchor link", () => {
    const graph = buildContextGraph(
      docs({ "a.md": "## Sec\n\n[self](#sec) and [explicit self](a.md#sec)\n" })
    );

    expect(graph.edges).toEqual([]);
  });
});

describe("buildContextGraph · image edges", () => {
  it("materializes an image edge only when the target is a corpus node; skips an on-disk-only asset", () => {
    const graph = buildContextGraph(
      docs({
        "a.md": "![diagram](diagram.md)\n![asset](diagram.png)\n",
        "diagram.md": "# Diagram\n"
      })
    );

    expect(graph.edges).toEqual([
      { from: "a.md", to: "diagram.md", type: "image", line: 1, rawTarget: "diagram.md" }
    ]);
  });
});

describe("buildContextGraph · import edges", () => {
  it("materializes an @import edge with rawTarget/line and skips an @-self-import", () => {
    const graph = buildContextGraph(
      docs({
        "a.md": "See @glossary.md for terms.\n\n@a.md\n",
        "glossary.md": "# Glossary\n"
      })
    );

    expect(graph.edges).toEqual([
      { from: "a.md", to: "glossary.md", type: "import", line: 1, rawTarget: "@glossary.md" }
    ]);
  });
});

describe("buildContextGraph · multiplicity", () => {
  it("keeps two identical links as two separate edges (no (from,to) dedup)", () => {
    const graph = buildContextGraph(
      docs({ "a.md": "[one](b.md)\n[two](b.md)\n", "b.md": "# B\n" })
    );

    expect(graph.edges).toEqual([
      { from: "a.md", to: "b.md", type: "link", line: 1, text: "one", rawTarget: "b.md" },
      { from: "a.md", to: "b.md", type: "link", line: 2, text: "two", rawTarget: "b.md" }
    ]);
  });
});

describe("buildContextGraph · degrees and ordering", () => {
  it("recomputes in/out degree from the full edge list and sorts nodes/edges deterministically", () => {
    const graph = buildContextGraph(
      docs({ "b.md": "[a](a.md)\n", "a.md": "[b](b.md)\n[b again](b.md)\n" })
    );

    expect(graph.nodes).toEqual([
      { path: "a.md", inDegree: 1, outDegree: 2 },
      { path: "b.md", inDegree: 2, outDegree: 1 }
    ]);
    expect(graph.edges.map((edge) => `${edge.from}->${edge.to}@${edge.line}`)).toEqual([
      "a.md->b.md@1",
      "a.md->b.md@2",
      "b.md->a.md@1"
    ]);
  });
});

describe("buildContextGraph · id-ref edges", () => {
  const idRef = { idPattern: "^REQ-\\d+$", definitions: ["reqs.md"], idColumn: "ID" };

  it("links a plain-text ID mention to its column-defined source", () => {
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md": "See REQ-001 for details.\n"
    });

    const graph = buildContextGraph(documents, { idRef });

    expect(graph.edges).toEqual([
      { from: "design.md", to: "reqs.md", type: "id-ref", line: 1, rawTarget: "REQ-001" }
    ]);
  });

  it("builds no id-ref edges when idRef is not configured", () => {
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md": "See REQ-001 for details.\n"
    });

    expect(buildContextGraph(documents).edges).toEqual([]);
  });

  it("skips a token that matches idPattern but has no column-defined source", () => {
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md": "See REQ-999 for details.\n"
    });

    expect(buildContextGraph(documents, { idRef }).edges).toEqual([]);
  });

  it("skips self-definition (an ID mentioned in prose within its own defining document)", () => {
    const documents = docs({ "reqs.md": "# REQ-001 tracking\n\n| ID |\n| --- |\n| REQ-001 |\n" });

    expect(buildContextGraph(documents, { idRef }).edges).toEqual([]);
  });
});

describe("buildContextGraph · siteRouter resolution", () => {
  it("resolves a root-relative link through the site router (starlight), matching REF-002", () => {
    const documents = docs({
      "src/content/docs/guide.md": "[intro](/intro)\n",
      "src/content/docs/intro.md": "# Intro\n"
    });

    const graph = buildContextGraph(documents, { siteRouter: { preset: "starlight" } });

    expect(graph.edges).toEqual([
      {
        from: "src/content/docs/guide.md",
        to: "src/content/docs/intro.md",
        type: "link",
        line: 1,
        text: "intro",
        rawTarget: "/intro"
      }
    ]);
  });
});
