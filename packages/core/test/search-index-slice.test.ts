import { describe, expect, it } from "vitest";

import type { IdRef } from "../src/engine/defined-ids.js";
import type { ContextGraph } from "../src/graph/context-graph-types.js";
import { buildContextGraph } from "../src/graph/build-context-graph.js";
import {
  buildSearchIndex,
  getContextSlice,
  resolveQuery,
  SLICE_RESOLUTION_DESCRIPTION
} from "../src/graph/search-index.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";

// Build real documents + a real graph from inline Markdown (mirrors graph-query.test.ts's
// `graphOf`), extended to also return `documents` since `getContextSlice`/`buildSearchIndex`
// need the parsed documents, not just the graph.
function buildFixture(
  entries: Record<string, string>,
  idRef?: IdRef
): { documents: Map<string, ParsedDocument>; graph: ContextGraph } {
  const documents = new Map<string, ParsedDocument>();
  for (const [filePath, content] of Object.entries(entries)) {
    documents.set(filePath, parseDocument({ path: filePath, content }));
  }
  const graph = buildContextGraph(documents, idRef === undefined ? {} : { idRef });
  return { documents, graph };
}

describe("resolveQuery · id", () => {
  const idRef: IdRef = { idPattern: "^REQ-\\d+$", definitions: ["a.md", "b.md"], idColumn: "ID" };

  it("resolves an ID to its single defining file", () => {
    const { documents } = buildFixture({ "a.md": "# REQ-1\n" }, idRef);
    const index = buildSearchIndex(documents, idRef);

    expect(resolveQuery(index, "REQ-1")).toEqual({ kind: "id", starts: ["a.md"] });
  });

  it("resolves an ID defined in multiple files to all of them, sorted", () => {
    const { documents } = buildFixture({ "b.md": "# REQ-1\n", "a.md": "# REQ-1\n" }, idRef);
    const index = buildSearchIndex(documents, idRef);

    expect(resolveQuery(index, "REQ-1")).toEqual({ kind: "id", starts: ["a.md", "b.md"] });
  });
});

describe("resolveQuery · heading / anchor", () => {
  it("resolves a bare slug as a heading and a #-prefixed slug as an anchor, to the same file", () => {
    const { documents } = buildFixture({ "h.md": "# Getting Started\n" });
    const index = buildSearchIndex(documents);

    expect(resolveQuery(index, "getting-started")).toEqual({ kind: "heading", starts: ["h.md"] });
    expect(resolveQuery(index, "#getting-started")).toEqual({ kind: "anchor", starts: ["h.md"] });
  });

  it("keeps dedup state per document: duplicate headings get -1/-2 slugs scoped to their file", () => {
    const { documents } = buildFixture({
      "dup.md": "# Foo\n\n## Foo\n",
      "single.md": "# Foo\n"
    });
    const index = buildSearchIndex(documents);

    // "foo" is defined independently in both documents (dedup does not leak across documents).
    expect(resolveQuery(index, "foo")).toEqual({ kind: "heading", starts: ["dup.md", "single.md"] });
    // "foo-1" only exists because dup.md repeated the heading; it must not resolve to single.md.
    expect(resolveQuery(index, "foo-1")).toEqual({ kind: "heading", starts: ["dup.md"] });
  });
});

describe("resolveQuery · path", () => {
  it("resolves a repo-relative path, normalizing a leading ./ and backslashes", () => {
    const { documents } = buildFixture({ "docs/design.md": "# Design\n" });
    const index = buildSearchIndex(documents);

    expect(resolveQuery(index, "docs/design.md")).toEqual({ kind: "path", starts: ["docs/design.md"] });
    expect(resolveQuery(index, "./docs/design.md")).toEqual({ kind: "path", starts: ["docs/design.md"] });
    expect(resolveQuery(index, "docs\\design.md")).toEqual({ kind: "path", starts: ["docs/design.md"] });
  });
});

describe("resolveQuery · cross-category precedence", () => {
  it("prefers path over id when a query matches both", () => {
    // A deliberately permissive idPattern so "shared.md" itself can be an ID token — this is a
    // contrived collision to prove precedence, not a realistic idPattern.
    const idRef: IdRef = { idPattern: "\\S+", definitions: ["defs.md"], idColumn: "ID" };
    const { documents } = buildFixture(
      { "shared.md": "# Shared\n", "defs.md": "| ID |\n| --- |\n| shared.md |\n" },
      idRef
    );
    const index = buildSearchIndex(documents, idRef);

    expect(resolveQuery(index, "shared.md")).toEqual({ kind: "path", starts: ["shared.md"] });
  });

  it("prefers id over heading when a query matches both", () => {
    const idRef: IdRef = { idPattern: "^[a-z]+$", definitions: ["a.md"], idColumn: "ID" };
    const { documents } = buildFixture(
      { "b.md": "# Widget\n", "a.md": "| ID |\n| --- |\n| widget |\n" },
      idRef
    );
    const index = buildSearchIndex(documents, idRef);

    expect(resolveQuery(index, "widget")).toEqual({ kind: "id", starts: ["a.md"] });
  });
});

describe("resolveQuery · no match", () => {
  it("returns null for a query that matches no category", () => {
    const { documents } = buildFixture({ "a.md": "# A\n" });
    const index = buildSearchIndex(documents);

    expect(resolveQuery(index, "nonexistent")).toBeNull();
  });
});

describe("buildSearchIndex · idRef omitted", () => {
  it("leaves the ID index empty while slug/path lookups still work", () => {
    const { documents } = buildFixture({ "a.md": "# REQ-1\n" });
    const index = buildSearchIndex(documents);

    expect(index.byId.size).toBe(0);
    // "REQ-1" only exists as case-sensitive prose, not as the lowercased heading slug "req-1".
    expect(resolveQuery(index, "REQ-1")).toBeNull();
    expect(resolveQuery(index, "req-1")).toEqual({ kind: "heading", starts: ["a.md"] });
    expect(resolveQuery(index, "a.md")).toEqual({ kind: "path", starts: ["a.md"] });
  });
});

describe("getContextSlice · no match", () => {
  it("returns an empty result when the query resolves to nothing", () => {
    const { documents, graph } = buildFixture({ "a.md": "# A\n" });

    expect(getContextSlice(graph, documents, "nonexistent")).toEqual({
      query: "nonexistent",
      matchKind: null,
      starts: [],
      files: [],
      visited: []
    });
  });
});

describe("getContextSlice · multi-start union and depth bound", () => {
  const idRef: IdRef = { idPattern: "^REQ-\\d+$", definitions: ["x.md", "y.md"], idColumn: "ID" };

  function multiStartFixture() {
    return buildFixture(
      {
        "x.md": "# REQ-1\n\n[shared](shared.md)\n",
        "y.md": "# REQ-1\n\n[mid](mid.md)\n",
        "mid.md": "[shared](shared.md)\n",
        "shared.md": "# Shared\n"
      },
      idRef
    );
  }

  it("merges reachable sets from both starts and lets the minimal depth win on overlap", () => {
    const { documents, graph } = multiStartFixture();

    const result = getContextSlice(graph, documents, "REQ-1", 2, idRef);

    expect(result.matchKind).toBe("id");
    expect(result.starts).toEqual(["x.md", "y.md"]);
    // shared.md is reachable at depth 1 via x.md and depth 2 via y.md -> mid.md; the depth-1 route wins.
    expect(result.visited).toEqual([
      { path: "mid.md", depth: 1, via: "y.md" },
      { path: "shared.md", depth: 1, via: "x.md" },
      { path: "x.md", depth: 0, via: null },
      { path: "y.md", depth: 0, via: null }
    ]);
    expect(result.files).toEqual(["mid.md", "shared.md", "x.md", "y.md"]);
  });

  it("bounds the merged traversal by an explicit depth", () => {
    const { documents, graph } = multiStartFixture();

    const result = getContextSlice(graph, documents, "REQ-1", 1, idRef);

    expect(result.visited).toEqual([
      { path: "mid.md", depth: 1, via: "y.md" },
      { path: "shared.md", depth: 1, via: "x.md" },
      { path: "x.md", depth: 0, via: null },
      { path: "y.md", depth: 0, via: null }
    ]);
    expect(result.files).toEqual(["mid.md", "shared.md", "x.md", "y.md"]);
  });

  it("defaults depth to 2 when omitted", () => {
    const { documents, graph } = multiStartFixture();

    const withDefault = getContextSlice(graph, documents, "REQ-1", undefined, idRef);
    const withExplicitTwo = getContextSlice(graph, documents, "REQ-1", 2, idRef);

    expect(withDefault).toEqual(withExplicitTwo);
  });
});

describe("SLICE_RESOLUTION_DESCRIPTION", () => {
  it("is exported and states exact-only semantics without promising fuzzy/keyword matching", () => {
    expect(typeof SLICE_RESOLUTION_DESCRIPTION).toBe("string");
    expect(SLICE_RESOLUTION_DESCRIPTION).toMatch(/exact/i);
    expect(SLICE_RESOLUTION_DESCRIPTION).toMatch(/no fuzzy/i);
  });
});
