import { compareStrings } from "../deterministic-sort.js";
import { normalizeRelativePath } from "../discovery/globs.js";
import { extractDefinedIds, type IdRef } from "../engine/defined-ids.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import type { ContextGraph } from "./context-graph-types.js";
import { query as runQuery, type QueryVisit } from "./query.js";

// P4.04 deterministic search index + slice resolution (G4). P4.03's `query`/`slice` only accept an
// already-resolved start path; this module supplies the missing piece — resolving a user-facing
// query string (an ID, a heading/anchor slug, or a file path) to one or more start nodes via plain
// index lookups. Exact match only, never fuzzy/substring/keyword/LLM, so `slice` results stay
// deterministic and the CLI/MCP surfaces (P4.07/P7) can advertise honest semantics.

const byPath = compareStrings;

export type SliceMatchKind = "id" | "anchor" | "heading" | "path";

export type ContextSearchIndex = {
  byId: Map<string, string[]>;
  bySlug: Map<string, string[]>;
  paths: Set<string>;
};

export type ContextSliceResult = {
  query: string;
  matchKind: SliceMatchKind | null;
  starts: string[];
  files: string[];
  visited: QueryVisit[];
};

// Exported so P4.07's `--help` and P7's MCP tool description quote this exact sentence instead of
// drifting into separately worded (and possibly over-promising) copy — the single honesty
// requirement (G4 / AC4) is satisfied by both hosts importing the same string.
export const SLICE_RESOLUTION_DESCRIPTION =
  "Resolves the query by exact match against defined IDs, heading/anchor slugs, and file paths " +
  "— no fuzzy, substring, keyword, or LLM matching.";

// Mirrors `parse-document.ts`'s private fragment decode so a `#slug` query decodes identically to a
// same-file anchor link and lands on the same `bySlug` key. Kept local rather than exported: it is a
// three-line try/catch, not a contract worth widening the parser's public surface for.
function decodeFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Mirrors `buildIdRefEdges`'s `definers` construction in build-context-graph.ts: accumulate
// unsorted-but-deduped, sort once after every document has contributed, rather than re-sorting on
// every push.
function addToIndex(index: Map<string, string[]>, key: string, filePath: string): void {
  const existing = index.get(key);
  if (existing === undefined) {
    index.set(key, [filePath]);
  } else if (!existing.includes(filePath)) {
    existing.push(filePath);
  }
}

/**
 * Build the index `resolveQuery` searches. Node identity is `document.path`, re-keyed here (never
 * the caller's Map key) to match `buildContextGraph`'s identity rule.
 *
 * `idRef` is optional: when omitted, `byId` stays empty and ID queries never match — the same
 * coupling `buildContextGraph` has with its own optional `idRef` (id-ref edges only exist when a
 * host supplies one). Callers that want ID resolution must load config and pass `idRef` through.
 */
export function buildSearchIndex(documents: Map<string, ParsedDocument>, idRef?: IdRef): ContextSearchIndex {
  const documentsByPath = new Map<string, ParsedDocument>();
  for (const document of documents.values()) {
    documentsByPath.set(document.path, document);
  }

  const bySlug = new Map<string, string[]>();
  for (const document of documentsByPath.values()) {
    // `heading.slug` is the canonical github-slugger slug with parse-time document-order dedup
    // (`-1`/`-2`) already applied — reused verbatim so `#heading` resolves to the same file(s) an
    // anchor graph edge would (build-context-graph.ts compares against this same string).
    for (const heading of document.headings) {
      addToIndex(bySlug, heading.slug, document.path);
    }
  }

  const byId = new Map<string, string[]>();
  if (idRef !== undefined) {
    for (const document of documentsByPath.values()) {
      for (const occurrence of extractDefinedIds(document, idRef)) {
        addToIndex(byId, occurrence.id, document.path);
      }
    }
  }

  for (const values of bySlug.values()) {
    values.sort(byPath);
  }
  for (const values of byId.values()) {
    values.sort(byPath);
  }

  return { byId, bySlug, paths: new Set(documentsByPath.keys()) };
}

/**
 * Resolve a query string to zero or more start files. Exact match only, fixed precedence: a
 * leading `#` is always an anchor/heading-slug lookup and never falls through to another category;
 * otherwise path, then ID, then heading slug — the first category with at least one match wins and
 * all of its files are returned. Cross-category collisions are rare in practice (paths carry
 * `.md`/`/`, IDs match `idPattern`, slugs are lowercased) so a fixed precedence keeps results
 * deterministic without ranking or merging across categories.
 */
export function resolveQuery(index: ContextSearchIndex, query: string): { kind: SliceMatchKind; starts: string[] } | null {
  if (query.startsWith("#")) {
    const files = index.bySlug.get(decodeFragment(query.slice(1)));
    return files === undefined ? null : { kind: "anchor", starts: files };
  }

  const normalizedPath = normalizeRelativePath(query);
  if (index.paths.has(normalizedPath)) {
    return { kind: "path", starts: [normalizedPath] };
  }

  const idFiles = index.byId.get(query);
  if (idFiles !== undefined) {
    return { kind: "id", starts: idFiles };
  }

  const headingFiles = index.bySlug.get(query);
  if (headingFiles !== undefined) {
    return { kind: "heading", starts: headingFiles };
  }

  return null;
}

// Depth-then-`via` ordering used to merge per-start traversals below: smaller depth always wins,
// and a depth tie can only happen between two non-start nodes (each start uniquely owns depth 0 for
// its own path), so comparing `via` as a plain string at that point is always meaningful.
function compareVisit(left: QueryVisit, right: QueryVisit): number {
  return left.depth - right.depth || compareStrings(left.via ?? "", right.via ?? "");
}

function mergeVisited(perStart: QueryVisit[][]): QueryVisit[] {
  const merged = new Map<string, QueryVisit>();
  for (const visited of perStart) {
    for (const visit of visited) {
      const existing = merged.get(visit.path);
      if (existing === undefined || compareVisit(visit, existing) < 0) {
        merged.set(visit.path, visit);
      }
    }
  }
  return [...merged.values()].sort((left, right) => byPath(left.path, right.path));
}

/**
 * Resolve `query` via `buildSearchIndex`/`resolveQuery`, then run P4.03's forward `query()` from
 * every resolved start and merge the results — "closest start wins" for any node reachable from
 * more than one start. Exact resolution only (see `SLICE_RESOLUTION_DESCRIPTION`); a query that
 * resolves to nothing returns an empty result rather than guessing.
 */
export function getContextSlice(
  graph: ContextGraph,
  documents: Map<string, ParsedDocument>,
  query: string,
  depth = 2,
  idRef?: IdRef
): ContextSliceResult {
  const resolved = resolveQuery(buildSearchIndex(documents, idRef), query);
  if (resolved === null) {
    return { query, matchKind: null, starts: [], files: [], visited: [] };
  }

  // `query()` already no-ops on an unknown start, but filtering here keeps `starts` itself honest —
  // it should never list a node the graph doesn't have.
  const nodePaths = new Set(graph.nodes.map((node) => node.path));
  const starts = resolved.starts.filter((start) => nodePaths.has(start)).sort(byPath);

  const visited = mergeVisited(starts.map((start) => runQuery(graph, { start, direction: "forward", depth }).visited));

  return { query, matchKind: resolved.kind, starts, files: visited.map((visit) => visit.path), visited };
}
