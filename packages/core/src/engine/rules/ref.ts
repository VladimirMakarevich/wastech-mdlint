import path from "node:path";

import { z } from "zod";

import {
  matchesConfigGlob,
  normalizeRelativePath,
} from "../../discovery/globs.js";
import type { ParsedDocument } from "../../markdown/document-types.js";
import { anchorResolves } from "../anchor-resolve.js";
import {
  extractColumnIds,
  extractDefinedIds,
  type IdOccurrence,
} from "../defined-ids.js";
import {
  filePart,
  resolveRelativeToSource,
  sourceLocale,
} from "../path-resolve.js";
import { imageResolves, linkResolves } from "../primitives/reference.js";
import { compileRegex, escapeRegExp, regexStringSchema } from "../regex.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { extractSectionBody } from "../section-body.js";
import { resolveRoutedUrl } from "../site-router.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";
import type { RuleContext, SiteRouterSettings } from "../types.js";

// Reference-integrity rules. REF rules use the documents map + existsSync + site-router; no
// graph needed — that is the GRP family's job. REF-007 and REF-008 read only the parsed document
// itself.

const siteRouterOptionSchema = z
  .object({
    preset: z.string().optional(),
    contentDir: z.string().optional(),
    defaultLocale: z.string().optional(),
  })
  .strict();

// REF-001 — relative links resolve to a file. `exclude` is a link-target filter (config example).
export const ref001: RuleDefinition = defineRule({
  metadata: {
    id: "REF-001",
    category: "REF",
    description: "Relative links resolve to a file.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      exclude: z.array(z.string()).optional(),
      siteRouter: siteRouterOptionSchema.optional(),
    })
    .strict(),
  check: (options) => (context) => {
    for (const finding of linkResolves(
      context.document!,
      {
        documents: context.documents!,
        rootDir: context.rootDir!,
        settings: context.settings,
      },
      { exclude: options.exclude, siteRouter: options.siteRouter },
    )) {
      context.report(finding);
    }
  },
});

// Resolve a link target to a corpus document (relative → source dir; root-relative → site router).
function resolveTargetDoc(
  sourcePath: string,
  target: string,
  context: RuleContext,
  router?: SiteRouterSettings,
): ParsedDocument | undefined {
  if (target.startsWith("/") && router !== undefined) {
    for (const candidate of resolveRoutedUrl(
      target,
      router,
      sourceLocale(sourcePath, router),
    )) {
      const found = context.documents!.get(normalizeRelativePath(candidate));
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  const relTarget = target.startsWith("/")
    ? normalizeRelativePath(path.posix.normalize(target.replace(/^\/+/, "")))
    : resolveRelativeToSource(sourcePath, target);
  return context.documents!.get(relTarget);
}

// Case-sensitive by default because GitHub's fragment matching is: `#Demo` does not reach `# Demo`
// there, so accepting it here would pass a link that is broken on the rendered page.
const DEFAULT_REF002_IGNORE_CASE = false;

// REF-002 — link anchors resolve in their target document: a heading slug (github-slugger), an
// HTML `id`/`name` anchor, `#top`, or a GitHub line fragment, all decided by the shared
// `anchorResolves` so this rule and the graph's anchor edges agree under default options. Same-file
// anchors validate against the doc itself; cross-file anchors against the resolved target (missing
// target files are REF-001's concern, so they are skipped here). `ignoreCase` and `ignoredPattern`
// are per-rule-instance and the graph has no rule options, so with either set this rule can accept
// a fragment for which no anchor edge exists.
export const ref002: RuleDefinition = defineRule({
  metadata: {
    id: "REF-002",
    category: "REF",
    description: "Link anchors match a heading or HTML anchor.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      siteRouter: siteRouterOptionSchema.optional(),
      ignoreCase: z.boolean().default(DEFAULT_REF002_IGNORE_CASE),
      // Validated as a compilable pattern at config load, so a bad one is a config diagnostic
      // naming `options.ignoredPattern` rather than a throw in the middle of a lint run.
      ignoredPattern: regexStringSchema.optional(),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => {
    // Compiled once per resolved rule and with no flags: a non-`g` RegExp keeps no `lastIndex`, so
    // sharing it across links, documents and repeated runs cannot make one result depend on the
    // match before it. Unanchored and independent of `ignoreCase`; users anchor with `^…$` or fold
    // case inside the pattern with `(?i:…)`.
    const ignoredPattern =
      options.ignoredPattern === undefined
        ? undefined
        : compileRegex(options.ignoredPattern);

    return (context) => {
      if (!matchesFileScope(context.filePath!, options)) {
        return;
      }
      const document = context.document!;
      const router = options.siteRouter ?? context.settings.siteRouter;

      for (const link of document.links) {
        if (link.anchor === undefined || link.anchor.length === 0) {
          continue;
        }
        if (ignoredPattern?.test(link.anchor) === true) {
          continue;
        }

        let target: ParsedDocument | undefined;
        if (link.kind === "same-file-anchor") {
          target = document;
        } else if (link.kind === "local-file") {
          target = resolveTargetDoc(
            document.path,
            filePart(link.rawTarget),
            context,
            router,
          );
          if (target === undefined) {
            continue;
          }
        } else {
          continue;
        }

        if (
          !anchorResolves(target, link.anchor, {
            ignoreCase: options.ignoreCase,
          })
        ) {
          context.report({
            message: `Anchor "#${link.anchor}" does not match any heading or HTML anchor in ${target.path}.`,
            line: link.line,
            column: link.column,
            data: { anchor: link.anchor, targetPath: target.path },
          });
        }
      }
    };
  },
});

// REF-003 — images resolve on disk.
export const ref003: RuleDefinition = defineRule({
  metadata: {
    id: "REF-003",
    category: "REF",
    description: "Image targets resolve to a file.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z.object({ exclude: z.array(z.string()).optional() }).strict(),
  check: (options) => (context) => {
    for (const finding of imageResolves(
      context.document!,
      {
        documents: context.documents!,
        rootDir: context.rootDir!,
        settings: context.settings,
      },
      { exclude: options.exclude },
    )) {
      context.report(finding);
    }
  },
});

// The zone a path belongs to: the first directory segment under `zonesDir` (a file must live at
// `<zonesDir>/<zone>/…`). Files directly under zonesDir have no zone.
function zoneOf(relPath: string, zonesDir: string): string | undefined {
  const prefix = `${normalizeRelativePath(zonesDir)}/`;
  if (!relPath.startsWith(prefix)) {
    return undefined;
  }
  const parts = relPath.slice(prefix.length).split("/");
  return parts.length >= 2 ? parts[0] : undefined;
}

// REF-004 — cross-zone links must be declared in the source zone's Dependencies section. Document
// scope, but reads the corpus to learn zones + declarations. The rule as specified was ambiguous
// about whether a declaration is per-zone or per-document; per-zone is the reading implemented here.
export const ref004: RuleDefinition = defineRule({
  metadata: {
    id: "REF-004",
    category: "REF",
    description:
      "Cross-zone links are declared in the zone's Dependencies section.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      zonesDir: z.string().min(1),
      dependencySection: z.string().optional(),
    })
    .strict(),
  check: (options) => (context) => {
    const document = context.document!;
    const sourceZone = zoneOf(document.path, options.zonesDir);
    if (sourceZone === undefined) {
      return;
    }

    const dependencyHeading = options.dependencySection ?? "Dependencies";
    // Compiled once per zone (guarded by `.has`), not once per file that shares that zone or per
    // heading/document that scans it — `zone` is an arbitrary directory name, so it must be escaped
    // before it becomes regex source (unescaped interpolation crashed on names like "c++"
    // and silently mismatched on names like "node.js").
    const zoneMentionRegexes = new Map<string, RegExp>();
    for (const relPath of context.projectFiles ?? []) {
      const zone = zoneOf(relPath, options.zonesDir);
      if (zone !== undefined && !zoneMentionRegexes.has(zone)) {
        zoneMentionRegexes.set(
          zone,
          new RegExp(
            `(^|[^A-Za-z0-9_-])${escapeRegExp(zone)}([^A-Za-z0-9_-]|$)`,
          ),
        );
      }
    }

    // Declared dependency zones = zone names appearing in any Dependencies-section body of a file in
    // the source zone.
    const declared = new Set<string>();
    for (const other of context.documents!.values()) {
      if (zoneOf(other.path, options.zonesDir) !== sourceZone) {
        continue;
      }
      for (const heading of other.headings) {
        if (heading.text !== dependencyHeading) {
          continue;
        }
        const body = extractSectionBody(other.content, other.headings, heading);
        for (const [zone, zoneRegex] of zoneMentionRegexes) {
          if (zoneRegex.test(body)) {
            declared.add(zone);
          }
        }
      }
    }

    for (const link of document.links) {
      if (link.kind !== "local-file") {
        continue;
      }
      const targetRel = resolveRelativeToSource(
        document.path,
        filePart(link.rawTarget),
      );
      const targetZone = zoneOf(targetRel, options.zonesDir);
      if (
        targetZone === undefined ||
        targetZone === sourceZone ||
        declared.has(targetZone)
      ) {
        continue;
      }
      context.report({
        message: `Cross-zone link to zone "${targetZone}" is not declared in the "${dependencyHeading}" section of zone "${sourceZone}".`,
        line: link.line,
        column: link.column,
        data: { fromZone: sourceZone, toZone: targetZone },
      });
    }
  },
});

// Render the globs a lookup searched, quoted so a brace list's own commas cannot be read as the
// separator between two globs.
function describeScope(globs: readonly string[]): string {
  return globs.map((glob) => `"${glob}"`).join(", ");
}

// REF-005 — ID traceability: every referenced ID has a definition (dangling ref = error) and every
// defined ID is referenced (orphan def = warning). Definitions go through the shared
// `extractDefinedIds` (column + heading discovery) so this rule and the graph's id-ref
// edges agree on what counts as a defined ID; references stay column-only via `extractColumnIds`.
//
// Both messages name the lookup rather than asserting about the corpus. "Is never referenced" is a
// claim about the world that a reader disproves with one grep — an id mentioned in prose, in a link,
// or in a filename is not in an `idColumn`, and the rule never looked there. Being told the rule is
// wrong about five ids is what makes a reader stop trusting the sixth, which was the real one. The
// two branches search different things and must say so: references are column-only, definitions are
// that column plus heading tokens.
export const ref005: RuleDefinition = defineRule({
  metadata: {
    id: "REF-005",
    category: "REF",
    description: "IDs are traceable between definitions and references.",
    defaultSeverity: "error",
    scope: "project",
    fixable: false,
  },
  optionsSchema: z
    .object({
      definitions: z.array(z.string()).min(1),
      references: z.array(z.string()).min(1),
      idColumn: z.string().min(1),
      idPattern: regexStringSchema,
    })
    .strict(),
  check: (options) => (context) => {
    const definitions = new Map<string, IdOccurrence>();
    const references: IdOccurrence[] = [];

    for (const document of context.documents!.values()) {
      for (const occurrence of extractDefinedIds(document, {
        idPattern: options.idPattern,
        definitions: options.definitions,
        idColumn: options.idColumn,
      })) {
        if (!definitions.has(occurrence.id)) {
          definitions.set(occurrence.id, occurrence);
        }
      }
      references.push(
        ...extractColumnIds(document, {
          files: options.references,
          column: options.idColumn,
          idPattern: options.idPattern,
        }),
      );
    }

    const referencedIds = new Set(references.map((reference) => reference.id));

    // Dangling references (error).
    for (const reference of references) {
      if (!definitions.has(reference.id)) {
        context.report({
          message: `Reference "${reference.id}" has no definition: it is not in the "${options.idColumn}" column of any table, or in a heading, in ${describeScope(options.definitions)}.`,
          line: reference.line,
          filePath: reference.filePath,
          severity: "error",
          data: { id: reference.id },
        });
      }
    }

    // Orphan definitions (warning).
    for (const [id, occurrence] of definitions) {
      if (!referencedIds.has(id)) {
        context.report({
          message: `Definition "${id}" is not referenced: it is not in the "${options.idColumn}" column of any table in ${describeScope(options.references)}.`,
          line: occurrence.line,
          filePath: occurrence.filePath,
          severity: "warning",
          data: { id },
        });
      }
    }
  },
});

// REF-006 — stability consistency: a row must not depend on a less-stable entity. Reference rows
// carry the referenced ID (idColumn) and the referencer's own stability (stabilityColumn); the
// referenced entity's stability comes from the definition tables.
export const ref006: RuleDefinition = defineRule({
  metadata: {
    id: "REF-006",
    category: "REF",
    description: "References do not depend on less-stable entities.",
    defaultSeverity: "warning",
    scope: "project",
    fixable: false,
  },
  optionsSchema: z
    .object({
      stabilityColumn: z.string().min(1),
      stabilityOrder: z.array(z.string().min(1)).min(2),
      definitions: z.array(z.string()).min(1),
      references: z.array(z.string()).min(1),
      idColumn: z.string().min(1),
      idPattern: regexStringSchema.optional(),
    })
    .strict(),
  check: (options) => (context) => {
    // stabilityOrder lists least → most stable; rank is the index.
    const rank = new Map(
      options.stabilityOrder.map((value, index) => [value, index]),
    );
    const idPattern = options.idPattern ?? "^.+$";
    const definitionStability = new Map<string, string>();

    // Build id → stability from definition tables.
    for (const document of context.documents!.values()) {
      if (!matchesConfigGlob(document.path, options.definitions)) {
        continue;
      }
      for (const table of document.tables) {
        if (
          !table.headers.includes(options.idColumn) ||
          !table.headers.includes(options.stabilityColumn)
        ) {
          continue;
        }
        for (const row of table.rows) {
          const id = (row.cells[options.idColumn] ?? "").trim();
          const stability = (row.cells[options.stabilityColumn] ?? "").trim();
          if (id.length > 0 && stability.length > 0) {
            definitionStability.set(id, stability);
          }
        }
      }
    }

    const idRegex = new RegExp(idPattern);

    // Reference rows: compare each referenced entity's stability to the referencer's.
    for (const document of context.documents!.values()) {
      if (!matchesConfigGlob(document.path, options.references)) {
        continue;
      }
      for (const table of document.tables) {
        if (
          !table.headers.includes(options.idColumn) ||
          !table.headers.includes(options.stabilityColumn)
        ) {
          continue;
        }
        for (const row of table.rows) {
          const referencerStability = (
            row.cells[options.stabilityColumn] ?? ""
          ).trim();
          const referencerRank = rank.get(referencerStability);
          if (referencerRank === undefined) {
            continue;
          }
          const referencedIds = (row.cells[options.idColumn] ?? "")
            .split(/[\s,]+/)
            .filter((token) => token.length > 0 && idRegex.test(token));

          for (const referencedId of referencedIds) {
            const referencedStability = definitionStability.get(referencedId);
            const referencedRank =
              referencedStability === undefined
                ? undefined
                : rank.get(referencedStability);
            if (
              referencedRank !== undefined &&
              referencedRank < referencerRank
            ) {
              context.report({
                message: `Depends on "${referencedId}" (stability "${referencedStability}") which is less stable than this entry (stability "${referencerStability}").`,
                line: row.line,
                filePath: document.path,
                data: {
                  referencedId,
                  referencedStability,
                  referencerStability,
                },
              });
            }
          }
        }
      }
    }
  },
});

// Shortcut references are off by default: `[sic]`, `[WIP]` or `[x]` in prose is indistinguishable
// from a shortcut reference attempt, so reporting them would flag ordinary bracketed text. The full
// and collapsed forms are unambiguous attempts at a link.
const DEFAULT_REF007_INCLUDE_SHORTCUT = false;

// REF-007 — reference-style links and images use a defined label. micromark renders an undefined
// `[text][missing]` as the literal brackets and no link, so the parser records each one as an
// `undefinedReferences` entry and this rule reports it. Error severity because the result is a
// broken link on the page, exactly as REF-001's; not fixable because there is no target to invent.
export const ref007: RuleDefinition = defineRule({
  metadata: {
    id: "REF-007",
    category: "REF",
    description: "Reference links and images use a defined label.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z
    .object({
      includeShortcut: z.boolean().default(DEFAULT_REF007_INCLUDE_SHORTCUT),
      ...fileScopeShape,
    })
    .strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    for (const reference of context.document!.undefinedReferences) {
      if (reference.referenceType === "shortcut" && !options.includeShortcut) {
        continue;
      }
      const subject =
        reference.kind === "image" ? "Image reference" : "Reference";
      context.report({
        message: `${subject} "[${reference.label}]" has no definition, so it renders as literal text; add a "[${reference.label}]: <target>" definition or correct the label.`,
        line: reference.line,
        column: reference.column,
        data: {
          label: reference.label,
          kind: reference.kind,
          referenceType: reference.referenceType,
        },
      });
    }
  },
});

// The target strings REF-008 treats as missing. A bare `#` is a fragment with no anchor: the browser
// only scrolls to the top of the page, which is almost never what the author meant by a link, and
// REF-002 skips it because there is no anchor to check. `#top` and `./a.md#` are not bare and are
// left to the rules that resolve them.
const EMPTY_TARGETS: ReadonlySet<string> = new Set(["", "#"]);

// REF-008 — links and images have a target and use link syntax in the right order. An empty `()`
// or bare `(#)` target is skipped by REF-001, REF-002 and REF-003 (there is nothing to resolve), so
// without this rule a link that goes nowhere passes every check. Reversed `(text)[target]` is
// recorded by the parser as a `reversedLinks` entry because it renders as literal text and never
// becomes a link at all. Error severity because either way the page shows a dead link or stray
// punctuation, exactly as with REF-001; not fixable because a missing target cannot be invented and
// turning a parenthetical into a link is a judgement call.
export const ref008: RuleDefinition = defineRule({
  metadata: {
    id: "REF-008",
    category: "REF",
    description:
      "Links and images have a target and use link syntax in the right order.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z.object({ ...fileScopeShape }).strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    const document = context.document!;

    for (const link of document.links) {
      if (!EMPTY_TARGETS.has(link.rawTarget)) {
        continue;
      }
      const consequence =
        link.rawTarget === ""
          ? "has an empty target, so it goes nowhere"
          : 'has a bare "#" target, so it only jumps to the top of the page';
      context.report({
        message: `Link "[${link.text ?? ""}]" ${consequence}; add a target or remove the link.`,
        line: link.line,
        column: link.column,
        data: { problem: "empty-target", kind: "link", target: link.rawTarget },
      });
    }

    for (const image of document.images) {
      if (!EMPTY_TARGETS.has(image.rawTarget)) {
        continue;
      }
      const target = image.rawTarget === "" ? "an empty" : 'a bare "#"';
      context.report({
        message: `Image has ${target} target, so no image is shown; add a target or remove the image.`,
        line: image.line,
        column: image.column,
        data: {
          problem: "empty-target",
          kind: "image",
          target: image.rawTarget,
        },
      });
    }

    for (const reversed of document.reversedLinks) {
      context.report({
        message: `"(${reversed.text})[${reversed.target}]" is reversed link syntax and renders as literal text; write it as "[${reversed.text}](${reversed.target})".`,
        line: reversed.line,
        column: reversed.column,
        data: {
          problem: "reversed",
          text: reversed.text,
          target: reversed.target,
        },
      });
    }
  },
});

export const REF_RULES: readonly RuleDefinition[] = [
  ref001,
  ref002,
  ref003,
  ref004,
  ref005,
  ref006,
  ref007,
  ref008,
];
