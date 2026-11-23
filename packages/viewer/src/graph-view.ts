import type { ElementContent } from "hast";
import { h } from "hastscript";

import {
  compareStrings,
  query,
  type ContextGraph,
  type ParsedDocument,
} from "@wastech-mdlint/core";

import { documentHref, documentTitle } from "./render-document.js";

// What the link graph page draws: core's `ContextGraph`, cut down to one folder and shaped for a
// picture. Nothing here walks the graph on its own; a focused document's neighbors come from core's
// `query`, the traversal every other graph feature uses.

export type GraphViewNode = {
  path: string;
  title: string;
  href: string;
  // The node's color: the folder directly below the view's folder that holds the document, or the
  // view's folder itself for a document directly inside it. On the whole corpus that is the
  // top-level folder, so narrowing the view to a folder colors its subfolders apart.
  group: string;
  // Core's counts over the whole corpus, every edge counted. A document's weight in the repository
  // does not change because the view shows part of it.
  inDegree: number;
  outDegree: number;
};

// One per linked pair, whatever the number and kind of links between them: the picture draws one
// line either way, and three thousand parallel edges would cost the layout for nothing.
export type GraphViewEdge = { from: string; to: string };

export type GraphView = {
  // `""` is the whole corpus.
  folder: string;
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  // Set when a focused document is in the view: it and its neighbors in either direction stay lit.
  focus: { path: string; neighbors: string[] } | null;
};

// The group of a document directly in the repository root, on the whole-corpus view.
const ROOT_GROUP = "(root)";

/** Every folder that holds a corpus document, directly or further down, in code-point order. */
export function graphFolders(paths: Iterable<string>): string[] {
  const folders = new Set<string>();
  for (const relPath of paths) {
    const segments = relPath.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      folders.add(segments.slice(0, depth).join("/"));
    }
  }
  return [...folders].sort(compareStrings);
}

/**
 * The part of the graph inside `folder`. The caller checks that `folder` is `""` or one of
 * `graphFolders` and that `focus` is a document; an unknown name is a bad request, not an empty view.
 */
export function buildGraphView(
  graph: ContextGraph,
  documents: ReadonlyMap<string, ParsedDocument>,
  folder: string,
  focus: string | undefined,
): GraphView {
  const prefix = folder === "" ? "" : `${folder}/`;
  const nodes: GraphViewNode[] = graph.nodes
    .filter((node) => node.path.startsWith(prefix))
    .map((node) => {
      const document = documents.get(node.path);
      return {
        path: node.path,
        title: document === undefined ? node.path : documentTitle(document),
        href: documentHref(node.path),
        group: groupOf(node.path, folder),
        inDegree: node.inDegree,
        outDegree: node.outDegree,
      };
    })
    .sort((left, right) => compareStrings(left.path, right.path));
  const inView = new Set(nodes.map((node) => node.path));

  // Core sorts its edges by source, then target, so the pairs come out in that order too and a pair's
  // parallel edges are adjacent.
  const edges: GraphViewEdge[] = [];
  for (const edge of graph.edges) {
    const previous = edges.at(-1);
    if (
      inView.has(edge.from) &&
      inView.has(edge.to) &&
      (previous?.from !== edge.from || previous.to !== edge.to)
    ) {
      edges.push({ from: edge.from, to: edge.to });
    }
  }

  return {
    folder,
    nodes,
    edges,
    focus:
      focus !== undefined && inView.has(focus)
        ? {
            path: focus,
            neighbors: documentNeighbors(graph, focus).filter((path) =>
              inView.has(path),
            ),
          }
        : null,
  };
}

/**
 * The small graph beside a document: the document, the documents it links to and the ones linking
 * to it, and every link among them — so two neighbors that link to each other show it too. The
 * caller checks that `path` is a document.
 */
export function buildNeighborhoodView(
  graph: ContextGraph,
  documents: ReadonlyMap<string, ParsedDocument>,
  path: string,
): GraphView {
  const whole = buildGraphView(graph, documents, "", path);
  const kept = new Set([path, ...(whole.focus?.neighbors ?? [])]);
  return {
    ...whole,
    nodes: whole.nodes.filter((node) => kept.has(node.path)),
    edges: whole.edges.filter(
      (edge) => kept.has(edge.from) && kept.has(edge.to),
    ),
  };
}

/** The documents `path` links to or is linked from, each once, in code-point order. */
export function documentNeighbors(graph: ContextGraph, path: string): string[] {
  const neighbors = new Set<string>();
  for (const direction of ["forward", "reverse"] as const) {
    for (const visit of query(graph, { start: path, direction, depth: 1 })
      .visited) {
      if (visit.path !== path) {
        neighbors.add(visit.path);
      }
    }
  }
  return [...neighbors].sort(compareStrings);
}

/**
 * The graph page's article. The picture itself is drawn by the page script from `/api/graph`; what
 * is rendered here works without it: the folder picker as a plain GET form, and the documents in
 * view as a list of links — which is also the only form of the graph a keyboard or a screen reader
 * can use, since the picture is a canvas.
 *
 * `focus` is the document the request asked for, kept in the form even when the chosen folder leaves
 * it out of view, so going back to a folder that holds it lights it again.
 */
export function renderGraphArticle(
  view: GraphView,
  folders: readonly string[],
  focus: string | undefined,
): ElementContent[] {
  const summary = [
    `${plural(view.nodes.length, "document")}, ${plural(view.edges.length, "link")} between them.`,
  ];
  if (view.focus !== null) {
    summary.push(
      `${view.focus.path} is highlighted with ${plural(view.focus.neighbors.length, "neighbor")}.`,
    );
  } else if (focus !== undefined) {
    summary.push(`${focus} is not in this folder.`);
  }
  return [
    h("h1", "Link graph"),
    h("form.graph-controls", { action: "/graph", method: "get" }, [
      h("label", [
        "Folder ",
        h("select", { name: "folder" }, [
          h(
            "option",
            { value: "", selected: view.folder === "" },
            "All documents",
          ),
          ...folders.map((folder) =>
            h(
              "option",
              { value: folder, selected: folder === view.folder },
              folder,
            ),
          ),
        ]),
      ]),
      focus === undefined
        ? undefined
        : h("input", { type: "hidden", name: "focus", value: focus }),
      h("button", { type: "submit" }, "Show"),
    ]),
    h("p.graph-summary", summary.join(" ")),
    h("div.graph-canvas", { dataFolder: view.folder, dataFocus: focus }, [
      h(
        "p.graph-placeholder",
        "The picture is drawn by the page's script. The documents in this view are listed below.",
      ),
    ]),
    h("details.graph-list", [
      h("summary", `Documents in this view (${view.nodes.length})`),
      h(
        "ul",
        view.nodes.map((node) =>
          h("li", [
            h("a", { href: node.href }, node.title),
            " ",
            h("span.graph-list-path", node.path),
            " ",
            h(
              "span.graph-list-degree",
              `${node.inDegree} in · ${node.outDegree} out`,
            ),
          ]),
        ),
      ),
    ]),
  ];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function groupOf(relPath: string, folder: string): string {
  const prefix = folder === "" ? "" : `${folder}/`;
  const rest = relPath.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) {
    return folder === "" ? ROOT_GROUP : folder;
  }
  return `${prefix}${rest.slice(0, slash)}`;
}
