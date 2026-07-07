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

function getRole(
  documentPath: string,
  graph: ContextGraph,
  options: GraphAnalysisOptions,
): NodeRole {
  // P5.01 owns the degree classifier; profile extraction looks the role up there so P5.05 can
  // thread `compile.hubMinInDegree` through one place instead of forked logic drifting.
  const classification = classifyNodes(graph, options).find(
    (entry) => entry.path === documentPath,
  );

  if (classification === undefined) {
    throw new Error(
      `Cannot extract profile for "${documentPath}": document is not present in the graph.`,
    );
  }

  return classification.role;
}

export function extractDocProfile(
  document: ParsedDocument,
  graph: ContextGraph,
  options: GraphAnalysisOptions = {},
): DocumentProfile {
  return {
    role: getRole(document.path, graph, options),
    outline: document.headings.map((heading) => ({ ...heading })),
    tableSchemas: document.tables.map((table) => ({
      headers: [...table.headers],
      section: table.section,
      line: table.line,
    })),
    idPattern: detectIdPattern(document),
    // Filter preserves the graph's existing deterministic edge order, which is already sorted by
    // semantic identity and line number; re-sorting here would risk drifting from G1 semantics.
    referencesTo: graph.edges
      .filter((edge) => edge.from === document.path)
      .map(copyEdge),
    referencedBy: graph.edges
      .filter((edge) => edge.to === document.path)
      .map(copyEdge),
  };
}
