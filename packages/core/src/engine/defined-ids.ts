import { matchesConfigGlob } from "../discovery/globs.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import { compileRegex } from "./regex.js";

// Column-based ID discovery (audit 2.1 / 5.5). One helper defines what a "defined ID" is, shared by
// REF-005 (P3.04) and the graph's id-ref edges (P4) — so there is a single notion of ID across the
// tool, and the parser stays config-light (idPattern is config, not a parse field).

export type IdOccurrence = { id: string; filePath: string; line: number };

// A row cell may hold several IDs (a references column like "REQ-1, REQ-2"); split on comma/space.
function tokenize(cell: string): string[] {
  return cell.split(/[\s,]+/).filter((token) => token.length > 0);
}

/**
 * Collect ID tokens from a given column of a document's tables, restricted to files matching
 * `files` and to tokens matching `idPattern`. This is the generic core; REF-005 uses it for both
 * definitions and references, differing only by file glob (and column, if the reference column
 * differs).
 */
export function extractColumnIds(
  document: ParsedDocument,
  options: { files: string[]; column: string; idPattern: string }
): IdOccurrence[] {
  if (!matchesConfigGlob(document.path, options.files)) {
    return [];
  }

  const regex = compileRegex(options.idPattern);
  const occurrences: IdOccurrence[] = [];

  for (const table of document.tables) {
    if (!table.headers.includes(options.column)) {
      continue;
    }
    for (const row of table.rows) {
      for (const token of tokenize(row.cells[options.column] ?? "")) {
        if (regex.test(token)) {
          occurrences.push({ id: token, filePath: document.path, line: row.line });
        }
      }
    }
  }

  return occurrences;
}

// The `idRef` shape from audit 2.1: `extractDefinedIds(doc, { idPattern, definitions, idColumn })`.
export type IdRef = { idPattern: string; definitions: string[]; idColumn: string };

/**
 * Defined IDs of a document: the `idColumn` tokens in tables of files matching `definitions`,
 * plus heading tokens matching `idPattern` (spec "+ headings" widening, audit 5.5) — same file-glob
 * gate as the column side, so a heading only counts as a definition in a file the config declares
 * as a definitions source. Frozen signature for P4's id-ref edges (audit 2.1).
 */
export function extractDefinedIds(document: ParsedDocument, idRef: IdRef): IdOccurrence[] {
  const columnIds = extractColumnIds(document, {
    files: idRef.definitions,
    column: idRef.idColumn,
    idPattern: idRef.idPattern
  });

  if (!matchesConfigGlob(document.path, idRef.definitions)) {
    return columnIds;
  }

  const regex = compileRegex(idRef.idPattern);
  const headingIds: IdOccurrence[] = [];
  for (const heading of document.headings) {
    for (const token of tokenize(heading.text)) {
      if (regex.test(token)) {
        headingIds.push({ id: token, filePath: document.path, line: heading.line });
      }
    }
  }

  return [...columnIds, ...headingIds];
}
