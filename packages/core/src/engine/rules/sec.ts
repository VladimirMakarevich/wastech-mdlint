import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import {
  isGlobPattern,
  matchesConfigGlob,
  normalizeRelativePath,
} from "../../discovery/globs.js";
import type {
  ParsedDocument,
  ParsedHeading,
} from "../../markdown/document-types.js";
import { detectNewline } from "../../markdown/newline.js";
import { parseDocument } from "../../markdown/parse-document.js";
import { resolvesOutsideRoot } from "../path-resolve.js";
import { sectionOrder, sectionPresent } from "../primitives/section.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";
import { duplicateHeadingFindings } from "./sec-duplicate-headings.js";
import { headingLevelFindings } from "./sec-heading-levels.js";
import {
  compileOutline,
  formatOutlineHeading,
  matchOutline,
} from "./sec-outline.js";
import type { TextEdit } from "../types.js";

// Section + structure rules.

// SEC-001 — required sections present. Fixable: scaffold each missing section at end of file.
// The fix lives on the document-scope rule because a `TextEdit` targets one document's content.
export const sec001: RuleDefinition = defineRule({
  metadata: {
    id: "SEC-001",
    category: "SEC",
    description: "Required sections are present.",
    defaultSeverity: "error",
    scope: "document",
    fixable: true,
  },
  optionsSchema: z
    .object({ sections: z.array(z.string().min(1)).min(1), ...fileScopeShape })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of sectionPresent(context.document!, {
      sections: options.sections,
    })) {
      context.report({ ...finding, fixable: true });
    }
  },
  fix: (options) => (context) => {
    const document = context.document!;
    if (!matchesFileScope(context.filePath!, options)) {
      return [];
    }
    const missing = sectionPresent(document, {
      sections: options.sections,
    }).map((finding) => finding.data?.section as string);
    if (missing.length === 0) {
      return [];
    }
    // Append a scaffold section (with a TODO body) per missing heading at end of file, joined with
    // the document's own line ending so a CRLF file does not come back with mixed endings
    // rather than mixed ones. `applyFixes` normalizes every edit's `newText` too; doing it here
    // keeps this fix hook correct when it is exercised on its own.
    const newline = detectNewline(document.content);
    const scaffold = missing
      .map((section) => ["", `## ${section}`, "", "TODO", ""].join(newline))
      .join("");
    const edit: TextEdit = {
      start: document.content.length,
      end: document.content.length,
      newText: scaffold,
    };
    return [edit];
  },
});

// SEC-002 — sections appear in order. Reordering is a judgment call, so not auto-fixable.
export const sec002: RuleDefinition = defineRule({
  metadata: {
    id: "SEC-002",
    category: "SEC",
    description: "Sections appear in the required order.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      order: z.array(z.string().min(1)).min(1),
      level: z.number().int().positive().optional(),
      section: z.string().optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of sectionOrder(context.document!, {
      order: options.order,
      level: options.level,
      section: options.section,
    })) {
      context.report(finding);
    }
  },
});

// Load the template document from the corpus, or parse it on demand from disk; undefined if it is
// not on disk (the caller then emits one config-attributed error and skips per-file checks).
function loadTemplate(
  documents: Map<string, ParsedDocument>,
  rootDir: string,
  templatePath: string,
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

// Strict-mode finding data carries `null` rather than omitting a side, so a JSON consumer always
// sees both keys and can tell "end of document" / "outline complete" apart from a missing field.
function headingData(
  heading: ParsedHeading | undefined,
): { text: string; depth: number; line: number } | null {
  return heading === undefined
    ? null
    : { text: heading.text, depth: heading.depth, line: heading.line };
}

// SEC-003 — sections conform to a reference file's heading structure (project). By default only
// presence of each template heading is enforced (SEC-002 handles order). With `strict`, the
// document's heading sequence must match the template's exactly — presence, order, depth and no
// extra headings — with `*`/`+`/`?` template headings acting as wildcards.
export const sec003: RuleDefinition = defineRule({
  metadata: {
    id: "SEC-003",
    category: "SEC",
    description:
      "Sections conform to a reference template's heading structure.",
    defaultSeverity: "error",
    scope: "project",
    fixable: false,
  },
  optionsSchema: z
    .object({
      template: z.string().min(1),
      level: z.number().int().positive().optional(),
      strict: z.boolean().optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => (context) => {
    const rootDir = context.rootDir!;

    if (resolvesOutsideRoot(rootDir, options.template)) {
      // Reject before any existsSync/readFileSync attempt: trying the read first and
      // special-casing the failure would still leak a file-existence oracle for arbitrary host
      // paths — the failure itself is the oracle, whatever the message says.
      context.report({
        message: `SEC-003 template "${options.template}" escapes the analyzed root; skipping conformance checks.`,
        line: 0,
        // filePath/data intentionally carry the raw (possibly absolute/Windows-separated) config
        // value, same as the "was not found" branch below: this finding is attributed to the
        // option itself, not a location inside the corpus, so it is not normalized.
        filePath: options.template,
        data: { template: options.template },
      });
      return;
    }

    const template = loadTemplate(
      context.documents!,
      rootDir,
      options.template,
    );

    if (template === undefined) {
      // Missing template ⇒ one config-attributed error, then skip (no false positives).
      context.report({
        message: `SEC-003 template "${options.template}" was not found; skipping conformance checks.`,
        line: 0,
        filePath: options.template,
        data: { template: options.template },
      });
      return;
    }

    if (options.strict === true) {
      // `level` keeps its exact-depth meaning and filters both sides, so a per-document `# Title`
      // can still differ when only `##` headings are compared.
      const atLevel = (heading: ParsedHeading): boolean =>
        options.level === undefined || heading.depth === options.level;
      const outline = compileOutline(template.headings.filter(atLevel));
      for (const [filePath, document] of context.documents!) {
        if (
          filePath === options.template ||
          !matchesFileScope(filePath, options)
        ) {
          continue;
        }
        const divergence = matchOutline(
          outline,
          document.headings.filter(atLevel),
        );
        if (divergence === undefined) {
          continue;
        }
        const { expected, actual } = divergence;
        const expectedText =
          expected === undefined
            ? "no further heading"
            : `"${formatOutlineHeading(expected)}" (template line ${expected.line})`;
        const actualText =
          actual === undefined
            ? "end of document"
            : `"${formatOutlineHeading(actual)}"`;
        context.report({
          message: `Outline diverges from template ${options.template}: expected ${expectedText}, found ${actualText}.`,
          // Line 0 is the existing "no specific line" sentinel, used when the document ran out.
          line: actual?.line ?? 0,
          filePath,
          data: {
            template: options.template,
            expected: headingData(expected),
            actual: headingData(actual),
          },
        });
      }
      return;
    }

    // `level` selects the *exact* heading depth to compare — `level: 2` checks only `##` headings,
    // not "every heading up to depth 2". Exact-depth is what lets a per-document `# Title` differ
    // across files without every document being required to share it. Default: compare all depths.
    const requiredHeadings = [
      ...new Set(
        template.headings
          .filter(
            (heading) =>
              options.level === undefined || heading.depth === options.level,
          )
          .map((heading) => heading.text),
      ),
    ];

    for (const [filePath, document] of context.documents!) {
      if (
        filePath === options.template ||
        !matchesFileScope(filePath, options)
      ) {
        continue;
      }
      const present = new Set(document.sections);
      for (const heading of requiredHeadings) {
        if (!present.has(heading)) {
          context.report({
            message: `Section "${heading}" required by template ${options.template} is missing.`,
            line: 0,
            filePath,
            data: { section: heading, template: options.template },
          });
        }
      }
    }
  },
});

// SEC-004 — heading levels increment by one, with a single title at the start. Three checks, each
// switchable on its own because each has a legitimate exception: a docs-site page often takes its
// title from front matter and its renderer (title off, or satisfied by `titleKey`), a changelog has
// one top-level heading per release (singleTitle off), and generated reference pages sometimes jump
// levels to match an external structure (increment off). Defaults are applied here with `??`
// rather than a Zod `.default()`, matching SEC-003's `strict`, so the generated schema keeps every
// option optional the way its siblings do. Not fixable: choosing the right level is a judgment call.
export const sec004: RuleDefinition = defineRule({
  metadata: {
    id: "SEC-004",
    category: "SEC",
    description:
      "Heading levels increment by one, with a single title at the start.",
    // Outline hygiene rather than a broken contract, and the rule is meant to be enabled bare, so a
    // warning is the proportionate default.
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      increment: z.boolean().optional(),
      singleTitle: z.boolean().optional(),
      title: z.boolean().optional(),
      // Capped at 6 because Markdown has no H7.
      level: z.number().int().min(1).max(6).optional(),
      titleKey: z.string().min(1).optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of headingLevelFindings(context.document!, {
      increment: options.increment ?? true,
      singleTitle: options.singleTitle ?? true,
      title: options.title ?? true,
      level: options.level ?? 1,
      titleKey: options.titleKey ?? "title",
    })) {
      context.report(finding);
    }
  },
});

// SEC-005 — heading text is not repeated within a document. A repeated heading makes every
// `section` option that names it ambiguous (the section primitives scope to the first match and
// silently ignore the rest, while TBL's table filter takes every match), and turns its anchor into an order-dependent `-1` slug that breaks as soon as the
// headings are reordered. `siblingsOnly` exists because some families repeat headings by design —
// a changelog's `### Added` per release, an API page's `### Parameters` per function — and there the
// defect is only a repeat under the same parent. Its default is applied with `??` rather than a Zod
// `.default()`, matching SEC-003 and SEC-004, so the generated schema keeps every option optional.
// Not fixable: renaming a heading is a judgment call.
export const sec005: RuleDefinition = defineRule({
  metadata: {
    id: "SEC-005",
    category: "SEC",
    description: "Heading text is not repeated within a document.",
    // Outline hygiene meant to be enabled bare, like SEC-004, so a warning is proportionate.
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      siblingsOnly: z.boolean().optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const finding of duplicateHeadingFindings(context.document!, {
      siblingsOnly: options.siblingsOnly ?? false,
    })) {
      context.report(finding);
    }
  },
});

// STR-001 — required files exist in the project (project). `files` here is the *required* set (each
// entry is a path or glob), not file scoping.
//
// Satisfaction has two modes. A *literal* entry is satisfied by the corpus at
// exactly that repo-relative path, or by anything on disk there — so a required `LICENSE` or
// `package.json`, which no `**/*.md` corpus can ever contain, stops being reported missing on a
// repository that ships it. "Corpus or disk" is the same resolution model REF-001 already uses
// (`primitives/reference.ts`), so the two rules agree on what "exists" means. A *glob* entry stays
// corpus-only: expanding one against the filesystem would mean walking the tree from a synchronous
// `check`, and `include`/`exclude` already define what the run considers.
export const str001: RuleDefinition = defineRule({
  metadata: {
    id: "STR-001",
    category: "STR",
    description: "Required files exist in the project.",
    defaultSeverity: "error",
    scope: "project",
    fixable: false,
  },
  optionsSchema: z
    .object({ files: z.array(z.string().min(1)).min(1) })
    .strict(),
  check: (options) => (context) => {
    const rootDir = context.rootDir!;
    const corpus = context.projectFiles ?? [];

    const reportMissing = (required: string): void => {
      context.report({
        message: `Required file "${required}" is missing from the project.`,
        line: 0,
        // filePath/data intentionally carry the raw config value, not the normalized one: this
        // finding is attributed to the option entry the user wrote, not to a corpus location.
        filePath: required,
        data: { required },
      });
    };

    for (const required of options.files) {
      // Normalize once for both lookups: the corpus is keyed by repo-relative POSIX paths, and
      // `path.resolve` accepts `/` separators on Windows too, so one value keeps the membership
      // test and the disk probe talking about the same path. Unlike SEC-003's raw `template`, this
      // cannot mask an escape — `..\x` normalizes to `../x`, which still fails containment below.
      const entry = normalizeRelativePath(required);

      if (isGlobPattern(entry)) {
        // Deliberately corpus-scoped (see the note above the rule): a glob that only matches
        // non-Markdown files on disk reports missing.
        if (!corpus.some((filePath) => matchesConfigGlob(filePath, [entry]))) {
          reportMissing(required);
        }
        continue;
      }

      if (resolvesOutsideRoot(rootDir, entry)) {
        // Rejected before the probe, at the same severity as "missing", so a required entry cannot
        // be used to ask whether an arbitrary host path exists — the same reasoning as SEC-003's
        // template check.
        context.report({
          message: `Required file "${required}" escapes the analyzed root and cannot be verified.`,
          line: 0,
          filePath: required,
          data: { required },
        });
        continue;
      }

      // Root-pinned on purpose: a bare `README.md` means the one at the repository root, not any
      // `README.md` anywhere. Without root-pinning the rule could not require a file at a specific
      // location at all. Write `**/README.md` for the corpus-wide behavior.
      if (corpus.includes(entry) || existsSync(path.resolve(rootDir, entry))) {
        continue;
      }

      reportMissing(required);
    }
  },
});

export const SEC_STR_RULES: readonly RuleDefinition[] = [
  sec001,
  sec002,
  sec003,
  sec004,
  sec005,
  str001,
];
