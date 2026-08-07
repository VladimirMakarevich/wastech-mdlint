import { describe, expect, it } from "vitest";

import { extractDocProfiles } from "../src/compile/doc-profile.js";
import type { DocumentProfile } from "../src/compile/doc-profile.js";
import type { GraphAnalysisOptions } from "../src/compile/graph-analysis.js";
import { buildContextGraph } from "../src/graph/build-context-graph.js";
import type {
  BuildContextGraphOptions,
  ContextGraph,
  ContextGraphEdge,
} from "../src/graph/context-graph-types.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { parseDocument } from "../src/markdown/parse-document.js";

function contextOf(
  entries: Record<string, string>,
  options: BuildContextGraphOptions = {},
) {
  const documents = new Map<string, ParsedDocument>();

  for (const [filePath, content] of Object.entries(entries)) {
    documents.set(filePath, parseDocument({ path: filePath, content }));
  }

  return { documents, graph: buildContextGraph(documents, options) };
}

function getDocument(
  documents: Map<string, ParsedDocument>,
  filePath: string,
): ParsedDocument {
  const document = documents.get(filePath);

  if (document === undefined) {
    throw new Error(`Missing test document "${filePath}".`);
  }

  return document;
}

// One-element call through the single entry point, so the single-document assertions below read as
// assertions rather than as map plumbing. The `extractDocProfile` wrapper this used to
// call: it sat on the barrel with no caller in either host.
function profileOne(
  document: ParsedDocument,
  graph: ContextGraph,
  options: GraphAnalysisOptions = {},
): DocumentProfile {
  const profile = extractDocProfiles([document], graph, options).get(
    document.path,
  );

  if (profile === undefined) {
    throw new Error(`Missing profile for "${document.path}".`);
  }

  return profile;
}

// Shared between the single-document and corpus describes so the pinned profile literal exists in
// exactly one place: both go through the same `buildProfile`, so asserting the corpus result against
// the single one alone would not catch a shared bug.
const REFERENCE_ENTRIES: Record<string, string> = {
  "consumer.md": [
    "# Usage",
    "See [goal](target.md#goal).",
    "@shared.md",
    "Blocks REQ-001.",
    "",
  ].join("\n"),
  "defs.md": [
    "# Requirements",
    "",
    "| ID | Summary |",
    "| --- | --- |",
    "| REQ-001 | Stable |",
    "",
  ].join("\n"),
  "inbound.md": [
    "[consumer section](consumer.md#usage)",
    "@consumer.md",
    "",
  ].join("\n"),
  "shared.md": "# Shared\n",
  "target.md": "# Goal\n",
};

const REFERENCE_OPTIONS: BuildContextGraphOptions = {
  idRef: {
    idPattern: "^REQ-\\d+$",
    definitions: ["defs.md"],
    idColumn: "ID",
  },
};

const EXPECTED_CONSUMER_PROFILE = {
  role: "bridge",
  outline: [{ text: "Usage", depth: 1, slug: "usage", line: 1 }],
  tableSchemas: [],
  idPattern: undefined,
  referencesTo: [
    {
      from: "consumer.md",
      to: "defs.md",
      type: "id-ref",
      line: 4,
      rawTarget: "REQ-001",
    },
    {
      from: "consumer.md",
      to: "shared.md",
      type: "import",
      line: 3,
      rawTarget: "@shared.md",
    },
    {
      from: "consumer.md",
      to: "target.md",
      type: "anchor",
      line: 2,
      text: "goal",
      rawTarget: "target.md#goal",
    },
  ],
  referencedBy: [
    {
      from: "inbound.md",
      to: "consumer.md",
      type: "anchor",
      line: 1,
      text: "consumer section",
      rawTarget: "consumer.md#usage",
    },
    {
      from: "inbound.md",
      to: "consumer.md",
      type: "import",
      line: 2,
      rawTarget: "@consumer.md",
    },
  ],
};

describe("extractDocProfiles · one document", () => {
  it("projects outline and table schemas in source order and detects one table ID family", () => {
    const { documents, graph } = contextOf({
      "profile.md": [
        "# Overview",
        "",
        "| ID | Name |",
        "| --- | --- |",
        "| REQ-001 | One |",
        "| REQ-002 | Two |",
        "",
        "## Details",
        "",
        "| Owner | Status |",
        "| --- | --- |",
        "| team-a | Draft |",
        "",
      ].join("\n"),
    });

    expect(profileOne(getDocument(documents, "profile.md"), graph)).toEqual({
      role: "isolated",
      outline: [
        { text: "Overview", depth: 1, slug: "overview", line: 1 },
        { text: "Details", depth: 2, slug: "details", line: 8 },
      ],
      tableSchemas: [
        { headers: ["ID", "Name"], section: "Overview", line: 3 },
        { headers: ["Owner", "Status"], section: "Details", line: 10 },
      ],
      idPattern: "REQ-NNN",
      referencesTo: [],
      referencedBy: [],
    });
  });

  it("returns no document-wide pattern when table IDs mix widths or prefixes", () => {
    const mixedWidths = contextOf({
      "mixed-widths.md": [
        "| ID |",
        "| --- |",
        "| REQ-001 |",
        "| REQ-02 |",
        "",
      ].join("\n"),
    });
    const mixedPrefixes = contextOf({
      "mixed-prefixes.md": [
        "| ID |",
        "| --- |",
        "| REQ-001 |",
        "| ADR-001 |",
        "",
      ].join("\n"),
    });

    expect(
      profileOne(
        getDocument(mixedWidths.documents, "mixed-widths.md"),
        mixedWidths.graph,
      ).idPattern,
    ).toBeUndefined();
    expect(
      profileOne(
        getDocument(mixedPrefixes.documents, "mixed-prefixes.md"),
        mixedPrefixes.graph,
      ).idPattern,
    ).toBeUndefined();
  });

  it("uses the semantic graph edges for outgoing and incoming references", () => {
    const { documents, graph } = contextOf(
      REFERENCE_ENTRIES,
      REFERENCE_OPTIONS,
    );

    expect(profileOne(getDocument(documents, "consumer.md"), graph)).toEqual(
      EXPECTED_CONSUMER_PROFILE,
    );
  });

  it("threads the hub threshold through role lookup instead of hard-coding the default", () => {
    const { documents, graph } = contextOf({
      "a.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "b.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "bridge.md": "[sink](sink.md)\n",
      "c.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "leaf.md": "# Leaf\n",
      "sink.md": "# Sink\n",
    });
    const bridge = getDocument(documents, "bridge.md");

    expect(profileOne(bridge, graph).role).toBe("hub");
    expect(profileOne(bridge, graph, { hubMinInDegree: 4 }).role).toBe(
      "bridge",
    );
  });

  it("returns the same profile across repeated calls", () => {
    const { documents, graph } = contextOf({
      "a.md": [
        "# A",
        "",
        "| ID |",
        "| --- |",
        "| REQ-001 |",
        "",
        "[B](b.md)",
        "",
      ].join("\n"),
      "b.md": "# B\n",
    });
    const document = getDocument(documents, "a.md");

    expect(profileOne(document, graph)).toEqual(profileOne(document, graph));
  });
});

// One index per call is what makes a corpus affordable, and it is also the one thing
// that can go wrong: the index's edge buckets are shared across a batch, so a profile handing one
// out directly would alias another document's list. These assertions are that guard — a whole-corpus
// call must produce exactly what one-document calls produce, edge order included.
describe("extractDocProfiles · corpus", () => {
  it("produces the same pinned profile as a one-document call, edge order included", () => {
    const { documents, graph } = contextOf(
      REFERENCE_ENTRIES,
      REFERENCE_OPTIONS,
    );

    const profiles = extractDocProfiles(documents.values(), graph);

    expect(profiles.get("consumer.md")).toEqual(EXPECTED_CONSUMER_PROFILE);
  });

  it("matches a map built one document at a time across the whole corpus", () => {
    const { documents, graph } = contextOf(
      REFERENCE_ENTRIES,
      REFERENCE_OPTIONS,
    );

    const batch = extractDocProfiles(documents.values(), graph);
    const individual = new Map(
      [...documents.values()].map((document) => [
        document.path,
        profileOne(document, graph),
      ]),
    );

    expect([...batch.keys()].sort()).toEqual([...individual.keys()].sort());
    expect(batch).toEqual(individual);
  });

  it("threads the hub threshold through the batch path", () => {
    const { documents, graph } = contextOf({
      "a.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "b.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "bridge.md": "[sink](sink.md)\n",
      "c.md": "[bridge](bridge.md)\n[leaf](leaf.md)\n",
      "leaf.md": "# Leaf\n",
      "sink.md": "# Sink\n",
    });

    expect(
      extractDocProfiles(documents.values(), graph).get("bridge.md")?.role,
    ).toBe("hub");
    expect(
      extractDocProfiles(documents.values(), graph, { hubMinInDegree: 4 }).get(
        "bridge.md",
      )?.role,
    ).toBe("bridge");
  });

  it("lists a self-edge as both an outgoing and an incoming reference", () => {
    // `buildContextGraph` never emits a self-edge, but the two `filter` passes this replaced would
    // have counted one on both sides — a hand-built graph pins that the single pass still does.
    const document = parseDocument({ path: "self.md", content: "# Self\n" });
    const selfEdge: ContextGraphEdge = {
      from: "self.md",
      to: "self.md",
      type: "link",
      line: 1,
    };
    const graph: ContextGraph = {
      nodes: [{ path: "self.md", inDegree: 1, outDegree: 1 }],
      edges: [selfEdge],
      cycles: [],
    };

    const profile = extractDocProfiles([document], graph).get("self.md");

    expect(profile?.referencesTo).toEqual([selfEdge]);
    expect(profile?.referencedBy).toEqual([selfEdge]);
    // Buckets are shared inside the index, so each profile must receive its own copies.
    expect(profile?.referencesTo[0]).not.toBe(selfEdge);
    expect(profile?.referencesTo).not.toBe(profile?.referencedBy);
  });

  it("throws for a document that is absent from the graph nodes", () => {
    const { graph } = contextOf({ "a.md": "# A\n" });
    const absent = parseDocument({ path: "missing.md", content: "# M\n" });

    expect(() => extractDocProfiles([absent], graph)).toThrow(
      'Cannot extract profile for "missing.md": document is not present in the graph.',
    );
  });
});
