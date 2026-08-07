import { describe, expect, it } from "vitest";

import { classifyNodes, type NodeRole } from "../src/compile/graph-analysis.js";
import {
  getComponents,
  topologicalSort,
} from "../src/graph/graph-algorithms.js";
import {
  LARGE_CORPUS_COMPONENT_COUNT,
  LARGE_CORPUS_DOCUMENT_COUNT,
  LARGE_CORPUS_ENTRY_POINT_COUNT,
  LARGE_CORPUS_EXCLUDED_COUNT,
  LARGE_CORPUS_HUB_IN_DEGREE,
  LARGE_CORPUS_HUB_PATH,
  LARGE_CORPUS_LARGEST_CLUSTER_SIZE,
  largeCorpusFiles,
} from "./support/large-corpus.js";
import { largeCorpusGraph } from "./support/large-corpus-graph.js";

// The fixture's stated properties, asserted in one place so the renderer suites that depend on them
// (graph-render, compile-context, and the cli/mcp e2e suites across the workspace) fail here — with
// the property named — rather than in a confusing downstream diff. P16.01 §3 adopts this fixture,
// and P15.02 reuses it for the graph JSON contract.

describe("large corpus fixture", () => {
  it("generates the stated node count", () => {
    expect(Object.keys(largeCorpusFiles())).toHaveLength(
      LARGE_CORPUS_DOCUMENT_COUNT,
    );
  });

  it("is pure: two generations are deeply equal", () => {
    expect(largeCorpusFiles()).toEqual(largeCorpusFiles());
  });

  it("has one high-in-degree hub, far past any per-direction render cap", () => {
    const graph = largeCorpusGraph();
    const hub = graph.nodes.find((node) => node.path === LARGE_CORPUS_HUB_PATH);

    expect(hub?.inDegree).toBe(LARGE_CORPUS_HUB_IN_DEGREE);
    // No other document comes close, so "the hub" is unambiguous in every assertion downstream.
    const runnerUp = Math.max(
      ...graph.nodes
        .filter((node) => node.path !== LARGE_CORPUS_HUB_PATH)
        .map((node) => node.inDegree),
    );
    expect(runnerUp).toBeLessThan(LARGE_CORPUS_HUB_IN_DEGREE / 4);
  });

  it("forces a large topological exclusion set from a short cycle", () => {
    const graph = largeCorpusGraph();
    const { order, excluded } = topologicalSort(graph);

    // The cycle is 3 nodes; everything else excluded is the tail reachable only through it. That
    // separation is the point: exclusion comes from reachability, not from cycle size.
    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0]).toHaveLength(4); // closed path, start repeated
    expect(excluded).toHaveLength(LARGE_CORPUS_EXCLUDED_COUNT);
    expect(order).toHaveLength(
      LARGE_CORPUS_DOCUMENT_COUNT - LARGE_CORPUS_EXCLUDED_COUNT,
    );
  });

  it("has one large cluster plus singletons, and the stated entry-point count", () => {
    const graph = largeCorpusGraph();
    const components = getComponents(graph);

    expect(components).toHaveLength(LARGE_CORPUS_COMPONENT_COUNT);
    expect(components[0]).toHaveLength(LARGE_CORPUS_LARGEST_CLUSTER_SIZE);
    expect(components.slice(1).every((cluster) => cluster.length === 1)).toBe(
      true,
    );
    expect(graph.nodes.filter((node) => node.inDegree === 0)).toHaveLength(
      LARGE_CORPUS_ENTRY_POINT_COUNT,
    );
  });

  it("reproduces the field's collapsed role histogram (W-28 evidence)", () => {
    // This exact histogram is quoted in `docs/mdlint_v2/accepted-behaviors.md`. It is asserted, not
    // computed into the doc, because the register's claim is about a *measured* corpus — if the
    // fixture drifts, the register row becomes false and this is what says so.
    const histogram: Partial<Record<NodeRole, number>> = {};
    for (const { role } of classifyNodes(largeCorpusGraph())) {
      histogram[role] = (histogram[role] ?? 0) + 1;
    }

    expect(histogram).toEqual({
      hub: 73,
      isolated: 46,
      entry: 11,
      bridge: 5,
      leaf: 4,
    });
    // 86% in two buckets, against the field's 83% — the coarseness W-28 is about is a property of
    // the vocabulary, not of one corpus.
    expect((73 + 46) / LARGE_CORPUS_DOCUMENT_COUNT).toBeGreaterThan(0.85);
  });
});
