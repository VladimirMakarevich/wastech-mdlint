import type {
  ContextGraph,
  ContextGraphEdge,
} from "../graph/context-graph-types.js";
import type {
  ParsedDocument,
  ParsedHeading,
} from "../markdown/document-types.js";
import {
  classifyNodes,
  type GraphAnalysisOptions,
  type NodeRole,
} from "./graph-analysis.js";

const COLUMN_TOKEN_SPLIT_PATTERN = /[\s,]+/;
const ID_FAMILY_PATTERN = /^(?<prefix>[A-Za-z][A-Za-z0-9]*)-(?<digits>\d+)$/;

export type DocumentOutlineItem = ParsedHeading;

export type DocumentTableSchema = {
  headers: string[];
  section?: string;
  line: number;
};

export type DocumentProfile = {
  role: NodeRole;
  outline: DocumentOutlineItem[];
  tableSchemas: DocumentTableSchema[];
  idPattern?: string;
  referencesTo: ContextGraphEdge[];
  referencedBy: ContextGraphEdge[];
};

function normalizeIdFamily(token: string): string | undefined {
  const match = ID_FAMILY_PATTERN.exec(token);

  if (match?.groups === undefined) {
    return undefined;
  }

  return `${match.groups.prefix}-${"N".repeat(match.groups.digits.length)}`;
}

// Reuse the same whitespace/comma token model as column-based ID discovery so compile profiling
// does not infer a different "cell token" shape than the REF/GRP rules.
function detectIdPattern(document: ParsedDocument): string | undefined {
  let normalizedFamily: string | undefined;

  for (const table of document.tables) {
    for (const row of table.rows) {
      for (const header of table.headers) {
        const tokens = (row.cells[header] ?? "")
          .split(COLUMN_TOKEN_SPLIT_PATTERN)
          .filter((token) => token.length > 0);

        for (const token of tokens) {
          const candidate = normalizeIdFamily(token);

          if (candidate === undefined) {
            continue;
          }

          // The contract only exposes one top-level family, so mixed prefixes or digit widths must
          // stay undefined instead of letting scan order pick an arbitrary winner.
          if (
            normalizedFamily !== undefined &&
            normalizedFamily !== candidate
          ) {
            return undefined;
          }

          normalizedFamily = candidate;
        }
      }
    }
  }

  return normalizedFamily;
}

function copyEdge(edge: ContextGraphEdge): ContextGraphEdge {
  return { ...edge };
}

// Everything a profile needs from the graph that does *not* depend on which document is being
// profiled. Deriving it per document made `compileContext` O(N² + N·E) in corpus size: the role
// classifier ran over every node N times and `graph.edges` was scanned twice per document
// (audit L-5).
type DocProfileGraphIndex = {
  roles: Map<string, NodeRole>;
  outgoing: Map<string, ContextGraphEdge[]>;
  incoming: Map<string, ContextGraphEdge[]>;
};

function appendEdge(
  bucket: Map<string, ContextGraphEdge[]>,
  key: string,
  edge: ContextGraphEdge,
): void {
  const existing = bucket.get(key);

  if (existing === undefined) {
    bucket.set(key, [edge]);
  } else {
    existing.push(edge);
  }
}

function indexGraph(
  graph: ContextGraph,
  options: GraphAnalysisOptions,
): DocProfileGraphIndex {
  // P5.01 owns the degree classifier; profile extraction looks the role up there so P5.05 can
  // thread `compile.hubMinInDegree` through one place instead of forked logic drifting. This
  // caches that classifier's result — it does not reimplement it.
  const roles = new Map(
    classifyNodes(graph, options).map((entry) => [entry.path, entry.role]),
  );
  const outgoing = new Map<string, ContextGraphEdge[]>();
  const incoming = new Map<string, ContextGraphEdge[]>();

  // Appending in `graph.edges` order preserves the graph's existing deterministic edge order,
  // which is already sorted by semantic identity and line number; re-sorting here would risk
  // drifting from G1 semantics. A self-edge lands in both buckets, exactly as the two independent
  // `filter` passes this replaces did.
  for (const edge of graph.edges) {
    appendEdge(outgoing, edge.from, edge);
    appendEdge(incoming, edge.to, edge);
  }

  return { roles, outgoing, incoming };
}

function buildProfile(
  document: ParsedDocument,
  index: DocProfileGraphIndex,
): DocumentProfile {
  const role = index.roles.get(document.path);

  if (role === undefined) {
    throw new Error(
      `Cannot extract profile for "${document.path}": document is not present in the graph.`,
    );
  }

  return {
    role,
    outline: document.headings.map((heading) => ({ ...heading })),
    tableSchemas: document.tables.map((table) => ({
      headers: [...table.headers],
      section: table.section,
      line: table.line,
    })),
    idPattern: detectIdPattern(document),
    // Fresh arrays per profile: the index's buckets are shared across a batch, so handing one out
    // directly would alias edge lists between profiles.
    referencesTo: (index.outgoing.get(document.path) ?? []).map(copyEdge),
    referencedBy: (index.incoming.get(document.path) ?? []).map(copyEdge),
  };
}

/**
 * Profile documents against one graph, keyed by `document.path`. The only entry point: it indexes
 * the graph once per call, so a corpus costs one classifier pass and one edge pass rather than one
 * of each per document. A single-document caller passes a one-element iterable — W-40 removed the
 * `extractDocProfile` convenience wrapper, which was on the barrel with no caller at all.
 */
export function extractDocProfiles(
  documents: Iterable<ParsedDocument>,
  graph: ContextGraph,
  options: GraphAnalysisOptions = {},
): Map<string, DocumentProfile> {
  const index = indexGraph(graph, options);
  const profiles = new Map<string, DocumentProfile>();

  for (const document of documents) {
    profiles.set(document.path, buildProfile(document, index));
  }

  return profiles;
}
