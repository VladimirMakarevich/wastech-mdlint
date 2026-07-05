import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildContextGraph } from "../src/graph/build-context-graph.js";
import { loadDocuments } from "../src/markdown/load-documents.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";

function docs(entries: Record<string, string>): Map<string, ParsedDocument> {
  const map = new Map<string, ParsedDocument>();
  for (const [filePath, content] of Object.entries(entries)) {
    map.set(filePath, parseDocument({ path: filePath, content }));
  }
  return map;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true })));
});

async function createFixtureTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-graph-"));
  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return root;
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

describe("buildContextGraph · anchor edges validate against the target's heading slugs", () => {
  it("skips a cross-file fragment link when the target has no matching heading (no downgrade to link)", () => {
    const graph = buildContextGraph(
      docs({
        "a.md": "[see B](b.md#missing)\n",
        "b.md": "## Sec\n"
      })
    );

    expect(graph.edges).toEqual([]);
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

  it("links a plain-text ID mention to a heading-defined source (no table column involved)", () => {
    const documents = docs({
      "reqs.md": "# REQ-001 tracking\n",
      "design.md": "See REQ-001 for details.\n"
    });

    const graph = buildContextGraph(documents, { idRef });

    expect(graph.edges).toEqual([
      { from: "design.md", to: "reqs.md", type: "id-ref", line: 1, rawTarget: "REQ-001" }
    ]);
  });

  it("trims adjacent sentence punctuation from a prose ID mention (finding H)", () => {
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md": "Blocks REQ-001. See (REQ-001) here.\n"
    });

    const graph = buildContextGraph(documents, { idRef });

    // "REQ-001." (trailing period) and "(REQ-001)" (wrapping parens) both trim to REQ-001, so each
    // still yields an edge (multiplicity retained). The old whitespace/comma-only tokenizer missed
    // both because the punctuation stayed glued to the token and failed the anchored idPattern.
    expect(graph.edges).toEqual([
      { from: "design.md", to: "reqs.md", type: "id-ref", line: 1, rawTarget: "REQ-001" },
      { from: "design.md", to: "reqs.md", type: "id-ref", line: 1, rawTarget: "REQ-001" }
    ]);
  });

  it("still builds an id-ref edge for an ID that appears only inside a fenced code block (known limitation, finding A)", () => {
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md": "# Design\n\n```\n[ERROR] validation failed for REQ-001\n```\n"
    });

    const graph = buildContextGraph(documents, { idRef });

    // Documented v2 limitation: the id-ref scan runs over raw `content`, so a code-block mention is
    // not distinguished from prose and still produces an edge (line 4 = the fenced content line).
    // Pinned so this false positive stays intentional rather than regressing in silently either
    // direction if the scan ever changes.
    expect(graph.edges).toEqual([
      { from: "design.md", to: "reqs.md", type: "id-ref", line: 4, rawTarget: "REQ-001" }
    ]);
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

describe("buildContextGraph · node identity matches loadDocuments() output directly", () => {
  it("derives nodes from document.path (not the input Map's keys) so every edge endpoint is a real node", async () => {
    const root = await createFixtureTree({
      "a.md": "[see B](b.md)\n",
      "b.md": "# B\n"
    });

    // loadDocuments() keys its Map by absolute path (see load-documents.test.ts); feed it straight
    // into buildContextGraph without the repo-relative re-keying every current caller happens to do.
    const documents = await loadDocuments(["**/*.md"], { cwd: root });
    const graph = buildContextGraph(documents);

    const nodePaths = new Set(graph.nodes.map((node) => node.path));
    expect([...nodePaths].sort()).toEqual(["a.md", "b.md"]);
    for (const nodePath of nodePaths) {
      expect(nodePath.startsWith("/")).toBe(false);
      expect(nodePath.includes("\\")).toBe(false);
    }
    for (const edge of graph.edges) {
      expect(nodePaths.has(edge.from)).toBe(true);
      expect(nodePaths.has(edge.to)).toBe(true);
    }
    expect(graph.edges).toEqual([{ from: "a.md", to: "b.md", type: "link", line: 1, text: "see B", rawTarget: "b.md" }]);
  });
});
