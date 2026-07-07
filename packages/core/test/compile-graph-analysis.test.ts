import { describe, expect, it } from "vitest";

import {
  analyzeGraph,
  classifyNodes,
  DEFAULT_HUB_MIN_IN_DEGREE
} from "../src/compile/graph-analysis.js";
import { buildContextGraph } from "../src/graph/build-context-graph.js";
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
      "leaf.md": "# Leaf\n"
    });

    expect(classifyNodes(graph)).toEqual([
      { path: "bridge.md", role: "bridge" },
      { path: "entry.md", role: "entry" },
      { path: "hub-ref.md", role: "entry" },
      { path: "hub.md", role: "hub" },
      { path: "isolated.md", role: "isolated" },
      { path: "leaf.md", role: "leaf" }
    ]);
  });

  it("keeps a heavily referenced terminal document classified as a hub", () => {
    const graph = graphOf({
      "a.md": "[hub](hub.md)\n",
      "b.md": "[hub](hub.md)\n",
      "c.md": "[hub](hub.md)\n",
      "hub.md": "# Hub\n"
    });

    expect(classifyNodes(graph)).toEqual([
      { path: "a.md", role: "entry" },
      { path: "b.md", role: "entry" },
      { path: "c.md", role: "entry" },
      { path: "hub.md", role: "hub" }
    ]);
  });

  it("supports overriding the hub threshold without changing the default", () => {
    const graph = graphOf({
      "a.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "b.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "bridge.md": "[sink](sink.md)\n",
      "c.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "leaf.md": "# Leaf\n",
      "sink.md": "# Sink\n"
    });

    expect(DEFAULT_HUB_MIN_IN_DEGREE).toBe(3);
    expect(classifyNodes(graph)).toEqual([
      { path: "a.md", role: "entry" },
      { path: "b.md", role: "entry" },
      { path: "bridge.md", role: "hub" },
      { path: "c.md", role: "entry" },
      { path: "leaf.md", role: "hub" },
      { path: "sink.md", role: "leaf" }
    ]);
    expect(classifyNodes(graph, { hubMinInDegree: 4 })).toEqual([
      { path: "a.md", role: "entry" },
      { path: "b.md", role: "entry" },
      { path: "bridge.md", role: "bridge" },
      { path: "c.md", role: "entry" },
      { path: "leaf.md", role: "leaf" },
      { path: "sink.md", role: "leaf" }
    ]);
  });

  it("uses the raw retained-multiplicity degrees from the graph nodes", () => {
    const graph = graphOf({
      "a.md": "[one](target.md)\n[two](target.md)\n[three](target.md)\n",
      "target.md": "# Target\n"
    });

    expect(graph.nodes).toEqual([
      { path: "a.md", inDegree: 0, outDegree: 3 },
      { path: "target.md", inDegree: 3, outDegree: 0 }
    ]);
    expect(classifyNodes(graph)).toEqual([
      { path: "a.md", role: "entry" },
      { path: "target.md", role: "hub" }
    ]);
  });

  it("returns the same result across repeated calls", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[c](c.md)\n",
      "c.md": "# C\n",
      "isolated.md": "# Isolated\n"
    });

    expect(classifyNodes(graph)).toEqual(classifyNodes(graph));
  });
});

describe("analyzeGraph", () => {
  it("bundles reading order, excluded nodes, components, classification, and cycles", () => {
    const graph = graphOf({
      "a.md": "[b](b.md)\n",
      "b.md": "[a](a.md)\n",
      "x.md": "[y](y.md)\n",
      "y.md": "# Y\n"
    });

    expect(analyzeGraph(graph)).toEqual({
      readingOrder: ["x.md", "y.md"],
      excludedFromReadingOrder: ["a.md", "b.md"],
      components: [
        ["a.md", "b.md"],
        ["x.md", "y.md"]
      ],
      classification: [
        { path: "a.md", role: "bridge" },
        { path: "b.md", role: "bridge" },
        { path: "x.md", role: "entry" },
        { path: "y.md", role: "leaf" }
      ],
      cycles: [["a.md", "b.md", "a.md"]]
    });
  });
});
