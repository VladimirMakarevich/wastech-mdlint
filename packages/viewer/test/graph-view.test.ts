import { toHtml } from "hast-util-to-html";
import { describe, expect, it } from "vitest";

import {
  buildContextGraph,
  parseDocument,
  type ParsedDocument,
} from "@wastech-mdlint/core";

import {
  buildGraphView,
  buildNeighborhoodView,
  documentNeighbors,
  graphFolders,
  renderGraphArticle,
} from "../src/graph-view.js";

// Built through core's own parser and graph builder, so the edges are the ones a real corpus would
// produce — including the link and the anchor edge core keeps side by side for one pair.
const documents = new Map<string, ParsedDocument>(
  Object.entries({
    "README.md":
      "# Home\n\n[guide](docs/guide.md) and [its setup](docs/guide.md#setup)\n",
    "docs/guide.md": "# Guide\n\n## Setup\n\n[reference](api/reference.md)\n",
    "docs/api/reference.md": "# Reference\n\n[back](../guide.md)\n",
    "docs/api/deep/notes.md": "# Notes\n\n[home](../../../README.md)\n",
    "docs/apiary.md": "# Apiary\n",
    "notes/todo.md": "# Todo \\<script\\> & more\n",
  }).map(([path, content]) => [path, parseDocument({ path, content })]),
);
const graph = buildContextGraph(documents, {});

describe("graphFolders", () => {
  it("lists every folder holding a document, nested ones too, in code-point order", () => {
    expect(graphFolders(documents.keys())).toEqual([
      "docs",
      "docs/api",
      "docs/api/deep",
      "notes",
    ]);
  });
});

describe("buildGraphView", () => {
  it("draws one line per linked pair, however many links core records between them", () => {
    const coreEdges = graph.edges.filter(
      (edge) => edge.from === "README.md" && edge.to === "docs/guide.md",
    );
    expect(coreEdges.map((edge) => edge.type).sort()).toEqual([
      "anchor",
      "link",
    ]);
    expect(buildGraphView(graph, documents, "", undefined).edges).toEqual([
      { from: "README.md", to: "docs/guide.md" },
      { from: "docs/api/deep/notes.md", to: "README.md" },
      { from: "docs/api/reference.md", to: "docs/guide.md" },
      { from: "docs/guide.md", to: "docs/api/reference.md" },
    ]);
  });

  it("colors the whole corpus by top-level folder, and a folder by its subfolders", () => {
    const groups = (folder: string) =>
      Object.fromEntries(
        buildGraphView(graph, documents, folder, undefined).nodes.map(
          (node) => [node.path, node.group],
        ),
      );
    expect(groups("")).toEqual({
      "README.md": "(root)",
      "docs/api/deep/notes.md": "docs",
      "docs/api/reference.md": "docs",
      "docs/apiary.md": "docs",
      "docs/guide.md": "docs",
      "notes/todo.md": "notes",
    });
    expect(groups("docs")).toEqual({
      "docs/api/deep/notes.md": "docs/api",
      "docs/api/reference.md": "docs/api",
      "docs/apiary.md": "docs",
      "docs/guide.md": "docs",
    });
  });

  // `docs/apiary.md` starts with the characters `docs/api` but is not inside that folder.
  it("keeps a folder's documents and only the links between them", () => {
    const view = buildGraphView(graph, documents, "docs/api", undefined);
    expect(view.nodes.map((node) => node.path)).toEqual([
      "docs/api/deep/notes.md",
      "docs/api/reference.md",
    ]);
    expect(view.edges).toEqual([]);
  });

  // A hub stays a hub when the view shows only part of the corpus.
  it("keeps core's whole-corpus counts on each node", () => {
    const guide = buildGraphView(
      graph,
      documents,
      "docs",
      undefined,
    ).nodes.find((node) => node.path === "docs/guide.md");
    const coreGuide = graph.nodes.find((node) => node.path === "docs/guide.md");
    expect(guide).toMatchObject({
      title: "Guide",
      href: "/doc/docs/guide.md",
      inDegree: coreGuide?.inDegree,
      outDegree: coreGuide?.outDegree,
    });
    expect(coreGuide?.inDegree).toBe(3);
  });

  it("lights a focused document's neighbors in both directions, within the view", () => {
    expect(buildGraphView(graph, documents, "", "docs/guide.md").focus).toEqual(
      {
        path: "docs/guide.md",
        neighbors: ["README.md", "docs/api/reference.md"],
      },
    );
    expect(
      buildGraphView(graph, documents, "docs", "docs/guide.md").focus,
    ).toEqual({
      path: "docs/guide.md",
      neighbors: ["docs/api/reference.md"],
    });
    expect(
      buildGraphView(graph, documents, "notes", "docs/guide.md").focus,
    ).toBeNull();
  });
});

describe("buildNeighborhoodView", () => {
  // `a` links to `b` and `c`, `b` links to `c`, and `d` links only to `b`. Around `a`: `b` and `c`,
  // the link between them, and nothing of `d`, which is two steps away.
  const small = new Map<string, ParsedDocument>(
    Object.entries({
      "a.md": "# A\n\n[b](b.md) [c](c.md)\n",
      "b.md": "# B\n\n[c](c.md)\n",
      "c.md": "# C\n",
      "d.md": "# D\n\n[b](b.md)\n",
    }).map(([path, content]) => [path, parseDocument({ path, content })]),
  );
  const smallGraph = buildContextGraph(small, {});

  it("keeps a document, its direct neighbors and every link among them", () => {
    const view = buildNeighborhoodView(smallGraph, small, "a.md");
    expect(view.nodes.map((node) => node.path)).toEqual([
      "a.md",
      "b.md",
      "c.md",
    ]);
    expect(view.edges).toEqual([
      { from: "a.md", to: "b.md" },
      { from: "a.md", to: "c.md" },
      { from: "b.md", to: "c.md" },
    ]);
    expect(view.focus).toEqual({ path: "a.md", neighbors: ["b.md", "c.md"] });
  });

  it("counts neighbors in both directions, each once", () => {
    expect(documentNeighbors(smallGraph, "b.md")).toEqual([
      "a.md",
      "c.md",
      "d.md",
    ]);
    expect(documentNeighbors(graph, "docs/guide.md")).toEqual([
      "README.md",
      "docs/api/reference.md",
    ]);
  });
});

describe("renderGraphArticle", () => {
  function article(folder: string, focus: string | undefined): string {
    return toHtml(
      {
        type: "root",
        children: renderGraphArticle(
          buildGraphView(graph, documents, folder, focus),
          graphFolders(documents.keys()),
          focus,
        ),
      },
      { allowDangerousHtml: true },
    );
  }

  it("lists the documents in view as links, with titles escaped", () => {
    const html = article("", undefined);
    expect(html).toContain(
      '<a href="/doc/notes/todo.md">Todo &#x3C;script> &#x26; more</a>',
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("6 documents, 4 links between them.");
  });

  it("marks the chosen folder and carries the focus through the form", () => {
    const html = article("docs", "README.md");
    expect(html).toContain('<option value="docs" selected>docs</option>');
    expect(html).toContain(
      '<input type="hidden" name="focus" value="README.md">',
    );
    expect(html).toContain('data-folder="docs" data-focus="README.md"');
    expect(html).toContain("README.md is not in this folder.");
  });

  it("says how many neighbors a focused document has", () => {
    expect(article("", "docs/guide.md")).toContain(
      "docs/guide.md is highlighted with 2 neighbors.",
    );
  });
});
