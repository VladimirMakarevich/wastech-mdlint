import { compareStrings } from "../../deterministic-sort.js";
import type {
  ParsedDocument,
  ParsedTable,
} from "../../markdown/document-types.js";
import { compileRegex } from "../regex.js";
import type { PrimitiveContext, PrimitiveFinding } from "./types.js";

// Table-scoping shared by every table primitive: restrict to tables under a given section (audit
// 5.3 flat ownership), or all tables when `section` is omitted.
function tablesInScope(
  document: ParsedDocument,
  section?: string,
): ParsedTable[] {
  if (section === undefined) {
    return document.tables;
  }

  return document.tables.filter((table) => table.section === section);
}

function tableHasColumn(table: ParsedTable, column: string): boolean {
  return table.headers.includes(column);
}

export type RequiredColumnsOptions = { columns: string[]; section?: string };

// requiredColumns — every scoped table must declare each required column (TBL-001).
export function requiredColumns(
  document: ParsedDocument,
  options: RequiredColumnsOptions,
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];

  for (const table of tablesInScope(document, options.section)) {
    for (const column of options.columns) {
      if (!tableHasColumn(table, column)) {
        findings.push({
          message: `Table is missing required column "${column}".`,
          line: table.line,
          data: { column },
        });
      }
    }
  }

  return findings;
}

export type ColumnNotEmptyOptions = { columns?: string[]; section?: string };

// columnNotEmpty — cells in the target column(s) must be non-empty (TBL-002). When `columns` is
// omitted, every column of each scoped table is checked. Findings are flagged fixable so the
// TBL-002 fix hook (empty → TODO, P3) can act; custom rules ignore the flag (no fix hook).
export function columnNotEmpty(
  document: ParsedDocument,
  options: ColumnNotEmptyOptions,
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];

  for (const table of tablesInScope(document, options.section)) {
    const columns = options.columns ?? table.headers;

    for (const column of columns) {
      if (!tableHasColumn(table, column)) {
        continue;
      }

      for (const row of table.rows) {
        if ((row.cells[column] ?? "").trim().length === 0) {
          findings.push({
            message: `Cell in column "${column}" is empty.`,
            line: row.line,
            fixable: true,
            data: { column },
          });
        }
      }
    }
  }

  return findings;
}

export type ColumnInSetOptions = {
  column: string;
  values: string[];
  caseSensitive?: boolean;
  section?: string;
};

// The single source of truth for `columnInSet`'s case sensitivity (W-06). It used to be a bare `?? true`
// here with no `.default()` in either Zod schema, so nothing recorded it: `schema.json` emitted a plain
// boolean, one guide page documented the inverse, and the skill renderer treated "absent" as a third
// state. Both option schemas (TBL-003's and the `columnInSet` assertion's) now default to this
// constant, so a resolved option is never `undefined` in product code — the fallback below survives
// only for direct primitive callers, which do not pass through Zod.
export const DEFAULT_COLUMN_IN_SET_CASE_SENSITIVE = true;

// columnInSet — cell values must be one of an allowed set (TBL-003).
export function columnInSet(
  document: ParsedDocument,
  options: ColumnInSetOptions,
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];
  const caseSensitive =
    options.caseSensitive ?? DEFAULT_COLUMN_IN_SET_CASE_SENSITIVE;
  const normalize = (value: string): string =>
    caseSensitive ? value : value.toLowerCase();
  const allowed = new Set(options.values.map(normalize));

  for (const table of tablesInScope(document, options.section)) {
    if (!tableHasColumn(table, options.column)) {
      continue;
    }

    for (const row of table.rows) {
      const value = (row.cells[options.column] ?? "").trim();

      if (!allowed.has(normalize(value))) {
        findings.push({
          message: `Cell value "${value}" in column "${options.column}" is not one of the allowed values: ${options.values.join(", ")}.`,
          line: row.line,
          data: { column: options.column, value, allowed: options.values },
        });
      }
    }
  }

  return findings;
}

export type ColumnMatchesOptions = {
  column: string;
  pattern: string;
  flags?: string;
  section?: string;
};

// columnMatches — cell values must match a regex (TBL-004).
export function columnMatches(
  document: ParsedDocument,
  options: ColumnMatchesOptions,
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];
  const regex = compileRegex(options.pattern, options.flags);

  for (const table of tablesInScope(document, options.section)) {
    if (!tableHasColumn(table, options.column)) {
      continue;
    }

    for (const row of table.rows) {
      const value = (row.cells[options.column] ?? "").trim();

      // `g`/`y` flags make a RegExp stateful: `test()` advances `lastIndex` across calls, even
      // across different strings. Reset before each row so one cell's match state can't skew
      // whether the next cell passes.
      regex.lastIndex = 0;
      if (!regex.test(value)) {
        findings.push({
          message: `Cell value "${value}" in column "${options.column}" does not match ${options.pattern}.`,
          line: row.line,
          data: { column: options.column, value, pattern: options.pattern },
        });
      }
    }
  }

  return findings;
}

export type ColumnCondition = {
  column: string;
  equals?: string;
  matches?: string;
  notEmpty?: boolean;
};

export type CrossColumnOptions = {
  when: ColumnCondition;
  then: ColumnCondition;
  section?: string;
};

function evaluateCondition(value: string, condition: ColumnCondition): boolean {
  const trimmed = value.trim();

  if (condition.equals !== undefined && trimmed !== condition.equals) {
    return false;
  }
  if (
    condition.matches !== undefined &&
    !compileRegex(condition.matches).test(trimmed)
  ) {
    return false;
  }
  if (condition.notEmpty === true && trimmed.length === 0) {
    return false;
  }

  return true;
}

// crossColumn — when a row's `when` column satisfies its condition, the `then` column must satisfy
// its condition (TBL-005). Rows missing either column are skipped (nothing to assert against).
export function crossColumn(
  document: ParsedDocument,
  options: CrossColumnOptions,
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];

  for (const table of tablesInScope(document, options.section)) {
    if (
      !tableHasColumn(table, options.when.column) ||
      !tableHasColumn(table, options.then.column)
    ) {
      continue;
    }

    for (const row of table.rows) {
      const whenValue = row.cells[options.when.column] ?? "";

      if (!evaluateCondition(whenValue, options.when)) {
        continue;
      }

      const thenValue = row.cells[options.then.column] ?? "";

      if (!evaluateCondition(thenValue, options.then)) {
        findings.push({
          message: `When "${options.when.column}" is "${whenValue.trim()}", "${options.then.column}" must satisfy its condition (got "${thenValue.trim()}").`,
          line: row.line,
          data: {
            whenColumn: options.when.column,
            whenValue: whenValue.trim(),
            thenColumn: options.then.column,
            thenValue: thenValue.trim(),
          },
        });
      }
    }
  }

  return findings;
}

export type ColumnUniqueOptions = {
  column: string;
  section?: string;
  // Retained for callers' option shape; scope is actually enforced via the `fileMatches`
  // callback below, which also honors `exclude`.
  files?: string[];
  // Optional token validation: only cells matching this pattern are considered IDs.
  idPattern?: string;
};

type UniqueOccurrence = { filePath: string; line: number };

// columnUnique — a column's values must be unique across every scoped table in the corpus (TBL-006,
// project). Duplicates are attributed to the *second and later* occurrences, with the first
// occurrence surfaced in `data.firstSeenIn` for actionable diagnostics.
export function columnUnique(
  context: Pick<PrimitiveContext, "documents">,
  options: ColumnUniqueOptions,
  fileMatches: (filePath: string) => boolean,
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];
  const seen = new Map<string, UniqueOccurrence>();
  const idRegex =
    options.idPattern === undefined
      ? undefined
      : compileRegex(options.idPattern);

  // Deterministic corpus order: sort documents by repo-relative path before scanning.
  const documents = [...context.documents.values()].sort((left, right) =>
    compareStrings(left.path, right.path),
  );

  for (const document of documents) {
    // Always consult fileMatches — it applies both `files` and `exclude` (see the call sites in
    // rules/tbl.ts and rules/custom.ts), so gating this on `options.files` being set would
    // silently skip the exclude-only case.
    if (!fileMatches(document.path)) {
      continue;
    }

    for (const table of tablesInScope(document, options.section)) {
      if (!tableHasColumn(table, options.column)) {
        continue;
      }

      for (const row of table.rows) {
        const value = (row.cells[options.column] ?? "").trim();

        if (
          value.length === 0 ||
          (idRegex !== undefined && !idRegex.test(value))
        ) {
          continue;
        }

        const previous = seen.get(value);

        if (previous === undefined) {
          seen.set(value, { filePath: document.path, line: row.line });
          continue;
        }

        findings.push({
          message: `Duplicate value "${value}" in column "${options.column}" (first seen in ${previous.filePath}:${previous.line}).`,
          line: row.line,
          filePath: document.path,
          data: {
            column: options.column,
            value,
            firstSeenIn: previous.filePath,
            firstSeenLine: previous.line,
          },
        });
      }
    }
  }

  return findings;
}
