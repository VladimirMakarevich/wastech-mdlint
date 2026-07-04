import { describe, expect, it } from "vitest";

import { buildContextGraph } from "../src/graph/build-context-graph.js";
import { impact, query, slice } from "../src/graph/query.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";

// Build real graphs from small inline Markdown maps (mirrors graph-algorithms.test.ts) so these
// tests stay coupled to the actual edge shape rather than hand-authored ContextGraph literals.
function graphOf(entries: Record<string, string>) {
  const map = new Map<string, ParsedDocument>();
  for (const [filePath, content] of Object.entries(entries)) {
    map.set(filePath, parseDocument({ path: filePath, content }));
  }
  return buildContextGraph(map);
}

describe("query · forward / slice", () => {
  it("bounds a linear chain by depth, excluding nodes past the bound", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "[d](d.md)\n",
      "d.md": "# D\n"
    });

    expect(slice(graph, "a.md", 2)).toEqual({
      visited: [
        { path: "a.md", depth: 0, via: null },
        { path: "b.md", depth: 1, via: "a.md" },
        { path: "c.md", depth: 2, via: "b.md" }
      ]
    });
  });

  it("traverses to exhaustion when depth is omitted", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "[d](d.md)\n",
      "d.md": "# D\n"
    });

    expect(query(graph, { start: "a.md", direction: "forward" })).toEqual({
      visited: [
        { path: "a.md", depth: 0, via: null },
        { path: "b.md", depth: 1, via: "a.md" },
        { path: "c.md", depth: 2, via: "b.md" },
        { path: "d.md", depth: 3, via: "c.md" }
      ]
    });
  });
});

describe("query · reverse / impact", () => {
  it("returns the full closure of upstream references, no depth bound", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "[d](d.md)\n",
      "d.md": "# D\n"
    });

    expect(impact(graph, "d.md")).toEqual({
      visited: [
        { path: "a.md", depth: 3, via: "b.md" },
        { path: "b.md", depth: 2, via: "c.md" },
        { path: "c.md", depth: 1, via: "d.md" },
        { path: "d.md", depth: 0, via: null }
      ]
    });
  });
});

describe("query · deterministic via", () => {
  it("claims a diamond target through the smallest predecessor at minimal depth", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n[c](c.md)\n",
      "b.md": "[d](d.md)\n",
      "c.md": "[d](d.md)\n",
      "d.md": "# D\n"
    });

    const result = query(graph, { start: "a.md", direction: "forward" });
    const d = result.visited.find((visit) => visit.path === "d.md");
    expect(d).toEqual({ path: "d.md", depth: 2, via: "b.md" });
  });
});

describe("query · cycle safety", () => {
  it("terminates on a cycle, visiting each node once, without removing the reported cycle", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[a](a.md)\n[c](c.md)\n",
      "c.md": "# C\n"
    });

    expect(query(graph, { start: "a.md", direction: "forward" })).toEqual({
      visited: [
        { path: "a.md", depth: 0, via: null },
        { path: "b.md", depth: 1, via: "a.md" },
        { path: "c.md", depth: 2, via: "b.md" }
      ]
    });
    expect(graph.cycles).not.toEqual([]);
  });
});

describe("query · edgeTypes filter", () => {
  it("follows only the requested edge type; [] follows none; undefined follows all", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n![diagram](c.md)\n",
      "b.md": "# B\n",
      "c.md": "# C\n"
    });

    expect(query(graph, { start: "a.md", direction: "forward", edgeTypes: ["link"] })).toEqual({
      visited: [
        { path: "a.md", depth: 0, via: null },
        { path: "b.md", depth: 1, via: "a.md" }
      ]
    });

    expect(query(graph, { start: "a.md", direction: "forward", edgeTypes: [] })).toEqual({
      visited: [{ path: "a.md", depth: 0, via: null }]
    });

    expect(query(graph, { start: "a.md", direction: "forward" })).toEqual({
      visited: [
        { path: "a.md", depth: 0, via: null },
        { path: "b.md", depth: 1, via: "a.md" },
        { path: "c.md", depth: 1, via: "a.md" }
      ]
    });
  });
});

describe("query · start not in graph", () => {
  it("returns an empty visited set", () => {
    const graph = graphOf({ "a.md": "# A\n" });

    expect(query(graph, { start: "missing.md", direction: "forward" })).toEqual({ visited: [] });
  });
});

describe("query · determinism", () => {
  it("sorts visited by path regardless of discovery order", () => {
    const graph = graphOf({
      "a.md": "[z](z.md)\n[m](m.md)\n[b](b.md)\n",
      "z.md": "# Z\n",
      "m.md": "# M\n",
      "b.md": "# B\n"
    });

    expect(query(graph, { start: "a.md", direction: "forward" }).visited.map((visit) => visit.path)).toEqual([
      "a.md",
      "b.md",
      "m.md",
      "z.md"
    ]);
  });
});

describe("query · parallel-edge dedup", () => {
  it("visits a target fed by two identical links once", () => {
    const graph = graphOf({ "a.md": "[one](b.md)\n[two](b.md)\n", "b.md": "# B\n" });

    expect(query(graph, { start: "a.md", direction: "forward" })).toEqual({
      visited: [
        { path: "a.md", depth: 0, via: null },
        { path: "b.md", depth: 1, via: "a.md" }
      ]
    });
  });
});
