import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildContextGraph } from "../src/graph/build-context-graph.js";
import { computeGraphCoverage } from "../src/graph/coverage.js";
import type { ContextGraph } from "../src/graph/context-graph-types.js";
import {
  renderContextGraphDot,
  renderContextGraphMermaid,
  renderContextGraphText,
  renderContextSliceSummary,
  renderImpactSummary,
  summarizeContextGraph,
} from "../src/graph/graph-render.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";
import {
  LARGE_CORPUS_ENTRY_POINT_COUNT,
  LARGE_CORPUS_EXCLUDED_COUNT,
  LARGE_CORPUS_LARGEST_CLUSTER_SIZE,
  LARGE_CORPUS_LINE_WIDTH_BOUND,
} from "./support/large-corpus.js";
import { largeCorpusGraph } from "./support/large-corpus-graph.js";
import { readHumanSections } from "./support/output-parity.js";

// Mirrors graph-algorithms.test.ts: build real graphs from small inline Markdown maps so these
// tests stay coupled to the actual edge shape rather than hand-authored ContextGraph literals.
function graphOf(entries: Record<string, string>): ContextGraph {
  const map = new Map<string, ParsedDocument>();
  for (const [filePath, content] of Object.entries(entries)) {
    map.set(filePath, parseDocument({ path: filePath, content }));
  }
  return buildContextGraph(map);
}

describe("summarizeContextGraph", () => {
  it("returns the AC JSON shape with sorted nodes/edges plus components/readingOrder", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n[c](c.md)\n",
      "b.md": "# B\n",
      "c.md": "# C\n",
    });

    const summary = summarizeContextGraph(graph);

    expect(summary.nodes.map((node) => node.path)).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
    expect(summary.edges).toEqual([
      expect.objectContaining({ from: "a.md", to: "b.md" }),
      expect.objectContaining({ from: "a.md", to: "c.md" }),
    ]);
    expect(summary.components).toEqual([["a.md", "b.md", "c.md"]]);
    expect(summary.readingOrder).toEqual(["a.md", "b.md", "c.md"]);
    // Present even when nothing is excluded (W-23): the human report omits an empty section, but a
    // machine consumer must not have to distinguish "no cycles" from "an older shape".
    expect(summary.excluded).toEqual([]);
  });

  it("emits the shipped key set in order, which both hosts inherit", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });
    const coverage = computeGraphCoverage(
      new Map([["a.md", parseDocument({ path: "a.md", content: "# A\n" })]]),
      graph,
      { rootDir: "/repo" },
    );

    // The one pin for the graph JSON document: CLI `graph --format json` and the MCP `context-graph`
    // tool's `summary` branch both serialize this object, so a key added or renamed on one host
    // cannot silently diverge from the other or from the five documented surfaces (W-22/W-23).
    expect(Object.keys(summarizeContextGraph(graph, coverage))).toEqual([
      "nodes",
      "edges",
      "components",
      "readingOrder",
      "excluded",
      "coverage",
    ]);
  });

  it("lists the nodes a cycle kept out of the reading order", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "[a](a.md)\n" });

    const summary = summarizeContextGraph(graph);

    expect(summary.readingOrder).toEqual([]);
    expect(summary.excluded).toEqual(["a.md", "b.md"]);
  });

  it("sorts edges by (from, to, type, line) regardless of construction order", () => {
    const graph = graphOf({
      "b.md": "[a](a.md)\n",
      "a.md": "[one](b.md)\n[two](b.md)\n",
    });

    const summary = summarizeContextGraph(graph);

    expect(
      summary.edges.map((edge) => `${edge.from}->${edge.to}@${edge.line}`),
    ).toEqual(["a.md->b.md@1", "a.md->b.md@2", "b.md->a.md@1"]);
  });

  it("includes the G5 coverage signal when one is supplied, and omits it otherwise (audit B)", () => {
    const graph = graphOf({ "a.md": "# A\n" });
    // No links/images/imports, so coverage never touches disk — rootDir is required but unused here.
    const coverage = computeGraphCoverage(
      new Map([["a.md", parseDocument({ path: "a.md", content: "# A\n" })]]),
      graph,
      { rootDir: "/repo" },
    );

    expect(summarizeContextGraph(graph, coverage).coverage).toEqual({
      nodeCount: 1,
      edgeCount: 0,
      filesOutsideCorpus: [],
    });
    // Bare-graph callers (e.g. an MCP field with no disk access) still get the old shape.
    expect(summarizeContextGraph(graph)).not.toHaveProperty("coverage");
  });
});

describe("renderContextGraphText", () => {
  it("renders clusters, hubs, and reading order one item per indented line", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "# B\n",
      "x.md": "[y](y.md)\n",
      "y.md": "# Y\n",
    });

    const lines = renderContextGraphText(graph).split("\n");

    expect(lines).toContain("top hubs:");
    // W-26: clusters nest one level so component boundaries survive; members are their own lines
    // instead of a comma-joined blob (3904 characters for one cluster on the 139-node corpus).
    expect(lines).toContain("clusters:");
    expect(lines).toContain("  cluster 1 (2 files):");
    expect(lines).toContain("    a.md");
    expect(lines).toContain("    b.md");
    expect(lines).toContain("  cluster 2 (2 files):");
    expect(lines).toContain("    x.md");
    expect(lines).toContain("    y.md");
    expect(lines).toContain("reading order (4):");
    expect(lines).toContain("  a.md");
    expect(lines).toContain("  y.md");
  });

  it("reports what a cycle excludes from reading order", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "[a](a.md)\n" });

    const lines = renderContextGraphText(graph).split("\n");

    expect(lines).toContain("reading order (0):");
    expect(lines).toContain("excluded from reading order (2):");
    expect(lines).toContain("  a.md");
    expect(lines).toContain("  b.md");
  });

  it("appends the coverage signal when a GraphCoverage is supplied", () => {
    const graph = graphOf({ "a.md": "# A\n" });
    // No links/images/imports on "a.md", so computeGraphCoverage never resolves a candidate against
    // disk — rootDir is a required option but unused on this path, so a placeholder is safe here.
    const coverage = computeGraphCoverage(
      new Map([["a.md", parseDocument({ path: "a.md", content: "# A\n" })]]),
      graph,
      {
        rootDir: "/repo",
      },
    );

    const lines = renderContextGraphText(graph, coverage).split("\n");

    expect(lines).toContain("coverage:");
    expect(lines).toContain("  nodes: 1");
    expect(lines).toContain("  edges: 0");
    // Line-oriented like every other path list, and with no trailing space when empty.
    expect(lines).toContain("  files outside corpus (0):");
  });

  it("omits the coverage section when no coverage is supplied", () => {
    const graph = graphOf({ "a.md": "# A\n" });

    expect(renderContextGraphText(graph)).not.toContain("coverage:");
  });
});

describe("renderContextGraphMermaid / renderContextGraphDot", () => {
  it("assigns unique sorted-path-index node ids and renders paths as labels", () => {
    const graph = graphOf({ "b.md": "[a](a.md)\n", "a.md": "# A\n" });

    const mermaid = renderContextGraphMermaid(graph);
    const dot = renderContextGraphDot(graph);

    expect(mermaid).toBe(
      [
        "flowchart TD",
        '  n0["a.md"]',
        '  n1["b.md"]',
        "  n1 -->|link| n0",
      ].join("\n"),
    );
    expect(dot).toBe(
      [
        "digraph ContextGraph {",
        '  n0 [label="a.md"];',
        '  n1 [label="b.md"];',
        '  n1 -> n0 [label="link"];',
        "}",
      ].join("\n"),
    );
  });

  it("is byte-stable across repeated calls (determinism)", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "# C\n",
    });

    expect(renderContextGraphMermaid(graph)).toBe(
      renderContextGraphMermaid(graph),
    );
    expect(renderContextGraphDot(graph)).toBe(renderContextGraphDot(graph));
  });

  it("escapes double quotes in a path label", () => {
    const graph = graphOf({ 'weird "name".md': "# Weird\n" });

    expect(renderContextGraphMermaid(graph)).toContain(
      'n0["weird &quot;name&quot;.md"]',
    );
    expect(renderContextGraphDot(graph)).toContain(
      'n0 [label="weird \\"name\\".md"];',
    );
  });
});

describe("the renderers at corpus scale", () => {
  // Module-level so the 139-document graph is built once for the whole suite, not per test.
  const graph = largeCorpusGraph();

  it("keeps every human-format line under the stated width", () => {
    const lines = renderContextGraphText(graph).split("\n");
    const longest = lines.reduce(
      (widest, line) => (line.length > widest.length ? line : widest),
      "",
    );

    // Before P15.01 the widest line here was a 3904-character comma-joined cluster.
    expect(longest.length).toBeLessThanOrEqual(LARGE_CORPUS_LINE_WIDTH_BOUND);
    // …and the report is genuinely line-oriented rather than short because it is truncated.
    expect(lines.length).toBeGreaterThan(300);
  });

  it("renders the large cluster nested, with the count in its header", () => {
    const lines = renderContextGraphText(graph).split("\n");
    const header = `  cluster 1 (${LARGE_CORPUS_LARGEST_CLUSTER_SIZE} files):`;
    const headerIndex = lines.indexOf(header);

    expect(headerIndex).toBeGreaterThan(-1);
    // The member count in the header must match the members actually emitted under it, or the
    // header becomes a claim the section contradicts.
    const members = lines
      .slice(headerIndex + 1)
      .findIndex((line) => !line.startsWith("    "));
    expect(members).toBe(LARGE_CORPUS_LARGEST_CLUSTER_SIZE);
  });

  // W-23's parity assertion at the renderer level: one graph, both formats, the same sets. The human
  // sections are the source the JSON keys had to match, so they are parsed back out of the text rather
  // than recomputed — a shared `topologicalSort` call would assert nothing about what either format
  // ships.
  //
  // P16.01 widened this from the `excluded` set alone to all three of the top-level path sections,
  // through the shared `readHumanSections` reader: `excluded` was missing from the JSON for three
  // phases and its two siblings were never compared at all, so checking one of three is how the next
  // omission stays invisible. The reader also asserts each header's `(N)` against the items under it,
  // which is a second claim the format makes about itself.
  //
  // Three is the whole overlap *as invoked here*: neither call is given a `GraphCoverage`, so no
  // coverage block is rendered and no `coverage` key is serialized. The fourth section that block
  // nests, `files outside corpus`, is diffed at the command boundary in `cli/test/graph.e2e.test.ts`,
  // where the CLI always supplies coverage and the fixture has a file outside the corpus to report.
  it("carries the same top-level path sections in the human and JSON formats", () => {
    const sections = readHumanSections(renderContextGraphText(graph));
    const summary = summarizeContextGraph(graph);

    expect({
      entryPoints: sections["entry points"],
      readingOrder: sections["reading order"],
      excluded: sections["excluded from reading order"],
    }).toEqual({
      entryPoints: summary.nodes
        .filter((node) => node.inDegree === 0)
        .map((node) => node.path),
      readingOrder: summary.readingOrder,
      excluded: summary.excluded,
    });
    // Non-vacuous: all three are populated at this corpus size, so a reader that silently returned
    // nothing would not pass by matching an empty payload.
    expect(sections["excluded from reading order"]).toHaveLength(
      LARGE_CORPUS_EXCLUDED_COUNT,
    );
    expect(sections["entry points"]).toHaveLength(
      LARGE_CORPUS_ENTRY_POINT_COUNT,
    );
    expect(sections["reading order"]!.length).toBeGreaterThan(0);
  });

  const digest = (text: string): string =>
    createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);

  // The machine formats must be byte-identical across runs *and* unchanged by this task. A recorded
  // digest pins the second half of that (a 216 KB golden file is not worth checking in); the
  // equality below pins the first. The `json` digest moved once, deliberately, at P15.02: the
  // summary gained the `excluded` key (W-23). `mermaid`/`dot` are untouched by that change and their
  // digests must not move.
  it.each([
    [
      "json",
      () => JSON.stringify(summarizeContextGraph(graph)),
      "4c9a275b3a0e8668",
    ],
    ["mermaid", () => renderContextGraphMermaid(graph), "381fd263c4b5f838"],
    ["dot", () => renderContextGraphDot(graph), "501c8e77e92c1658"],
  ] as const)(
    "leaves %s byte-identical across two runs",
    (_name, render, sha) => {
      expect(render()).toBe(render());
      expect(digest(render())).toBe(sha);
    },
  );
});

describe("renderContextSliceSummary", () => {
  it("reports the honest empty result for an unresolved query", () => {
    const summary = renderContextSliceSummary({
      query: "nope",
      matchKind: null,
      starts: [],
      files: [],
      visited: [],
    });

    expect(summary).toBe('No match for query "nope".');
  });

  it("lists the matched start(s) and resolved files", () => {
    const summary = renderContextSliceSummary({
      query: "a.md",
      matchKind: "path",
      starts: ["a.md"],
      files: ["a.md", "b.md"],
      visited: [
        { path: "a.md", depth: 0, via: null },
        { path: "b.md", depth: 1, via: "a.md" },
      ],
    });

    expect(summary).toBe(
      [
        "query: a.md",
        "matched: path",
        "starts (1):",
        "  a.md",
        "files (2):",
        "  a.md",
        "  b.md",
      ].join("\n"),
    );
  });

  it("keeps a multi-start anchor query line-oriented (W-26)", () => {
    // An `#anchor`/heading/ID query resolves to every file carrying that slug, so `starts` grows
    // with the corpus exactly as the sections W-26 fixed did.
    const summary = renderContextSliceSummary({
      query: "#install",
      matchKind: "anchor",
      starts: ["a.md", "b.md", "c.md"],
      files: ["a.md", "b.md", "c.md"],
      visited: [
        { path: "a.md", depth: 0, via: null },
        { path: "b.md", depth: 0, via: null },
        { path: "c.md", depth: 0, via: null },
      ],
    });

    expect(summary.split("\n").slice(0, 5)).toEqual([
      "query: #install",
      "matched: anchor",
      "starts (3):",
      "  a.md",
      "  b.md",
    ]);
  });
});

describe("renderImpactSummary", () => {
  it("renders directly/transitively affected files, reading order, and excluded", () => {
    const summary = renderImpactSummary({
      file: "a.md",
      directlyAffected: [{ path: "b.md", references: 2 }],
      transitivelyAffected: [{ path: "c.md", depth: 2, via: "b.md" }],
      readingOrder: ["c.md", "b.md"],
      excluded: ["d.md"],
    });

    expect(summary).toBe(
      [
        "changed file: a.md",
        "directly affected (1):",
        "  b.md (2 references)",
        "transitively affected (1):",
        "  c.md (depth 2, via b.md)",
        // Same W-26 fix as the graph report: `impact`'s affected subgraph is the whole corpus when
        // the changed file is a hub, so leaving these two comma-joined would have recreated the
        // inconsistency three lines above them.
        "reading order (2):",
        "  c.md",
        "  b.md",
        "excluded from reading order (1):",
        "  d.md",
      ].join("\n"),
    );
  });

  it("omits the excluded line when nothing was excluded", () => {
    const summary = renderImpactSummary({
      file: "a.md",
      directlyAffected: [],
      transitivelyAffected: [],
      readingOrder: [],
      excluded: [],
    });

    expect(summary).not.toContain("excluded from reading order");
  });
});
