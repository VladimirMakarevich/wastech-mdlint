import { describe, expect, it } from "vitest";

import { extractDocProfile } from "../src/compile/doc-profile.js";
import { buildContextGraph } from "../src/graph/build-context-graph.js";
import type { BuildContextGraphOptions } from "../src/graph/context-graph-types.js";
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

describe("extractDocProfile", () => {
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

    expect(
      extractDocProfile(getDocument(documents, "profile.md"), graph),
    ).toEqual({
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
      extractDocProfile(
        getDocument(mixedWidths.documents, "mixed-widths.md"),
        mixedWidths.graph,
      ).idPattern,
    ).toBeUndefined();
    expect(
      extractDocProfile(
        getDocument(mixedPrefixes.documents, "mixed-prefixes.md"),
        mixedPrefixes.graph,
      ).idPattern,
    ).toBeUndefined();
  });

  it("uses the semantic graph edges for outgoing and incoming references", () => {
    const { documents, graph } = contextOf(
      {
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
      },
      {
        idRef: {
          idPattern: "^REQ-\\d+$",
          definitions: ["defs.md"],
          idColumn: "ID",
        },
      },
    );

    expect(
      extractDocProfile(getDocument(documents, "consumer.md"), graph),
    ).toEqual({
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
          line: 2,
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
          line: 1,
          rawTarget: "@consumer.md",
        },
      ],
    });
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

    expect(extractDocProfile(bridge, graph).role).toBe("hub");
    expect(extractDocProfile(bridge, graph, { hubMinInDegree: 4 }).role).toBe(
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

    expect(extractDocProfile(document, graph)).toEqual(
      extractDocProfile(document, graph),
    );
  });
});
