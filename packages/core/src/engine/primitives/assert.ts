import { z } from "zod";

import { regexFlagsSchema, regexStringSchema } from "../regex.js";
import {
  columnInSet,
  columnMatches,
  columnNotEmpty,
  columnUnique,
  crossColumn,
  requiredColumns
} from "./table.js";
import { sectionOrder, sectionPresent } from "./section.js";
import { contentNotMatch, noPlaceholders } from "./content.js";
import { allChecked } from "./checklist.js";
import { imageResolves, linkResolves } from "./reference.js";
import type { PrimitiveContext, PrimitiveFinding } from "./types.js";

// The closed, Zod-validated assertion vocabulary (R9 Tier 1). This is the exact surface the
// declarative `custom` rule (P3.08) and the generated schema (P2.06) expose. Built-in rules call the
// executors directly with their own option shapes; custom rules go through `runAssertion` here.
//
// Kinds are mutually exclusive on `kind` (a discriminated union). Each option object is `.strict()`
// so an unknown key becomes a clear C7 config error rather than being silently ignored.

export const columnConditionSchema = z
  .object({
    column: z.string().min(1),
    equals: z.string().optional(),
    matches: regexStringSchema.optional(),
    notEmpty: z.boolean().optional()
  })
  .strict()
  .refine(
    (condition) =>
      condition.equals !== undefined ||
      condition.matches !== undefined ||
      condition.notEmpty !== undefined,
    { message: "condition requires one of: equals, matches, notEmpty" }
  );

export const assertionSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("requiredColumns"), columns: z.array(z.string().min(1)).min(1), section: z.string().optional() })
    .strict(),
  z.object({ kind: z.literal("columnNotEmpty"), column: z.string().min(1), section: z.string().optional() }).strict(),
  z
    .object({
      kind: z.literal("columnInSet"),
      column: z.string().min(1),
      values: z.array(z.string()).min(1),
      caseSensitive: z.boolean().optional(),
      section: z.string().optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal("columnMatches"),
      column: z.string().min(1),
      pattern: regexStringSchema,
      flags: regexFlagsSchema.optional(),
      section: z.string().optional()
    })
    .strict(),
  z
    .object({ kind: z.literal("columnUnique"), column: z.string().min(1), idPattern: regexStringSchema.optional(), section: z.string().optional() })
    .strict(),
  z
    .object({ kind: z.literal("crossColumn"), when: columnConditionSchema, then: columnConditionSchema, section: z.string().optional() })
    .strict(),
  z.object({ kind: z.literal("sectionPresent"), sections: z.array(z.string().min(1)).min(1) }).strict(),
  z
    .object({ kind: z.literal("sectionOrder"), order: z.array(z.string().min(1)).min(1), level: z.number().int().positive().optional(), section: z.string().optional() })
    .strict(),
  z.object({ kind: z.literal("contentNotMatch"), pattern: regexStringSchema, flags: regexFlagsSchema.optional() }).strict(),
  z.object({ kind: z.literal("noPlaceholders"), section: z.string().optional(), placeholders: z.array(z.string()).optional() }).strict(),
  z.object({ kind: z.literal("allChecked"), section: z.string().optional() }).strict(),
  z.object({ kind: z.literal("linkResolves"), exclude: z.array(z.string()).optional() }).strict(),
  z.object({ kind: z.literal("imageResolves"), exclude: z.array(z.string()).optional() }).strict()
]);

export type Assertion = z.infer<typeof assertionSchema>;

// The target collection a `kind` operates on — drives the custom rule's scope (columnUnique is the
// only project-scoped kind) and lets P3.08 validate the declared `target` against the assert.
export const ASSERTION_TARGETS = {
  requiredColumns: "table",
  columnNotEmpty: "table",
  columnInSet: "table",
  columnMatches: "table",
  columnUnique: "table",
  crossColumn: "table",
  sectionPresent: "section",
  sectionOrder: "section",
  contentNotMatch: "content",
  noPlaceholders: "content",
  allChecked: "checklist",
  linkResolves: "link",
  imageResolves: "link"
} as const satisfies Record<Assertion["kind"], string>;

// Kinds whose evaluation spans the whole corpus (project scope). Everything else is per-document.
export function isProjectAssertion(kind: Assertion["kind"]): boolean {
  return kind === "columnUnique";
}

export type RunAssertionOptions = {
  // For project assertions (columnUnique): which corpus files participate. Defaults to all.
  fileMatches?: (filePath: string) => boolean;
};

// Dispatch a validated assertion to its executor. `custom` rules and primitive tests call this; the
// discriminated union guarantees exhaustive, type-safe dispatch.
export function runAssertion(
  assertion: Assertion,
  context: PrimitiveContext,
  options: RunAssertionOptions = {}
): PrimitiveFinding[] {
  switch (assertion.kind) {
    case "requiredColumns":
      return requiredColumns(context.document, { columns: assertion.columns, section: assertion.section });
    case "columnNotEmpty":
      return columnNotEmpty(context.document, { columns: [assertion.column], section: assertion.section });
    case "columnInSet":
      return columnInSet(context.document, {
        column: assertion.column,
        values: assertion.values,
        caseSensitive: assertion.caseSensitive,
        section: assertion.section
      });
    case "columnMatches":
      return columnMatches(context.document, {
        column: assertion.column,
        pattern: assertion.pattern,
        flags: assertion.flags,
        section: assertion.section
      });
    case "columnUnique":
      return columnUnique(
        context,
        { column: assertion.column, idPattern: assertion.idPattern, section: assertion.section },
        options.fileMatches ?? (() => true)
      );
    case "crossColumn":
      return crossColumn(context.document, { when: assertion.when, then: assertion.then, section: assertion.section });
    case "sectionPresent":
      return sectionPresent(context.document, { sections: assertion.sections });
    case "sectionOrder":
      return sectionOrder(context.document, { order: assertion.order, level: assertion.level, section: assertion.section });
    case "contentNotMatch":
      return contentNotMatch(context.document, { pattern: assertion.pattern, flags: assertion.flags });
    case "noPlaceholders":
      return noPlaceholders(context.document, { section: assertion.section, placeholders: assertion.placeholders });
    case "allChecked":
      return allChecked(context.document, { section: assertion.section });
    case "linkResolves":
      return linkResolves(context.document, context, { exclude: assertion.exclude });
    case "imageResolves":
      return imageResolves(context.document, context, { exclude: assertion.exclude });
    default: {
      const exhaustiveCheck: never = assertion;
      return exhaustiveCheck;
    }
  }
}
