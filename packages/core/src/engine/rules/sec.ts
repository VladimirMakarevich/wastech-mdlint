import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { matchesConfigGlob } from "../../discovery/globs.js";
import type { ParsedDocument } from "../../markdown/document-types.js";
import { parseDocument } from "../../markdown/parse-document.js";
import { sectionOrder, sectionPresent } from "../primitives/section.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";
import type { TextEdit } from "../types.js";

// Section + structure rules (P3.03).

// SEC-001 — required sections present. Fixable: scaffold each missing section at EOF (audit 4.2 —
// the "SEC-* missing-section scaffold"; realized on the document-scope rule since fixes are
// per-document, journal [P3.03]).
export const sec001: RuleDefinition = defineRule({
  metadata: {
    id: "SEC-001",
    category: "SEC",
    description: "Required sections are present.",
    defaultSeverity: "error",
    scope: "document",
    fixable: true
  },
  optionsSchema: z.object({ sections: z.array(z.string().min(1)).min(1), ...fileScopeShape }).strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of sectionPresent(context.document!, { sections: options.sections })) {
      context.report({ ...finding, fixable: true, helpUri: "SEC-001" });
    }
  },
  fix: (options) => (context) => {
    const document = context.document!;
    if (!matchesFileScope(context.filePath!, options)) {
      return [];
    }
    const missing = sectionPresent(document, { sections: options.sections }).map(
      (finding) => finding.data?.section as string
    );
    if (missing.length === 0) {
      return [];
    }
    // Append a scaffold section (with a TODO body) per missing heading at end of file.
    const scaffold = missing.map((section) => `\n## ${section}\n\nTODO\n`).join("");
    const edit: TextEdit = { start: document.content.length, end: document.content.length, newText: scaffold };
    return [edit];
  }
});

// SEC-002 — sections appear in order. Reordering is a judgment call, so not auto-fixable.
export const sec002: RuleDefinition = defineRule({
  metadata: {
    id: "SEC-002",
    category: "SEC",
    description: "Sections appear in the required order.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false
  },
  optionsSchema: z
    .object({
      order: z.array(z.string().min(1)).min(1),
      level: z.number().int().positive().optional(),
      section: z.string().optional(),
      ...fileScopeShape
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of sectionOrder(context.document!, {
      order: options.order,
      level: options.level,
      section: options.section
    })) {
      context.report({ ...finding, helpUri: "SEC-002" });
    }
  }
});

// Load the template document from the corpus, or parse it on demand from disk; undefined if it is
// not on disk (the caller then emits one config-attributed error and skips per-file checks).
function loadTemplate(
  documents: Map<string, ParsedDocument>,
  rootDir: string,
  templatePath: string
): ParsedDocument | undefined {
  const fromCorpus = documents.get(templatePath);
  if (fromCorpus !== undefined) {
    return fromCorpus;
  }
  try {
    const content = readFileSync(path.resolve(rootDir, templatePath), "utf8");
    return parseDocument({ path: templatePath, content });
  } catch {
    return undefined;
  }
}

// SEC-003 — sections conform to a reference file's heading structure (project). Order is not
// enforced here (SEC-002 does that); only presence of each template heading.
export const sec003: RuleDefinition = defineRule({
  metadata: {
    id: "SEC-003",
    category: "SEC",
    description: "Sections conform to a reference template's heading structure.",
    defaultSeverity: "error",
    scope: "project",
    fixable: false
  },
  optionsSchema: z
    .object({ template: z.string().min(1), level: z.number().int().positive().optional(), ...fileScopeShape })
    .strict(),
  check: (options) => (context) => {
    const template = loadTemplate(context.documents!, context.rootDir!, options.template);

    if (template === undefined) {
      // Missing template ⇒ one config-attributed error, then skip (no false positives).
      context.report({
        message: `SEC-003 template "${options.template}" was not found; skipping conformance checks.`,
        line: 0,
        filePath: options.template,
        data: { template: options.template }
      });
      return;
    }

    // `level` selects the exact heading depth to compare (P3.03: "level: 2 checks only ## headings"
    // — journal [P3.03] resolves this against the contradictory "up to depth level" wording in favor
    // of the concrete ADR example, so a per-doc `# Title` is not required across files). Default:
    // compare all heading depths.
    const requiredHeadings = [
      ...new Set(
        template.headings
          .filter((heading) => options.level === undefined || heading.depth === options.level)
          .map((heading) => heading.text)
      )
    ];

    for (const [filePath, document] of context.documents!) {
      if (filePath === options.template || !matchesFileScope(filePath, options)) {
        continue;
      }
      const present = new Set(document.sections);
      for (const heading of requiredHeadings) {
        if (!present.has(heading)) {
          context.report({
            message: `Section "${heading}" required by template ${options.template} is missing.`,
            line: 0,
            filePath,
            data: { section: heading, template: options.template }
          });
        }
      }
    }
  }
});

// STR-001 — required files exist in the project (project). `files` here is the *required* set (each
// entry is a path or glob), not file scoping.
export const str001: RuleDefinition = defineRule({
  metadata: {
    id: "STR-001",
    category: "STR",
    description: "Required files exist in the project.",
    defaultSeverity: "error",
    scope: "project",
    fixable: false
  },
  optionsSchema: z.object({ files: z.array(z.string().min(1)).min(1) }).strict(),
  check: (options) => (context) => {
    const corpus = context.projectFiles ?? [];
    for (const required of options.files) {
      const satisfied = corpus.some((filePath) => matchesConfigGlob(filePath, [required]));
      if (!satisfied) {
        context.report({
          message: `Required file "${required}" is missing from the project.`,
          line: 0,
          filePath: required,
          data: { required }
        });
      }
    }
  }
});

export const SEC_STR_RULES: readonly RuleDefinition[] = [sec001, sec002, sec003, str001];
