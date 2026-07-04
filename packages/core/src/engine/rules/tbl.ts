import { z } from "zod";

import type { ParsedDocument } from "../../markdown/document-types.js";
import { columnConditionSchema } from "../primitives/assert.js";
import {
  columnInSet,
  columnMatches,
  columnNotEmpty,
  columnUnique,
  crossColumn,
  requiredColumns
} from "../primitives/table.js";
import { regexFlagsSchema, regexStringSchema } from "../regex.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";
import type { TextEdit } from "../types.js";

// The six table rules (P3.02) — thin presets over the P2.02 table primitives + shared file scoping.

// TBL-001 — required columns present.
export const tbl001: RuleDefinition = defineRule({
  metadata: {
    id: "TBL-001",
    category: "TBL",
    description: "Tables declare their required columns.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false
  },
  optionsSchema: z
    .object({
      requiredColumns: z.array(z.string().min(1)).min(1),
      section: z.string().optional(),
      ...fileScopeShape
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of requiredColumns(context.document!, {
      columns: options.requiredColumns,
      section: options.section
    })) {
      context.report({ ...finding, helpUri: "TBL-001" });
    }
  }
});

// Compute the character offset of each line start, so cell fixes can be expressed as content edits.
function lineStartOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

// Locate the [start, end) offsets of cell `cellIndex` within a canonical (leading-pipe) table row.
// Returns undefined for non-canonical rows or a cell beyond the row's pipes — the fix is then
// skipped rather than risk corrupting the source.
function locateCellRange(lineText: string, cellIndex: number): { start: number; end: number } | undefined {
  if (!lineText.trimStart().startsWith("|")) {
    return undefined;
  }
  const pipes: number[] = [];
  for (let index = 0; index < lineText.length; index += 1) {
    if (lineText[index] === "|" && lineText[index - 1] !== "\\") {
      pipes.push(index);
    }
  }
  if (cellIndex + 1 >= pipes.length) {
    return undefined;
  }
  return { start: pipes[cellIndex]! + 1, end: pipes[cellIndex + 1]! };
}

// TBL-002 fix: replace each empty target cell with ` TODO ` (audit 4.2 deterministic-fixable set).
function emptyCellEdits(
  document: ParsedDocument,
  options: { columns?: string[]; section?: string }
): TextEdit[] {
  const lines = document.content.split("\n");
  const offsets = lineStartOffsets(document.content);
  const edits: TextEdit[] = [];
  const tables =
    options.section === undefined
      ? document.tables
      : document.tables.filter((table) => table.section === options.section);

  for (const table of tables) {
    const columns = options.columns ?? table.headers;
    for (const column of columns) {
      const cellIndex = table.headers.indexOf(column);
      if (cellIndex === -1) {
        continue;
      }
      for (const row of table.rows) {
        if ((row.cells[column] ?? "").trim().length > 0) {
          continue;
        }
        const lineText = lines[row.line - 1];
        if (lineText === undefined) {
          continue;
        }
        const range = locateCellRange(lineText, cellIndex);
        if (range === undefined) {
          continue;
        }
        const base = offsets[row.line - 1]!;
        edits.push({ start: base + range.start, end: base + range.end, newText: " TODO " });
      }
    }
  }

  return edits;
}

// TBL-002 — target cells non-empty (fixable: empty → TODO).
export const tbl002: RuleDefinition = defineRule({
  metadata: {
    id: "TBL-002",
    category: "TBL",
    description: "Target table cells are not empty.",
    defaultSeverity: "warning",
    scope: "document",
    fixable: true
  },
  optionsSchema: z
    .object({ columns: z.array(z.string().min(1)).min(1).optional(), section: z.string().optional(), ...fileScopeShape })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of columnNotEmpty(context.document!, {
      columns: options.columns,
      section: options.section
    })) {
      context.report({ ...finding, fixable: true, helpUri: "TBL-002" });
    }
  },
  fix: (options) => (context) => emptyCellEdits(context.document!, options)
});

// TBL-003 — cell values within an allowed set.
export const tbl003: RuleDefinition = defineRule({
  metadata: {
    id: "TBL-003",
    category: "TBL",
    description: "Cell values fall within an allowed set.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false
  },
  optionsSchema: z
    .object({
      column: z.string().min(1),
      values: z.array(z.string()).min(1),
      caseSensitive: z.boolean().optional(),
      section: z.string().optional(),
      ...fileScopeShape
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of columnInSet(context.document!, {
      column: options.column,
      values: options.values,
      caseSensitive: options.caseSensitive,
      section: options.section
    })) {
      context.report({ ...finding, helpUri: "TBL-003" });
    }
  }
});

// TBL-004 — cell values match a regex.
export const tbl004: RuleDefinition = defineRule({
  metadata: {
    id: "TBL-004",
    category: "TBL",
    description: "Cell values match a required pattern.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false
  },
  optionsSchema: z
    .object({
      column: z.string().min(1),
      pattern: regexStringSchema,
      flags: regexFlagsSchema.optional(),
      section: z.string().optional(),
      ...fileScopeShape
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of columnMatches(context.document!, {
      column: options.column,
      pattern: options.pattern,
      flags: options.flags,
      section: options.section
    })) {
      context.report({ ...finding, helpUri: "TBL-004" });
    }
  }
});

// TBL-005 — cross-column conditional (when → then).
export const tbl005: RuleDefinition = defineRule({
  metadata: {
    id: "TBL-005",
    category: "TBL",
    description: "Cross-column conditional holds (when → then).",
    defaultSeverity: "error",
    scope: "document",
    fixable: false
  },
  optionsSchema: z
    .object({
      when: columnConditionSchema,
      then: columnConditionSchema,
      section: z.string().optional(),
      ...fileScopeShape
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of crossColumn(context.document!, {
      when: options.when,
      then: options.then,
      section: options.section
    })) {
      context.report({ ...finding, helpUri: "TBL-005" });
    }
  }
});

// TBL-006 — column IDs unique across files (project scope).
export const tbl006: RuleDefinition = defineRule({
  metadata: {
    id: "TBL-006",
    category: "TBL",
    description: "Column IDs are unique across files.",
    defaultSeverity: "error",
    scope: "project",
    fixable: false
  },
  optionsSchema: z
    .object({
      column: z.string().min(1),
      idPattern: regexStringSchema.optional(),
      section: z.string().optional(),
      ...fileScopeShape
    })
    .strict(),
  check: (options) => (context) => {
    for (const finding of columnUnique(
      { documents: context.documents! },
      { column: options.column, idPattern: options.idPattern, section: options.section, files: options.files },
      (filePath) => matchesFileScope(filePath, options)
    )) {
      context.report({ ...finding, helpUri: "TBL-006" });
    }
  }
});

export const TBL_RULES: readonly RuleDefinition[] = [tbl001, tbl002, tbl003, tbl004, tbl005, tbl006];
