import { z } from "zod";

import { matchesConfigGlob } from "../../discovery/globs.js";
import { extractColumnIds } from "../defined-ids.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { regexStringSchema } from "../regex.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";

// Graph-integrity rules (P3.06). GRP-001/002 read the injected ContextGraph (audit 2.2) — no local
// adjacency. GRP-003 is graph-independent (walks chain columns).

const siteRouterOptionSchema = z
  .object({ preset: z.string().optional(), contentDir: z.string().optional(), defaultLocale: z.string().optional() })
  .strict();

// GRP-001 — no circular references. Reads the graph's explicit cycle list (G6). `files`/`exclude`/
// `siteRouter` are accepted for forward-compat but do not re-scope the shared corpus-wide graph in
// P3 (journal [P3.06]).
export const grp001: RuleDefinition = defineRule({
  metadata: {
    id: "GRP-001",
    category: "GRP",
    description: "No circular references between documents.",
    defaultSeverity: "error",
    scope: "project",
    fixable: false
  },
  optionsSchema: z.object({ siteRouter: siteRouterOptionSchema.optional(), ...fileScopeShape }).strict(),
  check: () => (context) => {
    const graph = context.graph;
    if (graph === undefined) {
      return;
    }
    for (const cycle of graph.cycles) {
      const first = cycle[0]!;
      // Attribute to the first arc (audit): the edge from cycle[0] to cycle[1].
      const firstArc = graph.edges.find((edge) => edge.from === first && edge.to === cycle[1]);
      context.report({
        message: `Dependency cycle detected: ${cycle.join(" -> ")}.`,
        line: firstArc?.line ?? 0,
        filePath: first,
        data: { cycle },
        helpUri: "GRP-001"
      });
    }
  }
});

// GRP-002 — every document has ≥1 incoming reference, except declared entry points.
export const grp002: RuleDefinition = defineRule({
  metadata: {
    id: "GRP-002",
    category: "GRP",
    description: "Documents have at least one incoming reference (except entry points).",
    defaultSeverity: "warning",
    scope: "project",
    fixable: false
  },
  optionsSchema: z
    .object({
      entryPoints: z.array(z.string()).optional(),
      siteRouter: siteRouterOptionSchema.optional(),
      ...fileScopeShape
    })
    .strict(),
  check: (options) => (context) => {
    const graph = context.graph;
    if (graph === undefined) {
      return;
    }
    for (const node of graph.nodes) {
      if (node.inDegree > 0) {
        continue;
      }
      if (!matchesFileScope(node.path, options)) {
        continue;
      }
      if (options.entryPoints !== undefined && matchesConfigGlob(node.path, options.entryPoints)) {
        continue;
      }
      context.report({
        message: `${node.path} has no incoming references; link it from another document or mark it an entry point.`,
        line: 0,
        filePath: node.path,
        data: { path: node.path },
        helpUri: "GRP-002"
      });
    }
  }
});

const chainStageSchema = z
  .object({
    stage: z.string().min(1),
    files: z.array(z.string()).min(1),
    idColumn: z.string().min(1).optional(),
    refColumn: z.string().min(1)
  })
  .strict();

// GRP-003 — ID chain across stages: every stage-N id must be referenced at stage N+1 (graph-
// independent; walks the declared columns).
export const grp003: RuleDefinition = defineRule({
  metadata: {
    id: "GRP-003",
    category: "GRP",
    description: "IDs are carried forward across pipeline stages.",
    defaultSeverity: "warning",
    scope: "project",
    fixable: false
  },
  optionsSchema: z.object({ chain: z.array(chainStageSchema).min(2), idPattern: regexStringSchema.optional() }).strict(),
  check: (options) => (context) => {
    const idPattern = options.idPattern ?? "^.+$";
    const documents = [...context.documents!.values()];

    for (let index = 0; index < options.chain.length - 1; index += 1) {
      const current = options.chain[index]!;
      const next = options.chain[index + 1]!;
      if (current.idColumn === undefined) {
        continue;
      }

      // IDs referenced at the next stage (its refColumn).
      const nextReferences = new Set<string>();
      for (const document of documents) {
        for (const occurrence of extractColumnIds(document, {
          files: next.files,
          column: next.refColumn,
          idPattern
        })) {
          nextReferences.add(occurrence.id);
        }
      }

      // Each current-stage id must appear there.
      for (const document of documents) {
        for (const occurrence of extractColumnIds(document, {
          files: current.files,
          column: current.idColumn,
          idPattern
        })) {
          if (!nextReferences.has(occurrence.id)) {
            context.report({
              message: `ID "${occurrence.id}" from stage "${current.stage}" is not carried into stage "${next.stage}".`,
              line: occurrence.line,
              filePath: occurrence.filePath,
              data: { id: occurrence.id, fromStage: current.stage, toStage: next.stage },
              helpUri: "GRP-003"
            });
          }
        }
      }
    }
  }
});

export const GRP_RULES: readonly RuleDefinition[] = [grp001, grp002, grp003];
