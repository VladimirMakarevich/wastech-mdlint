import { describe, expect, it } from "vitest";

import { buildContextGraph } from "../src/graph/build-context-graph.js";
import {
  formatContextGraphSummary,
  getComponents,
  topologicalSort,
} from "../src/graph/graph-algorithms.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";

// Build real graphs from small inline Markdown maps (mirrors build-context-graph.test.ts) so these
// tests stay coupled to the actual edge shape rather than hand-authored ContextGraph literals.
function graphOf(entries: Record<string, string>) {
  const map = new Map<string, ParsedDocument>();
  for (const [filePath, content] of Object.entries(entries)) {
    map.set(filePath, parseDocument({ path: filePath, content }));
  }
  return buildContextGraph(map);
}

describe("topologicalSort", () => {
  it("orders a linear chain with nothing excluded", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "# C\n",
    });

    expect(topologicalSort(graph)).toEqual({
      order: ["a.md", "b.md", "c.md"],
      excluded: [],
    });
  });

  it("emits multiple zero-in-degree roots in sorted order", () => {
    const graph = graphOf({
      "a.md": "[z](z.md)\n",
      "b.md": "[z](z.md)\n",
      "z.md": "# Z\n",
    });

    expect(topologicalSort(graph)).toEqual({
      order: ["a.md", "b.md", "z.md"],
      excluded: [],
    });
  });

  it("excludes both members of a 2-cycle and emits an empty order", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "[a](a.md)\n" });

    expect(topologicalSort(graph)).toEqual({
      order: [],
      excluded: ["a.md", "b.md"],
    });
  });

  it("excludes a node reachable only through a cycle (honest excluded-set semantics)", () => {
    // a↔b is a cycle; c hangs off b so it can never be emitted either. x→y is independent and orders
    // normally, proving `order` is not simply emptied whenever a cycle exists.
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[a](a.md)\n[c](c.md)\n",
      "c.md": "# C\n",
      "x.md": "[y](y.md)\n",
      "y.md": "# Y\n",
    });

    expect(topologicalSort(graph)).toEqual({
      order: ["x.md", "y.md"],
      excluded: ["a.md", "b.md", "c.md"],
    });
  });

  it("still orders a target fed by parallel edges (deduped-in-degree regression)", () => {
    // Two `a→b` links: raw in-degree of b is 2, so an un-deduped Kahn's would strand b in `excluded`.
    const graph = graphOf({
      "a.md": "[one](b.md)\n[two](b.md)\n",
      "b.md": "# B\n",
    });

    expect(topologicalSort(graph)).toEqual({
      order: ["a.md", "b.md"],
      excluded: [],
    });
  });
});

describe("getComponents", () => {
  it("returns disjoint clusters largest-first", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "# C\n",
      "x.md": "[y](y.md)\n",
      "y.md": "# Y\n",
    });

    expect(getComponents(graph)).toEqual([
      ["a.md", "b.md", "c.md"],
      ["x.md", "y.md"],
    ]);
  });

  it("tie-breaks equal-size components by smallest node path", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "# B\n",
      "c.md": "[d](d.md)\n",
      "d.md": "# D\n",
    });

    expect(getComponents(graph)).toEqual([
      ["a.md", "b.md"],
      ["c.md", "d.md"],
    ]);
  });

  it("reports an unlinked file as its own singleton component", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "# B\n",
      "lonely.md": "# Lonely\n",
    });

    expect(getComponents(graph)).toEqual([["a.md", "b.md"], ["lonely.md"]]);
  });

  it("treats a one-directional edge as a single undirected component", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });

    expect(getComponents(graph)).toEqual([["a.md", "b.md"]]);
  });
});

describe("formatContextGraphSummary", () => {
  it("reports counts, entry points, and top hubs by total degree", () => {
    const graph = graphOf({
      "index.md": "[a](a.md)\n[b](b.md)\n",
      "a.md": "[b](b.md)\n",
      "b.md": "# B\n",
    });

    expect(formatContextGraphSummary(graph)).toBe(
      [
        "nodes: 3",
        "edges: 3",
        "cycles: 0",
        // One indented item per line, exactly like `top hubs` below it. Comma-joining these
        // produced a 3497-character single line on the 139-node corpus.
        "entry points (1):",
        "  index.md",
        "top hubs:",
        "  a.md (2)",
        "  b.md (2)",
        "  index.md (2)",
      ].join("\n"),
    );
  });

  it("renders an empty entry-point set as a bare header with no trailing space", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "[a](a.md)\n" });

    expect(formatContextGraphSummary(graph).split("\n")).toContain(
      "entry points (0):",
    );
  });

  it("lists cycles so reading order reports what was excluded", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "[a](a.md)\n" });

    expect(formatContextGraphSummary(graph)).toBe(
      [
        "nodes: 2",
        "edges: 2",
        "cycles: 1",
        "entry points (0):",
        "top hubs:",
        "  a.md (2)",
        "  b.md (2)",
        "cycles:",
        "  a.md -> b.md -> a.md",
      ].join("\n"),
    );
  });

  it("bounds a long cycle path's hop count (render-bounds)", () => {
    // A 10-node cycle is an 11-entry closed path, past CYCLE_PATH_HOP_LIMIT, so the summary's cycle
    // line is elided rather than growing with the strongly connected component.
    const entries: Record<string, string> = {};
    for (let index = 0; index < 10; index += 1) {
      entries[`n${index}.md`] = `[next](n${(index + 1) % 10}.md)\n`;
    }

    const cycleLine = formatContextGraphSummary(graphOf(entries))
      .split("\n")
      .find((line) => line.includes(" -> "));

    expect(cycleLine).toBe(
      "  n0.md -> n1.md -> n2.md -> n3.md -> n4.md -> n5.md -> n6.md -> ... -> n0.md (+3 more hops)",
    );
  });
});
