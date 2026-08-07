import { compareStrings } from "../deterministic-sort.js";
import type { GraphCoverage } from "./coverage.js";
import type {
  ContextGraph,
  ContextGraphEdge,
  ContextGraphNode,
} from "./context-graph-types.js";
import {
  formatContextGraphSummary,
  getComponents,
  topologicalSort,
} from "./graph-algorithms.js";
import type { ImpactClassification } from "./impact-analysis.js";
import type { ContextSliceResult } from "./search-index.js";

// Deterministic renderers over a `ContextGraph`, shared by the CLI `graph` command and the MCP
// `summary` fields. All traversal/analysis is delegated to the algorithm modules — this file
// only projects their outputs into JSON-shaped structs or byte-stable text, so hosts never duplicate
// graph logic (core-hosts-the-pipeline decision).

const byPath = compareStrings;

function compareEdges(left: ContextGraphEdge, right: ContextGraphEdge): number {
  return (
    byPath(left.from, right.from) ||
    byPath(left.to, right.to) ||
    compareStrings(left.type, right.type) ||
    (left.line ?? 0) - (right.line ?? 0)
  );
}

export type ContextGraphSummary = {
  nodes: ContextGraphNode[];
  edges: ContextGraphEdge[];
  components: string[][];
  readingOrder: string[];
  // The nodes a cycle kept out of `readingOrder`. Always present, never optional: it is the
  // same field name and `string[]` shape `ImpactClassification.excluded` already ships, and a
  // machine consumer that had to derive it as `nodes` minus `readingOrder` was the defect — at 43 of
  // 139 nodes on the large-corpus fixture, the omission reads as a silently truncated reading order.
  // The human renderer drops the section when it is empty (a report for a reader omits empty
  // sections); a machine contract must not drop a key, so this side of the parity always carries it.
  excluded: string[];
  // Coverage: included only when the host supplies it. Both the CLI `graph` command and the MCP
  // `context-graph` tool's `summary` branch do — but a caller that summarizes a bare graph without
  // disk access can still omit it, so it stays optional.
  coverage?: GraphCoverage;
};

// The shipped JSON key set is `{ nodes, edges, components, readingOrder, excluded, coverage? }`.
// It mirrors `renderContextGraphText`'s optional-coverage parameter so both formats expose the same
// signals — a key present in one and absent from the other is the drift this pairing exists to
// prevent. `components`/`readingOrder`/`excluded` reuse the algorithm modules verbatim rather than
// recomputing clusters/order here.
export function summarizeContextGraph(
  graph: ContextGraph,
  coverage?: GraphCoverage,
): ContextGraphSummary {
  // One `topologicalSort` call for both halves of the order: the excluded set is a byproduct of the
  // same Kahn pass, so reading `.order` and `.excluded` from separate calls would sort twice.
  const { order, excluded } = topologicalSort(graph);

  return {
    nodes: [...graph.nodes].sort((left, right) =>
      byPath(left.path, right.path),
    ),
    edges: [...graph.edges].sort(compareEdges),
    components: getComponents(graph),
    readingOrder: order,
    excluded,
    ...(coverage !== undefined ? { coverage } : {}),
  };
}

// Every path-bearing section of the human format is a `header (count):` line followed by one
// indented item per line — the shape `top hubs` and `files (N):` already had, and now the shape all
// of them have. Comma-joining produced 3500–3900-character single lines on a 139-node graph
// and left the format internally inconsistent, three sections line-oriented and three not.
function pushPathList(
  lines: string[],
  label: string,
  items: readonly string[],
  indent = "  ",
): void {
  lines.push(`${label} (${items.length}):`);
  for (const item of items) {
    lines.push(`${indent}${item}`);
  }
}

// `renderContextGraphText` builds on `formatContextGraphSummary` (nodes/edges/cycles/entry
// points/hubs) rather than re-deriving those fields, then appends the three signals that summary
// does not already cover: clusters, reading order, and (optionally) coverage.
export function renderContextGraphText(
  graph: ContextGraph,
  coverage?: GraphCoverage,
): string {
  const lines = [formatContextGraphSummary(graph)];

  // Clusters nest one level deeper than the other sections because a component is itself a list:
  // flattening the members under a single `clusters:` header would lose the boundary between one
  // component and the next, which is the only information the section carries.
  const components = getComponents(graph);
  lines.push("clusters:");
  components.forEach((component, index) => {
    // "(N files)" rather than the bare "(N)" the other sections use: next to an ordinal the bare
    // count reads like a second index.
    lines.push(`  cluster ${index + 1} (${component.length} files):`);
    for (const member of component) {
      lines.push(`    ${member}`);
    }
  });

  const { order, excluded } = topologicalSort(graph);
  pushPathList(lines, "reading order", order);
  if (excluded.length > 0) {
    pushPathList(lines, "excluded from reading order", excluded);
  }

  if (coverage !== undefined) {
    lines.push("coverage:");
    lines.push(`  nodes: ${coverage.nodeCount}`);
    lines.push(`  edges: ${coverage.edgeCount}`);
    // This was comma-joined too. Coverage looked "correctly line-oriented" only because the corpus
    // it was measured on had just 12 files outside the graph; the unbounded-line defect is the same
    // one as everywhere else here, and the no-line-exceeds-a-stated-width rule is unconditional.
    pushPathList(
      lines,
      "  files outside corpus",
      coverage.filesOutsideCorpus,
      "    ",
    );
  }

  return lines.join("\n");
}

// Node ids are assigned by sorted-path index (`n0`, `n1`, …), never derived from the path itself:
// sanitizing a path into an id risks collisions (e.g. "a/b.md" and "a-b.md" both sanitizing to
// "a-b-md"), which would silently merge two distinct files in the rendered diagram. The path stays
// the human-readable label instead.
function buildNodeIdMap(graph: ContextGraph): Map<string, string> {
  const sortedPaths = graph.nodes.map((node) => node.path).sort(byPath);
  const idByPath = new Map<string, string>();
  sortedPaths.forEach((nodePath, index) => idByPath.set(nodePath, `n${index}`));
  return idByPath;
}

// `buildContextGraph` never materializes an edge to a node outside `graph.nodes` (architecture
// invariant, see coverage.ts), so every edge endpoint is guaranteed to be in `idByPath`. Looking this
// up as a checked throw (rather than a non-null assertion) keeps that invariant enforced loudly if a
// future caller ever hands the renderer a hand-built, inconsistent graph.
function requireNodeId(
  idByPath: Map<string, string>,
  nodePath: string,
): string {
  const id = idByPath.get(nodePath);
  if (id === undefined) {
    throw new Error(
      `Context graph edge references a node missing from graph.nodes: "${nodePath}"`,
    );
  }
  return id;
}

function escapeMermaidLabel(label: string): string {
  return label.replaceAll("\\", "\\\\").replaceAll('"', "&quot;");
}

export function renderContextGraphMermaid(graph: ContextGraph): string {
  const idByPath = buildNodeIdMap(graph);
  const lines = ["flowchart TD"];

  for (const [nodePath, id] of [...idByPath.entries()].sort((left, right) =>
    byPath(left[0], right[0]),
  )) {
    lines.push(`  ${id}["${escapeMermaidLabel(nodePath)}"]`);
  }

  for (const edge of [...graph.edges].sort(compareEdges)) {
    const fromId = requireNodeId(idByPath, edge.from);
    const toId = requireNodeId(idByPath, edge.to);
    lines.push(`  ${fromId} -->|${edge.type}| ${toId}`);
  }

  return lines.join("\n");
}

function escapeDotLabel(label: string): string {
  return label.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function renderContextGraphDot(graph: ContextGraph): string {
  const idByPath = buildNodeIdMap(graph);
  const lines = ["digraph ContextGraph {"];

  for (const [nodePath, id] of [...idByPath.entries()].sort((left, right) =>
    byPath(left[0], right[0]),
  )) {
    lines.push(`  ${id} [label="${escapeDotLabel(nodePath)}"];`);
  }

  for (const edge of [...graph.edges].sort(compareEdges)) {
    const fromId = requireNodeId(idByPath, edge.from);
    const toId = requireNodeId(idByPath, edge.to);
    lines.push(
      `  ${fromId} -> ${toId} [label="${escapeDotLabel(edge.type)}"];`,
    );
  }

  lines.push("}");
  return lines.join("\n");
}

export function renderContextSliceSummary(result: ContextSliceResult): string {
  if (result.matchKind === null) {
    return `No match for query "${result.query}".`;
  }

  // `starts` is not a one-element list: an `#anchor`, heading, or ID query resolves to *every* file
  // carrying that slug, so comma-joining it produces the same multi-KB single line, in the same
  // file as the renderers that shed it. Line-oriented here too, for the same reason.
  const lines = [`query: ${result.query}`, `matched: ${result.matchKind}`];
  pushPathList(lines, "starts", result.starts);
  pushPathList(lines, "files", result.files);

  return lines.join("\n");
}

export function renderImpactSummary(result: ImpactClassification): string {
  const lines = [
    `changed file: ${result.file}`,
    `directly affected (${result.directlyAffected.length}):`,
  ];
  for (const entry of result.directlyAffected) {
    lines.push(
      `  ${entry.path} (${entry.references} reference${entry.references === 1 ? "" : "s"})`,
    );
  }

  lines.push(`transitively affected (${result.transitivelyAffected.length}):`);
  for (const entry of result.transitivelyAffected) {
    lines.push(`  ${entry.path} (depth ${entry.depth}, via ${entry.via})`);
  }

  // The same comma-joined pair `renderContextGraphText` had, on a subgraph that can be the whole
  // corpus when the changed file is a hub. Fixing three of the four instances of one defect would
  // leave one renderer inconsistent with the other three, so `impact --format text` moves with them.
  pushPathList(lines, "reading order", result.readingOrder);
  if (result.excluded.length > 0) {
    pushPathList(lines, "excluded from reading order", result.excluded);
  }

  return lines.join("\n");
}
