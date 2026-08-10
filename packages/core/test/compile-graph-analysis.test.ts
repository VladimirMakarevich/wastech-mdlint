import { describe, expect, it } from "vitest";

import {
  analyzeGraph,
  classifyNodes,
  DEFAULT_HUB_MIN_IN_DEGREE,
} from "../src/compile/graph-analysis.js";
import { buildContextGraph } from "../src/graph/build-context-graph.js";
import { formatContextGraphSummary } from "../src/graph/graph-algorithms.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";

// Build real graphs from small inline Markdown maps so the compile analysis stays pinned to the
// shipped parser + graph-builder semantics instead of a hand-authored graph test double.
function graphOf(entries: Record<string, string>) {
  const map = new Map<string, ParsedDocument>();
  for (const [filePath, content] of Object.entries(entries)) {
    map.set(filePath, parseDocument({ path: filePath, content }));
  }
  return buildContextGraph(map);
}

describe("classifyNodes", () => {
  it("assigns all five roles deterministically from node degrees", () => {
    const graph = graphOf({
      "bridge.md": "[hub](hub.md)\n[leaf](leaf.md)\n",
      "entry.md": "[bridge](bridge.md)\n[hub](hub.md)\n",
      "hub-ref.md": "[hub](hub.md)\n",
      "hub.md": "# Hub\n",
      "isolated.md": "# Isolated\n",
      "leaf.md": "# Leaf\n",
    });

    expect(classifyNodes(graph)).toEqual([
      { path: "bridge.md", role: "bridge" },
      { path: "entry.md", role: "entry" },
      { path: "hub-ref.md", role: "entry" },
      { path: "hub.md", role: "hub" },
      { path: "isolated.md", role: "isolated" },
      { path: "leaf.md", role: "leaf" },
    ]);
  });

  it("keeps a heavily referenced terminal document classified as a hub", () => {
    const graph = graphOf({
      "a.md": "[hub](hub.md)\n",
      "b.md": "[hub](hub.md)\n",
      "c.md": "[hub](hub.md)\n",
      "hub.md": "# Hub\n",
    });

    expect(classifyNodes(graph)).toEqual([
      { path: "a.md", role: "entry" },
      { path: "b.md", role: "entry" },
      { path: "c.md", role: "entry" },
      { path: "hub.md", role: "hub" },
    ]);
  });

  it("supports overriding the hub threshold without changing the default", () => {
    const graph = graphOf({
      "a.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "b.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "bridge.md": "[sink](sink.md)\n",
      "c.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "leaf.md": "# Leaf\n",
      "sink.md": "# Sink\n",
    });

    expect(DEFAULT_HUB_MIN_IN_DEGREE).toBe(3);
    expect(classifyNodes(graph)).toEqual([
      { path: "a.md", role: "entry" },
      { path: "b.md", role: "entry" },
      { path: "bridge.md", role: "hub" },
      { path: "c.md", role: "entry" },
      { path: "leaf.md", role: "hub" },
      { path: "sink.md", role: "leaf" },
    ]);
    expect(classifyNodes(graph, { hubMinInDegree: 4 })).toEqual([
      { path: "a.md", role: "entry" },
      { path: "b.md", role: "entry" },
      { path: "bridge.md", role: "bridge" },
      { path: "c.md", role: "entry" },
      { path: "leaf.md", role: "leaf" },
      { path: "sink.md", role: "leaf" },
    ]);
  });

  it("uses the raw retained-multiplicity degrees from the graph nodes", () => {
    const graph = graphOf({
      "a.md": "[one](target.md)\n[two](target.md)\n[three](target.md)\n",
      "target.md": "# Target\n",
    });

    expect(graph.nodes).toEqual([
      { path: "a.md", inDegree: 0, outDegree: 3 },
      { path: "target.md", inDegree: 3, outDegree: 0 },
    ]);
    expect(classifyNodes(graph)).toEqual([
      { path: "a.md", role: "entry" },
      { path: "target.md", role: "hub" },
    ]);
  });

  it("returns the same result across repeated calls", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "# C\n",
      "isolated.md": "# Isolated\n",
    });

    expect(classifyNodes(graph)).toEqual(classifyNodes(graph));
  });
});

describe("hub agreement between the graph report and the skill's roles", () => {
  // Two shipped surfaces answer "is this document a hub": the graph summary's `top hubs` list and
  // the role this module assigns. They once answered it differently — the list ranked by
  // `inDegree + outDegree`, so an index referencing many documents and referenced by one led the
  // list while this classifier called it a `bridge`. Reading the list back out of the rendered text
  // (rather than re-deriving it) is what makes this a comparison of two documents instead of one
  // formula agreeing with itself.
  function listedHubs(summary: string): string[] {
    const lines = summary.split("\n");
    const start = lines.indexOf("top hubs:") + 1;
    const end = lines.findIndex(
      (line, index) => index >= start && !line.startsWith("  "),
    );
    return lines
      .slice(start, end === -1 ? lines.length : end)
      .map((line) => line.slice(2).replace(/ \(\d+\/\d+\)$/, ""))
      .filter((path) => !path.startsWith("(none"));
  }

  // An index (in 1 / out 6) alongside the document five others reference: the exact inversion, at a
  // scale small enough to read.
  const graph = graphOf({
    "index.md": "[audit](audit.md)\n",
    "audit.md":
      "[api](api.md)\n[a](a.md)\n[b](b.md)\n[c](c.md)\n[d](d.md)\n[e](e.md)\n",
    "a.md": "[api](api.md)\n",
    "b.md": "[api](api.md)\n",
    "c.md": "[api](api.md)\n",
    "d.md": "[api](api.md)\n",
    "e.md": "# E\n",
    "api.md": "# API\n",
  });

  it("never lists a document the classifier calls a non-hub", () => {
    for (const hubMinInDegree of [1, 2, 3, 5, 6]) {
      const roles = new Map(
        classifyNodes(graph, { hubMinInDegree }).map((entry) => [
          entry.path,
          entry.role,
        ]),
      );

      for (const listed of listedHubs(
        formatContextGraphSummary(graph, { hubMinInDegree }),
      )) {
        expect(roles.get(listed)).toBe("hub");
      }
    }
  });

  it("leads with the document the corpus depends on, not the one that depends on it", () => {
    expect(listedHubs(formatContextGraphSummary(graph))).toEqual(["api.md"]);
    expect(
      classifyNodes(graph).find((entry) => entry.path === "audit.md")?.role,
    ).toBe("bridge");
  });
});

describe("analyzeGraph", () => {
  it("bundles reading order, excluded nodes, components, classification, and cycles", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[a](a.md)\n",
      "x.md": "[y](y.md)\n",
      "y.md": "# Y\n",
    });

    expect(analyzeGraph(graph)).toEqual({
      readingOrder: ["x.md", "y.md"],
      excludedFromReadingOrder: ["a.md", "b.md"],
      components: [
        ["a.md", "b.md"],
        ["x.md", "y.md"],
      ],
      classification: [
        { path: "a.md", role: "bridge" },
        { path: "b.md", role: "bridge" },
        { path: "x.md", role: "entry" },
        { path: "y.md", role: "leaf" },
      ],
      cycles: [["a.md", "b.md", "a.md"]],
    });
  });
});
