import { describe, expect, it } from "vitest";

import { buildContextGraph } from "../src/graph/build-context-graph.js";
import {
  classifyImpact,
  getImpactSet,
  ImpactAnalysisError,
  relativizeImpact
} from "../src/graph/impact-analysis.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";

// Build real graphs from small inline Markdown maps (mirrors graph-query.test.ts /
// graph-algorithms.test.ts) so these tests stay coupled to the actual edge shape rather than
// hand-authored ContextGraph literals.
function graphOf(entries: Record<string, string>) {
  const map = new Map<string, ParsedDocument>();
  for (const [filePath, content] of Object.entries(entries)) {
    map.set(filePath, parseDocument({ path: filePath, content }));
  }
  return buildContextGraph(map);
}

describe("getImpactSet", () => {
  it("returns the full transitive closure, excluding the changed file itself", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "[d](d.md)\n",
      "d.md": "# D\n"
    });

    expect(getImpactSet(graph, "d.md")).toEqual([
      { path: "a.md", depth: 3, via: "b.md" },
      { path: "b.md", depth: 2, via: "c.md" },
      { path: "c.md", depth: 1, via: "d.md" }
    ]);
  });

  it("normalizes a './'-prefixed path before resolving", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });

    expect(getImpactSet(graph, "./b.md")).toEqual([{ path: "a.md", depth: 1, via: "b.md" }]);
  });
});

describe("classifyImpact · linear chain", () => {
  it("splits direct vs transitive impact and orders the affected subgraph", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "[d](d.md)\n",
      "d.md": "# D\n"
    });

    expect(classifyImpact(graph, "d.md")).toEqual({
      file: "d.md",
      directlyAffected: [{ path: "c.md", references: 1 }],
      transitivelyAffected: [
        { path: "a.md", depth: 3, via: "b.md" },
        { path: "b.md", depth: 2, via: "c.md" }
      ],
      readingOrder: ["a.md", "b.md", "c.md", "d.md"],
      excluded: []
    });
  });
});

describe("classifyImpact · reading order is topological, not lexical", () => {
  it("keeps the predecessor first even when that sorts after its successor alphabetically", () => {
    const graph = graphOf({ "z.md": "[a](a.md)\n", "a.md": "# A\n" });

    const result = classifyImpact(graph, "a.md");
    expect(result.directlyAffected).toEqual([{ path: "z.md", references: 1 }]);
    // Alphabetical would be ["a.md", "z.md"]; topological order must stay ["z.md", "a.md"].
    expect(result.readingOrder).toEqual(["z.md", "a.md"]);
  });
});

describe("classifyImpact · reference multiplicity", () => {
  it("counts two links from the same file as two references", () => {
    const graph = graphOf({ "a.md": "[one](b.md)\n[two](b.md)\n", "b.md": "# B\n" });

    expect(classifyImpact(graph, "b.md").directlyAffected).toEqual([{ path: "a.md", references: 2 }]);
  });
});

describe("classifyImpact · diamond", () => {
  it("classifies the merge points as direct and the shared ancestor as transitive", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n[c](c.md)\n",
      "b.md": "[d](d.md)\n",
      "c.md": "[d](d.md)\n",
      "d.md": "# D\n"
    });

    const result = classifyImpact(graph, "d.md");
    expect(result.directlyAffected).toEqual([
      { path: "b.md", references: 1 },
      { path: "c.md", references: 1 }
    ]);
    // Deterministic via: the smallest predecessor (b.md) at the minimal depth claims a.md.
    expect(result.transitivelyAffected).toEqual([{ path: "a.md", depth: 2, via: "b.md" }]);
  });
});

describe("classifyImpact · cycle safety", () => {
  it("terminates and reports both cycle members as direct, excluded from reading order", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n[c](c.md)\n",
      "b.md": "[a](a.md)\n[c](c.md)\n",
      "c.md": "# C\n"
    });

    const result = classifyImpact(graph, "c.md");
    expect(result.directlyAffected).toEqual([
      { path: "a.md", references: 1 },
      { path: "b.md", references: 1 }
    ]);
    expect(result.transitivelyAffected).toEqual([]);
    // a<->b is a cycle, so Kahn's never drains their in-degree to zero: nothing in the affected
    // subgraph (including c.md, which every cycle member feeds) can be emitted.
    expect(result.readingOrder).toEqual([]);
    expect(result.excluded).toEqual(["a.md", "b.md", "c.md"]);
  });
});

describe("classifyImpact · out-of-corpus input", () => {
  it("throws ImpactAnalysisError with an actionable hint", () => {
    const graph = graphOf({ "a.md": "# A\n" });

    expect(() => classifyImpact(graph, "missing.md")).toThrow(ImpactAnalysisError);
    try {
      classifyImpact(graph, "missing.md");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ImpactAnalysisError);
      expect((error as ImpactAnalysisError).hint.length).toBeGreaterThan(0);
      // Structured code (M6) lets an MCP host map this to the shared error contract.
      expect((error as ImpactAnalysisError).code).toBe("TARGET_NOT_FOUND");
      expect((error as Error).message).toContain("missing.md");
    }
  });
});

describe("relativizeImpact", () => {
  it("rewrites every path field relative to cwd and stays sorted", () => {
    const graph = graphOf({
      "docs/a.md": "[b](b.md)\n",
      "docs/b.md": "[c](c.md)\n",
      "docs/c.md": "[d](d.md)\n",
      "docs/d.md": "# D\n"
    });

    const impact = classifyImpact(graph, "docs/d.md");
    expect(relativizeImpact(impact, "docs")).toEqual({
      file: "d.md",
      directlyAffected: [{ path: "c.md", references: 1 }],
      transitivelyAffected: [
        { path: "a.md", depth: 3, via: "b.md" },
        { path: "b.md", depth: 2, via: "c.md" }
      ],
      readingOrder: ["a.md", "b.md", "c.md", "d.md"],
      excluded: []
    });
  });

  it("treats an empty cwd (the repo root) as identity", () => {
    const graph = graphOf({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });

    const impact = classifyImpact(graph, "b.md");
    expect(relativizeImpact(impact, "")).toEqual(impact);
  });

  it("preserves topological (non-lexical) reading order after relativizing", () => {
    const graph = graphOf({ "docs/z.md": "[a](a.md)\n", "docs/a.md": "# A\n" });

    const impact = classifyImpact(graph, "docs/a.md");
    // Alphabetical would flip this to ["a.md", "z.md"]; relativize must only map, not re-sort.
    expect(relativizeImpact(impact, "docs").readingOrder).toEqual(["z.md", "a.md"]);
  });
});
