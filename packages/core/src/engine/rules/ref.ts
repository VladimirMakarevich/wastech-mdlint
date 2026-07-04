import path from "node:path";

import { z } from "zod";

import { matchesConfigGlob, normalizeRelativePath } from "../../discovery/globs.js";
import type { ParsedDocument } from "../../markdown/document-types.js";
import { extractColumnIds, type IdOccurrence } from "../defined-ids.js";
import { filePart, resolveRelativeToSource, sourceLocale } from "../path-resolve.js";
import { imageResolves, linkResolves } from "../primitives/reference.js";
import { regexStringSchema } from "../regex.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { extractSectionBody } from "../section-body.js";
import { resolveRoutedUrl } from "../site-router.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";
import type { RuleContext, SiteRouterSettings } from "../types.js";

// Reference-integrity rules (P3.04). REF rules use the documents map + existsSync + site-router; no
// graph needed (that's GRP, P3.06).

const siteRouterOptionSchema = z
  .object({
    preset: z.string().optional(),
    contentDir: z.string().optional(),
    defaultLocale: z.string().optional()
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
    fixable: false
  },
  optionsSchema: z
    .object({ exclude: z.array(z.string()).optional(), siteRouter: siteRouterOptionSchema.optional() })
    .strict(),
  check: (options) => (context) => {
    for (const finding of linkResolves(
      context.document!,
      { documents: context.documents!, rootDir: context.rootDir!, settings: context.settings },
      { exclude: options.exclude, siteRouter: options.siteRouter }
    )) {
      context.report({ ...finding, helpUri: "REF-001" });
    }
  }
});

// Resolve a link target to a corpus document (relative → source dir; root-relative → site router).
function resolveTargetDoc(
  sourcePath: string,
  target: string,
  context: RuleContext,
  router?: SiteRouterSettings
): ParsedDocument | undefined {
  if (target.startsWith("/") && router !== undefined) {
    for (const candidate of resolveRoutedUrl(target, router, sourceLocale(sourcePath, router))) {
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

// REF-002 — link anchors match heading slugs (github-slugger). Same-file anchors validate against
// the doc's own slugs; cross-file anchors against the resolved target's slugs (missing target files
// are REF-001's concern, so they are skipped here).
export const ref002: RuleDefinition = defineRule({
  metadata: {
    id: "REF-002",
    category: "REF",
    description: "Link anchors match a heading slug.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false
  },
  optionsSchema: z.object({ siteRouter: siteRouterOptionSchema.optional(), ...fileScopeShape }).strict(),
  check: (options) => (context) => {
    if (!matchesFileScope(context.filePath!, options)) {
      return;
    }
    const document = context.document!;
    const router = options.siteRouter ?? context.settings.siteRouter;

    for (const link of document.links) {
      if (link.anchor === undefined || link.anchor.length === 0) {
        continue;
      }

      let target: ParsedDocument | undefined;
      if (link.kind === "same-file-anchor") {
        target = document;
      } else if (link.kind === "local-file") {
        target = resolveTargetDoc(document.path, filePart(link.rawTarget), context, router);
        if (target === undefined) {
          continue;
        }
      } else {
        continue;
      }

      if (!target.headings.some((heading) => heading.slug === link.anchor)) {
        context.report({
          message: `Anchor "#${link.anchor}" does not match any heading in ${target.path}.`,
          line: link.line,
          column: link.column,
          data: { anchor: link.anchor, targetPath: target.path },
          helpUri: "REF-002"
        });
      }
    }
  }
});

// REF-003 — images resolve on disk.
export const ref003: RuleDefinition = defineRule({
  metadata: {
    id: "REF-003",
    category: "REF",
    description: "Image targets resolve to a file.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false
  },
  optionsSchema: z.object({ exclude: z.array(z.string()).optional() }).strict(),
  check: (options) => (context) => {
    for (const finding of imageResolves(
      context.document!,
      { documents: context.documents!, rootDir: context.rootDir!, settings: context.settings },
      { exclude: options.exclude }
    )) {
      context.report({ ...finding, helpUri: "REF-003" });
    }
  }
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
// scope, but reads the corpus to learn zones + declarations (journal [P3.04] documents this
// interpretation of an underspecified rule).
export const ref004: RuleDefinition = defineRule({
  metadata: {
    id: "REF-004",
    category: "REF",
    description: "Cross-zone links are declared in the zone's Dependencies section.",
    defaultSeverity: "error",
    scope: "document",
    fixable: false
  },
  optionsSchema: z.object({ zonesDir: z.string().min(1), dependencySection: z.string().optional() }).strict(),
  check: (options) => (context) => {
    const document = context.document!;
    const sourceZone = zoneOf(document.path, options.zonesDir);
    if (sourceZone === undefined) {
      return;
    }

    const dependencyHeading = options.dependencySection ?? "Dependencies";
    const allZones = new Set<string>();
    for (const relPath of context.projectFiles ?? []) {
      const zone = zoneOf(relPath, options.zonesDir);
      if (zone !== undefined) {
        allZones.add(zone);
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
        for (const zone of allZones) {
          if (new RegExp(`(^|[^A-Za-z0-9_-])${zone}([^A-Za-z0-9_-]|$)`).test(body)) {
            declared.add(zone);
          }
        }
      }
    }

    for (const link of document.links) {
      if (link.kind !== "local-file") {
        continue;
      }
      const targetRel = resolveRelativeToSource(document.path, filePart(link.rawTarget));
      const targetZone = zoneOf(targetRel, options.zonesDir);
      if (targetZone === undefined || targetZone === sourceZone || declared.has(targetZone)) {
        continue;
      }
      context.report({
        message: `Cross-zone link to zone "${targetZone}" is not declared in the "${dependencyHeading}" section of zone "${sourceZone}".`,
        line: link.line,
        column: link.column,
        data: { fromZone: sourceZone, toZone: targetZone },
        helpUri: "REF-004"
      });
    }
  }
});

// REF-005 — ID traceability: every referenced ID has a definition (dangling ref = error) and every
// defined ID is referenced (orphan def = warning). Column-based discovery (audit 5.5) via the shared
// extractColumnIds helper.
export const ref005: RuleDefinition = defineRule({
  metadata: {
    id: "REF-005",
    category: "REF",
    description: "IDs are traceable between definitions and references.",
    defaultSeverity: "error",
    scope: "project",
    fixable: false
  },
  optionsSchema: z
    .object({
      definitions: z.array(z.string()).min(1),
      references: z.array(z.string()).min(1),
      idColumn: z.string().min(1),
      idPattern: regexStringSchema
    })
    .strict(),
  check: (options) => (context) => {
    const definitions = new Map<string, IdOccurrence>();
    const references: IdOccurrence[] = [];

    for (const document of context.documents!.values()) {
      for (const occurrence of extractColumnIds(document, {
        files: options.definitions,
        column: options.idColumn,
        idPattern: options.idPattern
      })) {
        if (!definitions.has(occurrence.id)) {
          definitions.set(occurrence.id, occurrence);
        }
      }
      references.push(
        ...extractColumnIds(document, {
          files: options.references,
          column: options.idColumn,
          idPattern: options.idPattern
        })
      );
    }

    const referencedIds = new Set(references.map((reference) => reference.id));

    // Dangling references (error).
    for (const reference of references) {
      if (!definitions.has(reference.id)) {
        context.report({
          message: `Reference "${reference.id}" has no definition.`,
          line: reference.line,
          filePath: reference.filePath,
          severity: "error",
          data: { id: reference.id },
          helpUri: "REF-005"
        });
      }
    }

    // Orphan definitions (warning).
    for (const [id, occurrence] of definitions) {
      if (!referencedIds.has(id)) {
        context.report({
          message: `Definition "${id}" is never referenced.`,
          line: occurrence.line,
          filePath: occurrence.filePath,
          severity: "warning",
          data: { id },
          helpUri: "REF-005"
        });
      }
    }
  }
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
    fixable: false
  },
  optionsSchema: z
    .object({
      stabilityColumn: z.string().min(1),
      stabilityOrder: z.array(z.string().min(1)).min(2),
      definitions: z.array(z.string()).min(1),
      references: z.array(z.string()).min(1),
      idColumn: z.string().min(1),
      idPattern: regexStringSchema.optional()
    })
    .strict(),
  check: (options) => (context) => {
    // stabilityOrder lists least → most stable; rank is the index.
    const rank = new Map(options.stabilityOrder.map((value, index) => [value, index]));
    const idPattern = options.idPattern ?? "^.+$";
    const definitionStability = new Map<string, string>();

    // Build id → stability from definition tables.
    for (const document of context.documents!.values()) {
      if (!matchesConfigGlob(document.path, options.definitions)) {
        continue;
      }
      for (const table of document.tables) {
        if (!table.headers.includes(options.idColumn) || !table.headers.includes(options.stabilityColumn)) {
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
        if (!table.headers.includes(options.idColumn) || !table.headers.includes(options.stabilityColumn)) {
          continue;
        }
        for (const row of table.rows) {
          const referencerStability = (row.cells[options.stabilityColumn] ?? "").trim();
          const referencerRank = rank.get(referencerStability);
          if (referencerRank === undefined) {
            continue;
          }
          const referencedIds = (row.cells[options.idColumn] ?? "")
            .split(/[\s,]+/)
            .filter((token) => token.length > 0 && idRegex.test(token));

          for (const referencedId of referencedIds) {
            const referencedStability = definitionStability.get(referencedId);
            const referencedRank = referencedStability === undefined ? undefined : rank.get(referencedStability);
            if (referencedRank !== undefined && referencedRank < referencerRank) {
              context.report({
                message: `Depends on "${referencedId}" (stability "${referencedStability}") which is less stable than this entry (stability "${referencerStability}").`,
                line: row.line,
                filePath: document.path,
                data: { referencedId, referencedStability, referencerStability },
                helpUri: "REF-006"
              });
            }
          }
        }
      }
    }
  }
});

export const REF_RULES: readonly RuleDefinition[] = [ref001, ref002, ref003, ref004, ref005, ref006];
