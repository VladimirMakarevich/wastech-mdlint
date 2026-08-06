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
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

async function createFixtureTree(
  files: Record<string, string>,
): Promise<string> {
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
        "b.md": "## Sec\n",
      }),
    );

    expect(graph.edges).toEqual([
      {
        from: "a.md",
        to: "b.md",
        type: "anchor",
        line: 1,
        text: "see B section",
        rawTarget: "b.md#sec",
      },
      {
        from: "a.md",
        to: "b.md",
        type: "link",
        line: 1,
        text: "see B",
        rawTarget: "b.md",
      },
    ]);
  });
});

describe("buildContextGraph · anchor edges validate against the target's heading slugs", () => {
  it("skips a cross-file fragment link when the target has no matching heading (no downgrade to link)", () => {
    const graph = buildContextGraph(
      docs({
        "a.md": "[see B](b.md#missing)\n",
        "b.md": "## Sec\n",
      }),
    );

    expect(graph.edges).toEqual([]);
  });
});

describe("buildContextGraph · self-refs are skipped", () => {
  it("skips a same-file fragment self-ref and an explicit same-file anchor link", () => {
    const graph = buildContextGraph(
      docs({
        "a.md": "## Sec\n\n[self](#sec) and [explicit self](a.md#sec)\n",
      }),
    );

    expect(graph.edges).toEqual([]);
  });
});

describe("buildContextGraph · image edges", () => {
  it("materializes an image edge only when the target is a corpus node; skips an on-disk-only asset", () => {
    const graph = buildContextGraph(
      docs({
        "a.md": "![diagram](diagram.md)\n![asset](diagram.png)\n",
        "diagram.md": "# Diagram\n",
      }),
    );

    expect(graph.edges).toEqual([
      {
        from: "a.md",
        to: "diagram.md",
        type: "image",
        line: 1,
        rawTarget: "diagram.md",
      },
    ]);
  });
});

describe("buildContextGraph · import edges", () => {
  it("materializes an @import edge with rawTarget/line and skips an @-self-import", () => {
    const graph = buildContextGraph(
      docs({
        "a.md": "See @glossary.md for terms.\n\n@a.md\n",
        "glossary.md": "# Glossary\n",
      }),
    );

    expect(graph.edges).toEqual([
      {
        from: "a.md",
        to: "glossary.md",
        type: "import",
        line: 1,
        rawTarget: "@glossary.md",
      },
    ]);
  });
});

describe("buildContextGraph · multiplicity", () => {
  it("keeps two identical links as two separate edges (no (from,to) dedup)", () => {
    const graph = buildContextGraph(
      docs({ "a.md": "[one](b.md)\n[two](b.md)\n", "b.md": "# B\n" }),
    );

    expect(graph.edges).toEqual([
      {
        from: "a.md",
        to: "b.md",
        type: "link",
        line: 1,
        text: "one",
        rawTarget: "b.md",
      },
      {
        from: "a.md",
        to: "b.md",
        type: "link",
        line: 2,
        text: "two",
        rawTarget: "b.md",
      },
    ]);
  });
});

describe("buildContextGraph · degrees and ordering", () => {
  it("recomputes in/out degree from the full edge list and sorts nodes/edges deterministically", () => {
    const graph = buildContextGraph(
      docs({ "b.md": "[a](a.md)\n", "a.md": "[b](b.md)\n[b again](b.md)\n" }),
    );

    expect(graph.nodes).toEqual([
      { path: "a.md", inDegree: 1, outDegree: 2 },
      { path: "b.md", inDegree: 2, outDegree: 1 },
    ]);
    expect(
      graph.edges.map((edge) => `${edge.from}->${edge.to}@${edge.line}`),
    ).toEqual(["a.md->b.md@1", "a.md->b.md@2", "b.md->a.md@1"]);
  });
});

describe("buildContextGraph · id-ref edges", () => {
  const idRef = {
    idPattern: "^REQ-\\d+$",
    definitions: ["reqs.md"],
    idColumn: "ID",
  };

  it("links a plain-text ID mention to its column-defined source", () => {
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md": "See REQ-001 for details.\n",
    });

    const graph = buildContextGraph(documents, { idRef });

    expect(graph.edges).toEqual([
      {
        from: "design.md",
        to: "reqs.md",
        type: "id-ref",
        line: 1,
        rawTarget: "REQ-001",
      },
    ]);
  });

  it("anchors repeated mentions of one ID to their own lines", () => {
    // Every other id-ref assertion here lands on line 1, so this is the case that pins the
    // per-document line index against the old per-match scan.
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md": [
        "REQ-001 first.",
        "",
        "REQ-001 again.",
        "",
        "",
        "",
        "REQ-001 last.",
      ].join("\n"),
    });

    expect(
      buildContextGraph(documents, { idRef }).edges.map((edge) => edge.line),
    ).toEqual([1, 3, 7]);
  });

  it("builds no id-ref edges when idRef is not configured", () => {
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md": "See REQ-001 for details.\n",
    });

    expect(buildContextGraph(documents).edges).toEqual([]);
  });

  it("skips a token that matches idPattern but has no column-defined source", () => {
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md": "See REQ-999 for details.\n",
    });

    expect(buildContextGraph(documents, { idRef }).edges).toEqual([]);
  });

  it("skips self-definition (an ID mentioned in prose within its own defining document)", () => {
    const documents = docs({
      "reqs.md": "# REQ-001 tracking\n\n| ID |\n| --- |\n| REQ-001 |\n",
    });

    expect(buildContextGraph(documents, { idRef }).edges).toEqual([]);
  });

  it("links a plain-text ID mention to a heading-defined source (no table column involved)", () => {
    const documents = docs({
      "reqs.md": "# REQ-001 tracking\n",
      "design.md": "See REQ-001 for details.\n",
    });

    const graph = buildContextGraph(documents, { idRef });

    expect(graph.edges).toEqual([
      {
        from: "design.md",
        to: "reqs.md",
        type: "id-ref",
        line: 1,
        rawTarget: "REQ-001",
      },
    ]);
  });

  it("trims adjacent sentence punctuation from a prose ID mention (finding H)", () => {
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md": "Blocks REQ-001. See (REQ-001) here.\n",
    });

    const graph = buildContextGraph(documents, { idRef });

    // "REQ-001." (trailing period) and "(REQ-001)" (wrapping parens) both trim to REQ-001, so each
    // still yields an edge (multiplicity retained). The old whitespace/comma-only tokenizer missed
    // both because the punctuation stayed glued to the token and failed the anchored idPattern.
    expect(graph.edges).toEqual([
      {
        from: "design.md",
        to: "reqs.md",
        type: "id-ref",
        line: 1,
        rawTarget: "REQ-001",
      },
      {
        from: "design.md",
        to: "reqs.md",
        type: "id-ref",
        line: 1,
        rawTarget: "REQ-001",
      },
    ]);
  });

  it("still builds an id-ref edge for an ID that appears only inside a fenced code block (known limitation, finding A)", () => {
    const documents = docs({
      "reqs.md": "| ID |\n| --- |\n| REQ-001 |\n",
      "design.md":
        "# Design\n\n```\n[ERROR] validation failed for REQ-001\n```\n",
    });

    const graph = buildContextGraph(documents, { idRef });

    // Documented v2 limitation: the id-ref scan runs over raw `content`, so a code-block mention is
    // not distinguished from prose and still produces an edge (line 4 = the fenced content line).
    // Pinned so this false positive stays intentional rather than regressing in silently either
    // direction if the scan ever changes.
    expect(graph.edges).toEqual([
      {
        from: "design.md",
        to: "reqs.md",
        type: "id-ref",
        line: 4,
        rawTarget: "REQ-001",
      },
    ]);
  });
});

describe("buildContextGraph · siteRouter resolution", () => {
  it("resolves a root-relative link through the site router (starlight), matching REF-002", () => {
    const documents = docs({
      "src/content/docs/guide.md": "[intro](/intro)\n",
      "src/content/docs/intro.md": "# Intro\n",
    });

    const graph = buildContextGraph(documents, {
      siteRouter: { preset: "starlight" },
    });

    expect(graph.edges).toEqual([
      {
        from: "src/content/docs/guide.md",
        to: "src/content/docs/intro.md",
        type: "link",
        line: 1,
        text: "intro",
        rawTarget: "/intro",
      },
    ]);
  });

  // W-10 (P13.05): the builder's invariant is that its resolution mirrors the REF rules, and
  // REF-003 resolves a root-relative image target against the repository root — a router maps a URL
  // to Markdown source, never to an asset. So the same root-relative target yields a link edge and
  // no image edge.
  it("routes links but not images (REF-003's model)", () => {
    const documents = docs({
      "src/content/docs/guide.md": "[intro](/intro)\n\n![diagram](/intro)\n",
      "src/content/docs/intro.md": "# Intro\n",
    });

    const graph = buildContextGraph(documents, {
      siteRouter: { preset: "starlight" },
    });

    expect(graph.edges.map((edge) => edge.type)).toEqual(["link"]);
  });
});

describe("buildContextGraph · node identity matches loadDocuments() output directly", () => {
  it("derives nodes from document.path (not the input Map's keys) so every edge endpoint is a real node", async () => {
    const root = await createFixtureTree({
      "a.md": "[see B](b.md)\n",
      "b.md": "# B\n",
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
    expect(graph.edges).toEqual([
      {
        from: "a.md",
        to: "b.md",
        type: "link",
        line: 1,
        text: "see B",
        rawTarget: "b.md",
      },
    ]);
  });
});

// P12.05 (finding SC-3): `detectCycles`/`cyclePath` recurse once per node along the current DFS path,
// so the supported depth — the longest simple path inside one connected component — is bounded by the
// JS call stack rather than by anything in the code. A linear chain is the simplest shape that reaches
// full depth, so these two tests use it to pin the documented bound empirically: DEPTH is the depth we
// promise works, chosen with a ~4x margin under the measured overflow point (~4,750 in a cold Node
// main thread) so the assertion stays stable across platforms and JIT warmup states instead of sitting
// near the cliff. Deliberately *no* test asserts a crash at some larger depth — the exact limit is
// stack-size dependent and would be flaky. Raising DEPTH means re-measuring the limit first.
const DEPTH = 1000;

// `dNNN….md` zero-padded to a width derived from DEPTH so lexicographic order equals chain order at
// any depth (a fixed width would silently break that the moment DEPTH crossed its next power of ten).
// Order equality makes both the node sort and `cyclePath`'s canonical rotation (smallest node first)
// exactly predictable, which is what lets the cyclic case assert the full path shape rather than just
// its length.
const CHAIN_NAME_WIDTH = String(DEPTH - 1).length;

function chainName(index: number): string {
  return `d${String(index).padStart(CHAIN_NAME_WIDTH, "0")}.md`;
}

// A linear chain `d0000 -> d0001 -> ... -> d(DEPTH-1)`; `cyclic` adds the back edge that closes it.
function deepChain(cyclic: boolean): Map<string, ParsedDocument> {
  const entries: Record<string, string> = {};
  for (let index = 0; index < DEPTH; index += 1) {
    const next = index + 1 < DEPTH ? index + 1 : cyclic ? 0 : undefined;
    entries[chainName(index)] =
      next === undefined ? "# End\n" : `[next](${chainName(next)})\n`;
  }
  return docs(entries);
}

describe("buildContextGraph · deep reference chains (P12.05 documented depth bound)", () => {
  it(`builds a ${DEPTH}-deep acyclic chain without exhausting the stack`, () => {
    const graph = buildContextGraph(deepChain(false));

    expect(graph.nodes).toHaveLength(DEPTH);
    expect(graph.edges).toHaveLength(DEPTH - 1);
    expect(graph.cycles).toEqual([]);
    // Every node but the last one links onward, and every node but the first is linked to.
    expect(graph.nodes[0]).toEqual({
      path: chainName(0),
      inDegree: 0,
      outDegree: 1,
    });
    expect(graph.nodes.at(-1)).toEqual({
      path: chainName(DEPTH - 1),
      inDegree: 1,
      outDegree: 0,
    });
  });

  it(`reports one canonical cycle for a ${DEPTH}-deep chain closed by a back edge`, () => {
    const graph = buildContextGraph(deepChain(true));

    expect(graph.edges).toHaveLength(DEPTH);
    expect(graph.cycles).toHaveLength(1);

    // Closed path: the whole chain plus the start repeated at the end, rotated to the
    // lexicographically smallest node.
    const cycle = graph.cycles[0]!;
    expect(cycle).toHaveLength(DEPTH + 1);
    expect(cycle[0]).toBe(chainName(0));
    expect(cycle.at(-1)).toBe(chainName(0));
    expect(cycle.slice(0, DEPTH)).toEqual(
      Array.from({ length: DEPTH }, (_unused, index) => chainName(index)),
    );
  });
});
