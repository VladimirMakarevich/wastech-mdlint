import { z } from "zod";

import { matchesConfigGlob } from "../../discovery/globs.js";
import { allChecked } from "../primitives/checklist.js";
import { noPlaceholders } from "../primitives/content.js";
import { escapeRegExp } from "../regex.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { extractSectionBody } from "../section-body.js";
import { createLineNumberLookup } from "../text-position.js";
import { reportInertConfiguration } from "./inert.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";

// Content-quality rules.

// CTX-001 — no empty / placeholder sections (whole-body, case-insensitive).
export const ctx001: RuleDefinition = defineRule({
  metadata: {
    id: "CTX-001",
    category: "CTX",
    description: "Sections are not empty or placeholder-only.",
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      section: z.string().optional(),
      placeholders: z.array(z.string()).optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of noPlaceholders(context.document!, {
      section: options.section,
      placeholders: options.placeholders,
    })) {
      context.report(finding);
    }
  },
});

// CTX-002 — all checklist items checked.
export const ctx002: RuleDefinition = defineRule({
  metadata: {
    id: "CTX-002",
    category: "CTX",
    description: "All checklist items are checked.",
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({ section: z.string().optional(), ...fileScopeShape })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of allChecked(context.document!, {
      section: options.section,
    })) {
      context.report(finding);
    }
  },
});

// Match a term as a whole word (so "APIs" or "myapi" do not match "api"). Escapes regex-special
// characters in the term. The trailing boundary is a lookahead, not a consumed group: `matchAll`
// advances `lastIndex` past whatever a match consumes, so consuming the boundary character made
// adjacent occurrences separated by exactly one character unreachable — "api api api" then
// under-counted as 2.
function wholeWordRegex(term: string): RegExp {
  const escaped = escapeRegExp(term);
  return new RegExp(`(^|[^A-Za-z0-9_])(${escaped})(?=[^A-Za-z0-9_]|$)`, "g");
}

// Name the stage of the glossary load that produced no aliases, so the report says which of the
// three things to go and fix rather than that something is wrong. Ordered outermost-first: a
// glossary that was never read cannot be missing a column, and a column that is absent cannot hold
// an empty cell, so the first condition that holds is the only actionable one.
//
// Each message is a single line. The text report's grammar is one finding per line, so an embedded
// newline splits a message into rows that read as findings in files that do not exist.
function describeEmptyGlossary(params: {
  glossary: string;
  termColumn: string;
  aliasColumn: string;
  matchedGlossaries: number;
  termTables: number;
}): string {
  if (params.matchedGlossaries === 0) {
    // Names the scan rather than the disk: the glossary is read from the parsed corpus, so a file
    // that exists but sits outside `include` (or inside `exclude`) is as absent as one that was
    // never written, and a user staring at the file in their editor needs to be told that.
    return `CTX-003 glossary "${params.glossary}" matched no scanned document, so no aliases were loaded; skipping alias checks. A file outside "include" or inside "exclude" is not scanned even when it exists on disk.`;
  }
  if (params.termTables === 0) {
    return `CTX-003 found no table with a "${params.termColumn}" column in glossary "${params.glossary}", so no aliases were loaded; skipping alias checks.`;
  }
  return `CTX-003 derived no aliases from glossary "${params.glossary}": no "${params.termColumn}" table has a non-empty "${params.aliasColumn}" column; skipping alias checks.`;
}

// CTX-003 — glossary alias usage should use the canonical term (project). Builds alias→canonical
// from a glossary table, then scans matched files' content for alias usage.
export const ctx003: RuleDefinition = defineRule({
  metadata: {
    id: "CTX-003",
    category: "CTX",
    description: "Content uses canonical glossary terms instead of aliases.",
    defaultSeverity: "warning",
    scope: "project",
    fixable: false,
  },
  optionsSchema: z
    .object({
      glossary: z.string().min(1),
      termColumn: z.string().min(1),
      aliasColumn: z.string().min(1).optional(),
      section: z.string().optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => (context) => {
    // `aliasColumn` is optional in the schema but load-bearing at run time: with no alias column
    // there is no alias to look for, so the rule can never report anything. Answered before the
    // corpus walk because it is decidable from the options alone, and because it is the cause to
    // name even when the glossary path is also wrong — fixing the path would not make this config
    // check anything.
    if (options.aliasColumn === undefined) {
      reportInertConfiguration(context, {
        message: `CTX-003 has no "aliasColumn", so it can never derive an alias to check; skipping alias checks.`,
        configValue: options.glossary,
        data: { glossary: options.glossary, termColumn: options.termColumn },
      });
      return;
    }
    const aliasColumn = options.aliasColumn;

    const aliasToCanonical = new Map<string, string>();
    // Counted so an empty alias map can name which stage of the load came up empty. Without them
    // the three failures are indistinguishable at the point they have to be reported.
    let matchedGlossaries = 0;
    let termTables = 0;

    for (const document of context.documents!.values()) {
      if (!matchesConfigGlob(document.path, [options.glossary])) {
        continue;
      }
      matchedGlossaries += 1;
      for (const table of document.tables) {
        if (!table.headers.includes(options.termColumn)) {
          continue;
        }
        termTables += 1;
        for (const row of table.rows) {
          const canonical = (row.cells[options.termColumn] ?? "").trim();
          if (canonical.length === 0) {
            continue;
          }
          for (const alias of (row.cells[aliasColumn] ?? "").split(/\s*,\s*/)) {
            const trimmed = alias.trim();
            if (trimmed.length > 0 && trimmed !== canonical) {
              aliasToCanonical.set(trimmed, canonical);
            }
          }
        }
      }
    }

    // An empty alias map used to be a bare `return`: a configured rule, inert, and green, with
    // nothing anywhere distinguishing "this corpus uses canonical terms" from "this rule never ran"
    // — reachable by renaming the glossary file or a column header, neither of which invalidates
    // the config. All the ways to get here are reported as one error-severity finding attributed to
    // the `glossary` value, naming the stage that came up empty.
    //
    // Other rules take an option that names a corpus path and go quiet the same way when it matches
    // nothing (LLM-001's `entrypoints`, REF-005/REF-007's `definitions` and `references`, REF-006's
    // `zonesDir`, GRP-003's `chain[].files`). The reporting shape generalizes and lives in
    // `reportInertConfiguration`, but the decision to use it does not: for those options an empty
    // match can be a legitimate state (a corpus with no definitions yet), whereas a glossary rule
    // with no glossary cannot be. Converting one means deciding, per rule, whether emptiness is a
    // configuration mistake or a valid corpus — a judgment with its own tests, not a sweep.
    if (aliasToCanonical.size === 0) {
      reportInertConfiguration(context, {
        message: describeEmptyGlossary({
          glossary: options.glossary,
          termColumn: options.termColumn,
          aliasColumn,
          matchedGlossaries,
          termTables,
        }),
        configValue: options.glossary,
        data: {
          glossary: options.glossary,
          termColumn: options.termColumn,
          aliasColumn,
        },
      });
      return;
    }

    for (const document of context.documents!.values()) {
      // Never flag the glossary itself, and honor file scoping.
      if (
        matchesConfigGlob(document.path, [options.glossary]) ||
        !matchesFileScope(document.path, options)
      ) {
        continue;
      }

      const scanTargets =
        options.section === undefined
          ? [{ text: document.content, baseLine: 0 }]
          : document.headings
              .filter((heading) => heading.text === options.section)
              .map((heading) => ({
                text: extractSectionBody(
                  document.content,
                  document.headings,
                  heading,
                ),
                baseLine: heading.line,
              }));

      for (const { text, baseLine } of scanTargets) {
        // Indexed per scan target, not per document: `text` is either the whole content or one
        // section body, so a lookup hoisted above this loop would resolve offsets against the
        // wrong string. Every alias re-scans `text` from zero, so one shared index turns
        // O(aliases · matches · text length) into O(text length + matches · log lines).
        const lineAt = createLineNumberLookup(text);

        for (const [alias, canonical] of aliasToCanonical) {
          for (const match of text.matchAll(wholeWordRegex(alias))) {
            context.report({
              message: `Use canonical term "${canonical}" instead of alias "${alias}".`,
              line: baseLine + lineAt((match.index ?? 0) + match[1]!.length),
              filePath: document.path,
              data: { alias, canonical },
            });
          }
        }
      }
    }
  },
});

export const CTX_RULES: readonly RuleDefinition[] = [ctx001, ctx002, ctx003];
