import { z } from "zod";

import { matchesConfigGlob } from "../../discovery/globs.js";
import { allChecked } from "../primitives/checklist.js";
import { noPlaceholders } from "../primitives/content.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { extractSectionBody } from "../section-body.js";
import { findLineNumber } from "../text-position.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";

// Content-quality rules (P3.05).

// CTX-001 — no empty / placeholder sections (whole-body, case-insensitive; audit 3.1).
export const ctx001: RuleDefinition = defineRule({
  metadata: {
    id: "CTX-001",
    category: "CTX",
    description: "Sections are not empty or placeholder-only.",
    defaultSeverity: "warning",
    scope: "document",
    fixable: false
  },
  optionsSchema: z
    .object({ section: z.string().optional(), placeholders: z.array(z.string()).optional(), ...fileScopeShape })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of noPlaceholders(context.document!, {
      section: options.section,
      placeholders: options.placeholders
    })) {
      context.report({ ...finding, helpUri: "CTX-001" });
    }
  }
});

// CTX-002 — all checklist items checked.
export const ctx002: RuleDefinition = defineRule({
  metadata: {
    id: "CTX-002",
    category: "CTX",
    description: "All checklist items are checked.",
    defaultSeverity: "warning",
    scope: "document",
    fixable: false
  },
  optionsSchema: z.object({ section: z.string().optional(), ...fileScopeShape }).strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of allChecked(context.document!, { section: options.section })) {
      context.report({ ...finding, helpUri: "CTX-002" });
    }
  }
});

// Match a term as a whole word (so "APIs" or "myapi" do not match "api"). Escapes regex-special
// characters in the term.
function wholeWordRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])(${escaped})([^A-Za-z0-9_]|$)`, "g");
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
    fixable: false
  },
  optionsSchema: z
    .object({
      glossary: z.string().min(1),
      termColumn: z.string().min(1),
      aliasColumn: z.string().min(1).optional(),
      section: z.string().optional(),
      ...fileScopeShape
    })
    .strict(),
  check: (options) => (context) => {
    const aliasToCanonical = new Map<string, string>();

    for (const document of context.documents!.values()) {
      if (!matchesConfigGlob(document.path, [options.glossary])) {
        continue;
      }
      for (const table of document.tables) {
        if (!table.headers.includes(options.termColumn)) {
          continue;
        }
        for (const row of table.rows) {
          const canonical = (row.cells[options.termColumn] ?? "").trim();
          if (canonical.length === 0 || options.aliasColumn === undefined) {
            continue;
          }
          for (const alias of (row.cells[options.aliasColumn] ?? "").split(/\s*,\s*/)) {
            const trimmed = alias.trim();
            if (trimmed.length > 0 && trimmed !== canonical) {
              aliasToCanonical.set(trimmed, canonical);
            }
          }
        }
      }
    }

    if (aliasToCanonical.size === 0) {
      return;
    }

    for (const document of context.documents!.values()) {
      // Never flag the glossary itself, and honor file scoping.
      if (matchesConfigGlob(document.path, [options.glossary]) || !matchesFileScope(document.path, options)) {
        continue;
      }

      const scanTargets =
        options.section === undefined
          ? [{ text: document.content, baseLine: 0 }]
          : document.headings
              .filter((heading) => heading.text === options.section)
              .map((heading) => ({
                text: extractSectionBody(document.content, document.headings, heading),
                baseLine: heading.line
              }));

      for (const { text, baseLine } of scanTargets) {
        for (const [alias, canonical] of aliasToCanonical) {
          for (const match of text.matchAll(wholeWordRegex(alias))) {
            context.report({
              message: `Use canonical term "${canonical}" instead of alias "${alias}".`,
              line: baseLine + findLineNumber(text, (match.index ?? 0) + match[1]!.length),
              filePath: document.path,
              data: { alias, canonical },
              helpUri: "CTX-003"
            });
          }
        }
      }
    }
  }
});

export const CTX_RULES: readonly RuleDefinition[] = [ctx001, ctx002, ctx003];
