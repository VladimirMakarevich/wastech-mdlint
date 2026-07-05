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
  summarizeContextGraph
} from "../src/graph/graph-render.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";

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
    const graph = graphOf({ "a.md": "[b](b.md)\n[c](c.md)\n", "b.md": "# B\n", "c.md": "# C\n" });

    const summary = summarizeContextGraph(graph);

    expect(summary.nodes.map((node) => node.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(summary.edges).toEqual([
      expect.objectContaining({ from: "a.md", to: "b.md" }),
      expect.objectContaining({ from: "a.md", to: "c.md" })
    ]);
    expect(summary.components).toEqual([["a.md", "b.md", "c.md"]]);
    expect(summary.readingOrder).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("sorts edges by (from, to, type, line) regardless of construction order", () => {
    const graph = graphOf({ "b.md": "[a](a.md)\n", "a.md": "[one](b.md)\n[two](b.md)\n" });

    const summary = summarizeContextGraph(graph);

    expect(summary.edges.map((edge) => `${edge.from}->${edge.to}@${edge.line}`)).toEqual([
      "a.md->b.md@1",
      "a.md->b.md@2",
      "b.md->a.md@1"
    ]);
  });

  it("includes the G5 coverage signal when one is supplied, and omits it otherwise (audit B)", () => {
    const graph = graphOf({ "a.md": "# A\n" });
    // No links/images/imports, so coverage never touches disk — rootDir is required but unused here.
    const coverage = computeGraphCoverage(
      new Map([["a.md", parseDocument({ path: "a.md", content: "# A\n" })]]),
      graph,
      { rootDir: "/repo" }
    );

    expect(summarizeContextGraph(graph, coverage).coverage).toEqual({
      nodeCount: 1,
      edgeCount: 0,
      filesOutsideCorpus: []
    });
    // Bare-graph callers (e.g. an MCP field with no disk access) still get the old shape.
    expect(summarizeContextGraph(graph)).not.toHaveProperty("coverage");
  });
});

describe("renderContextGraphText", () => {
  it("includes clusters, hubs, and reading order", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "# B\n",
      "x.md": "[y](y.md)\n",
      "y.md": "# Y\n"
    });

    const text = renderContextGraphText(graph);

    expect(text).toContain("top hubs:");
    expect(text).toContain("clusters:");
    expect(text).toContain("a.md, b.md");
    expect(text).toContain("x.md, y.md");
    expect(text).toContain("reading order (4): a.md, b.md, x.md, y.md");
  });

  it("reports what a cycle excludes from reading order", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "[a](a.md)\n" });

    const text = renderContextGraphText(graph);

    expect(text).toContain("reading order (0): ");
    expect(text).toContain("excluded from reading order (2): a.md, b.md");
  });

  it("appends the coverage signal when a GraphCoverage is supplied", () => {
    const graph = graphOf({ "a.md": "# A\n" });
    // No links/images/imports on "a.md", so computeGraphCoverage never resolves a candidate against
    // disk — rootDir is a required option but unused on this path, so a placeholder is safe here.
    const coverage = computeGraphCoverage(new Map([["a.md", parseDocument({ path: "a.md", content: "# A\n" })]]), graph, {
      rootDir: "/repo"
    });

    const text = renderContextGraphText(graph, coverage);

    expect(text).toContain("coverage:");
    expect(text).toContain("nodes: 1");
    expect(text).toContain("edges: 0");
    expect(text).toContain("files outside corpus (0): ");
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

    expect(mermaid).toBe(['flowchart TD', '  n0["a.md"]', '  n1["b.md"]', "  n1 -->|link| n0"].join("\n"));
    expect(dot).toBe(
      [
        "digraph ContextGraph {",
        '  n0 [label="a.md"];',
        '  n1 [label="b.md"];',
        '  n1 -> n0 [label="link"];',
        "}"
      ].join("\n")
    );
  });

  it("is byte-stable across repeated calls (determinism)", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "[c](c.md)\n", "c.md": "# C\n" });

    expect(renderContextGraphMermaid(graph)).toBe(renderContextGraphMermaid(graph));
    expect(renderContextGraphDot(graph)).toBe(renderContextGraphDot(graph));
  });

  it("escapes double quotes in a path label", () => {
    const graph = graphOf({ 'weird "name".md': "# Weird\n" });

    expect(renderContextGraphMermaid(graph)).toContain('n0["weird &quot;name&quot;.md"]');
    expect(renderContextGraphDot(graph)).toContain('n0 [label="weird \\"name\\".md"];');
  });
});

describe("renderContextSliceSummary", () => {
  it("reports the honest empty result for an unresolved query", () => {
    const summary = renderContextSliceSummary({ query: "nope", matchKind: null, starts: [], files: [], visited: [] });

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
        { path: "b.md", depth: 1, via: "a.md" }
      ]
    });

    expect(summary).toBe(["query: a.md", "matched: path (a.md)", "files (2):", "  a.md", "  b.md"].join("\n"));
  });
});

describe("renderImpactSummary", () => {
  it("renders directly/transitively affected files, reading order, and excluded", () => {
    const summary = renderImpactSummary({
      file: "a.md",
      directlyAffected: [{ path: "b.md", references: 2 }],
      transitivelyAffected: [{ path: "c.md", depth: 2, via: "b.md" }],
      readingOrder: ["c.md", "b.md"],
      excluded: ["d.md"]
    });

    expect(summary).toBe(
      [
        "changed file: a.md",
        "directly affected (1):",
        "  b.md (2 references)",
        "transitively affected (1):",
        "  c.md (depth 2, via b.md)",
        "reading order (2): c.md, b.md",
        "excluded from reading order (1): d.md"
      ].join("\n")
    );
  });

  it("omits the excluded line when nothing was excluded", () => {
    const summary = renderImpactSummary({
      file: "a.md",
      directlyAffected: [],
      transitivelyAffected: [],
      readingOrder: [],
      excluded: []
    });

    expect(summary).not.toContain("excluded from reading order");
  });
});
