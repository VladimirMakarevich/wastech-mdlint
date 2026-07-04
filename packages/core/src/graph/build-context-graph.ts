import path from "node:path";

import { normalizeRelativePath } from "../discovery/globs.js";
import { extractDefinedIds, type IdRef } from "../engine/defined-ids.js";
import { filePart, resolveRelativeToSource, sourceLocale } from "../engine/path-resolve.js";
import { compileRegex } from "../engine/regex.js";
import { resolveRoutedUrl } from "../engine/site-router.js";
import { findLineNumber } from "../engine/text-position.js";
import type { SiteRouterSettings } from "../engine/types.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import type {
  BuildContextGraphOptions,
  ContextGraph,
  ContextGraphEdge,
  ContextGraphNode
} from "./context-graph-types.js";

// P4.01 semantic ContextGraph builder (G1/G3). Extends the P3.06 "relocated legacy builder" (link
// edges only, deduped by (from,to)) into the full taxonomy — link/anchor/image/import/id-ref, one
// edge per source construct, multiplicity retained (dedup+count is G7 backlog). The read shape
// (`path`/`from`/`to`/`inDegree`/`outDegree`/`cycles`) stays frozen so GRP-001/002 are unaffected.

// Resolve a link/image/import target to a corpus node path, mirroring REF-001/002 resolution
// exactly (relative → source dir; root-relative → site router, else strip leading `/` from root) so
// graph edges never disagree with the REF rules on router/root-relative repos. Undefined when the
// target is not (or does not resolve to) a node in the corpus — non-corpus and missing targets are
// skipped per the taxonomy (audit 2.5).
function resolveTarget(
  sourcePath: string,
  target: string,
  siteRouter: SiteRouterSettings | undefined,
  nodeSet: ReadonlySet<string>
): string | undefined {
  if (target.length === 0) {
    return undefined;
  }

  if (!target.startsWith("/")) {
    const relTarget = resolveRelativeToSource(sourcePath, target);
    return nodeSet.has(relTarget) ? relTarget : undefined;
  }

  if (siteRouter !== undefined) {
    for (const candidate of resolveRoutedUrl(target, siteRouter, sourceLocale(sourcePath, siteRouter))) {
      const normalized = normalizeRelativePath(candidate);
      if (nodeSet.has(normalized)) {
        return normalized;
      }
    }
    return undefined;
  }

  const relTarget = normalizeRelativePath(path.posix.normalize(target.replace(/^\/+/, "")));
  return nodeSet.has(relTarget) ? relTarget : undefined;
}

// Scheme-qualified targets (http:, https:, data:, …) are never corpus nodes; skip before resolving,
// matching REF-003's imageResolves guard.
function hasScheme(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

// Token run used to scan document prose for id-ref occurrences (Decision 2): the same
// `[\s,]+`-splitting model as `defined-ids.ts`'s column tokenizer, applied to free text instead of a
// table cell so a plain-text ID mention (no Markdown link) still yields a graph edge (G1).
const PROSE_TOKEN_PATTERN = /[^\s,]+/g;

// id-ref edges (G1): definitions come from `extractDefinedIds` (column + heading discovery, audit
// 2.1/5.5); references are discovered by scanning each document's prose for tokens equal to a
// defined ID whose definer is a *different* document.
function buildIdRefEdges(
  documents: Map<string, ParsedDocument>,
  nodeSet: ReadonlySet<string>,
  idRef: IdRef
): ContextGraphEdge[] {
  const definers = new Map<string, string[]>();
  for (const document of documents.values()) {
    for (const occurrence of extractDefinedIds(document, idRef)) {
      const existing = definers.get(occurrence.id);
      if (existing === undefined) {
        definers.set(occurrence.id, [document.path]);
      } else if (!existing.includes(document.path)) {
        existing.push(document.path);
      }
    }
  }
  for (const definingPaths of definers.values()) {
    definingPaths.sort((left, right) => left.localeCompare(right));
  }

  const idPattern = compileRegex(idRef.idPattern);
  const edges: ContextGraphEdge[] = [];

  for (const document of documents.values()) {
    for (const match of document.content.matchAll(PROSE_TOKEN_PATTERN)) {
      const token = match[0];
      if (!idPattern.test(token)) {
        continue;
      }
      const definingPaths = definers.get(token);
      if (definingPaths === undefined) {
        continue;
      }
      const line = findLineNumber(document.content, match.index);
      for (const definingPath of definingPaths) {
        if (definingPath === document.path || !nodeSet.has(definingPath)) {
          continue;
        }
        edges.push({ from: document.path, to: definingPath, type: "id-ref", line, rawTarget: token });
      }
    }
  }

  return edges;
}

// Build the deterministic adjacency-free graph: nodes (with in/out degree), semantic edges typed
// per the taxonomy, and the explicit cycle list (G6).
export function buildContextGraph(
  documents: Map<string, ParsedDocument>,
  options: BuildContextGraphOptions = {}
): ContextGraph {
  // Node identity is `document.path` (repo-relative POSIX), never the caller's Map key: loadDocuments()
  // keys by absolute path and only some callers re-key before reaching here. Re-keying by `document.path`
  // makes node identity == edge identity regardless of how the input Map was keyed.
  const documentsByPath = new Map<string, ParsedDocument>();
  for (const document of documents.values()) {
    documentsByPath.set(document.path, document);
  }
  const nodePaths = [...documentsByPath.keys()].sort((left, right) => left.localeCompare(right));
  const nodeSet = new Set(nodePaths);
  const { siteRouter } = options;

  // One edge per source construct — no (from,to) dedup (task constraint; G7 collapses this later).
  const edges: ContextGraphEdge[] = [];

  for (const document of documentsByPath.values()) {
    for (const link of document.links) {
      if (link.kind !== "local-file") {
        continue;
      }
      const target = resolveTarget(document.path, filePart(link.rawTarget), siteRouter, nodeSet);
      if (target === undefined || target === document.path) {
        continue;
      }
      const hasFragment = link.anchor !== undefined && link.anchor.length > 0;
      if (hasFragment) {
        // anchor = heading-slug match (AC): a fragment to a target file with no matching heading slug
        // is skipped entirely, not downgraded to a plain `link` edge.
        const targetDocument = documentsByPath.get(target)!;
        if (!targetDocument.headings.some((heading) => heading.slug === link.anchor)) {
          continue;
        }
      }
      edges.push({
        from: document.path,
        to: target,
        type: hasFragment ? "anchor" : "link",
        line: link.line,
        text: link.text,
        rawTarget: link.rawTarget
      });
    }

    for (const image of document.images) {
      const imageTarget = filePart(image.rawTarget);
      if (imageTarget.length === 0 || hasScheme(imageTarget)) {
        continue;
      }
      const target = resolveTarget(document.path, imageTarget, siteRouter, nodeSet);
      if (target === undefined || target === document.path) {
        continue;
      }
      edges.push({ from: document.path, to: target, type: "image", line: image.line, rawTarget: image.rawTarget });
    }

    for (const importRecord of document.imports) {
      // `rawTarget` is `@path.md` / `@/path.md` (D3); drop the leading `@` and resolve like a link.
      const target = resolveTarget(document.path, importRecord.rawTarget.slice(1), siteRouter, nodeSet);
      if (target === undefined || target === document.path) {
        continue;
      }
      edges.push({
        from: document.path,
        to: target,
        type: "import",
        line: importRecord.line,
        rawTarget: importRecord.rawTarget
      });
    }
  }

  if (options.idRef !== undefined) {
    edges.push(...buildIdRefEdges(documentsByPath, nodeSet, options.idRef));
  }

  // Deterministic ordering: from, then to, then type, then line so parallel edges between the same
  // pair (multiplicity retained) still sort stably regardless of construct-scan order.
  edges.sort(
    (left, right) =>
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to) ||
      left.type.localeCompare(right.type) ||
      (left.line ?? 0) - (right.line ?? 0)
  );

  const inDegree = new Map(nodePaths.map((nodePath) => [nodePath, 0]));
  const outDegree = new Map(nodePaths.map((nodePath) => [nodePath, 0]));
  for (const edge of edges) {
    outDegree.set(edge.from, (outDegree.get(edge.from) ?? 0) + 1);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const nodes: ContextGraphNode[] = nodePaths.map((nodePath) => ({
    path: nodePath,
    inDegree: inDegree.get(nodePath) ?? 0,
    outDegree: outDegree.get(nodePath) ?? 0
  }));

  return { nodes, edges, cycles: detectCycles(nodePaths, edges) };
}

// Tarjan SCC → components of size > 1 are cycles (G6); a representative cycle path is extracted per
// component and canonicalized (rotated to its lexicographically smallest start) for stable, deduped
// output. Multiplicity-insensitive: parallel edges between the same pair collapse to one adjacency
// entry below, so retaining edge multiplicity (P4.01) does not change cycle detection.
function detectCycles(nodePaths: string[], edges: readonly ContextGraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>(nodePaths.map((nodePath) => [nodePath, []]));
  for (const edge of edges) {
    const neighbors = adjacency.get(edge.from);
    if (neighbors !== undefined && !neighbors.includes(edge.to)) {
      neighbors.push(edge.to);
    }
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => left.localeCompare(right));
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const strongConnect = (node: string): void => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const neighbor of adjacency.get(node) ?? []) {
      if (!indices.has(neighbor)) {
        strongConnect(neighbor);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(neighbor)!));
      } else if (onStack.has(neighbor)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(neighbor)!));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) {
      return;
    }
    const component: string[] = [];
    for (;;) {
      const popped = stack.pop()!;
      onStack.delete(popped);
      component.push(popped);
      if (popped === node) {
        break;
      }
    }
    if (component.length > 1) {
      components.push(component);
    }
  };

  for (const nodePath of nodePaths) {
    if (!indices.has(nodePath)) {
      strongConnect(nodePath);
    }
  }

  return components
    .map((component) => cyclePath(component, adjacency))
    .sort((left, right) => left.join(" ").localeCompare(right.join(" ")));
}

// Find a concrete cycle through an SCC starting at its smallest node, returned as a closed path
// (start repeated at the end).
function cyclePath(component: string[], adjacency: Map<string, string[]>): string[] {
  const inComponent = new Set(component);
  const start = [...component].sort((left, right) => left.localeCompare(right))[0]!;
  const visited = new Set<string>([start]);
  const path = [start];

  const walk = (node: string): string[] | undefined => {
    for (const neighbor of (adjacency.get(node) ?? []).filter((candidate) => inComponent.has(candidate))) {
      if (neighbor === start && path.length > 1) {
        return [...path, start];
      }
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      path.push(neighbor);
      const found = walk(neighbor);
      if (found !== undefined) {
        return found;
      }
      path.pop();
      visited.delete(neighbor);
    }
    return undefined;
  };

  return walk(start) ?? [...component, start];
}
