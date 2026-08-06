import { z } from "zod";

import { matchesConfigGlob } from "../../discovery/globs.js";
import { extractColumnIds } from "../defined-ids.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { regexStringSchema } from "../regex.js";
import { fileScopeShape, matchesFileScope } from "./scope.js";

// Graph-integrity rules (P3.06). GRP-001/002 read the injected ContextGraph (audit 2.2) — no local
// adjacency. GRP-003 is graph-independent (walks chain columns).

// Distinct nodes a cycle must span before GRP-001 reports it. See the rationale above `grp001`.
export const DEFAULT_GRP001_MIN_CYCLE_LENGTH = 3;

// The document names that are entry points unless the config says otherwise (W-05). Slash-free by
// design: `normalizeConfigGlob` rewrites each to `**/<name>`, so a per-package `AGENTS.md` or a
// `docs/README.md` is exempt at any depth, not only at the repository root. Root-anchoring these
// would reproduce the defect for every repository that keeps its roots in subdirectories.
export const DEFAULT_GRP002_ENTRY_POINTS = [
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "index.md",
] as const;

// GRP-001 — no circular references. Reads the graph's explicit cycle list (G6).
//
// `minCycleLength` is the one wireable option, and the distinction from the keys [P11.13] removed is
// what makes it so: `files`/`exclude`/`siteRouter` had to reach `buildContextGraph` to mean anything,
// and cannot — the graph is corpus-wide and a resolved rule's options are closed over before the
// orchestrator builds it ([P4.06]) — so they validated into a no-op. This key filters the rule's *own*
// findings after the fact, which needs nothing from the builder. Narrowing what cycle detection sees
// still requires a graph-scoping design, not a schema key.
//
// The default of 3 excludes two-document mutual links (W-07). A README indexing its siblings while a
// sibling links back is a deliberate, recognizable documentation shape, and at `error` severity it
// failed the build — whose likely answer is disabling GRP-001 outright, forfeiting the genuine multi-hop
// cycles it also finds. Severity stays `error` because a 3+-hop cycle is worth failing on. Mutual eager
// `@import` is the one two-node case that is genuinely dangerous, and LLM-001 reports it independently
// of this option, so nothing loses its only home.
export const grp001: RuleDefinition = defineRule({
  metadata: {
    id: "GRP-001",
    category: "GRP",
    description: "No circular references between documents.",
    defaultSeverity: "error",
    scope: "project",
    fixable: false,
  },
  optionsSchema: z
    .object({
      minCycleLength: z
        .number()
        .int()
        .min(2)
        .default(DEFAULT_GRP001_MIN_CYCLE_LENGTH),
    })
    .strict(),
  check: (options) => (context) => {
    const graph = context.graph;
    if (graph === undefined) {
      return;
    }
    for (const cycle of graph.cycles) {
      // `cycles` entries are *closed* paths (the start node repeated at the end), so the distinct-node
      // count is one less than the array length. Only an approximation of "shortest cycle in this
      // component": `detectCycles` emits one representative path per SCC and `cyclePath` returns the
      // first cycle its DFS finds, not the shortest, so an SCC holding both a back-link and a longer
      // loop is judged by whichever path was extracted. Documented in the guide rather than implied to
      // be exact — computing the true girth per component is a different algorithm.
      if (cycle.length - 1 < options.minCycleLength) {
        continue;
      }
      const first = cycle[0]!;
      // Attribute to the first arc (audit): the edge from cycle[0] to cycle[1].
      const firstArc = graph.edges.find(
        (edge) => edge.from === first && edge.to === cycle[1],
      );
      context.report({
        message: `Dependency cycle detected: ${cycle.join(" -> ")}.`,
        line: firstArc?.line ?? 0,
        filePath: first,
        data: { cycle },
      });
    }
  },
});

// GRP-002 — every document has ≥1 incoming reference, except declared entry points. `files`/`exclude`
// are honored below as *reporting* scope (an out-of-scope file still contributes its outgoing edges);
// `siteRouter` was removed with GRP-001's dead keys ([P11.13]) since the shared graph already resolves
// routes from `settings.siteRouter`.
//
// A user `entryPoints` **replaces** the default rather than extending it (W-05) — deliberately unlike
// P13.02's extend semantics for the top-level `exclude`. There, dropping a default silently re-opened
// `node_modules`, which is the blocker that key exists to prevent; here the value is a list of roots
// the author knows, and extending would make "do not exempt README.md" inexpressible.
export const grp002: RuleDefinition = defineRule({
  metadata: {
    id: "GRP-002",
    category: "GRP",
    description:
      "Documents have at least one incoming reference (except entry points).",
    defaultSeverity: "warning",
    scope: "project",
    fixable: false,
  },
  optionsSchema: z
    .object({
      entryPoints: z
        .array(z.string())
        .default([...DEFAULT_GRP002_ENTRY_POINTS]),
      ...fileScopeShape,
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
      if (matchesConfigGlob(node.path, options.entryPoints)) {
        continue;
      }
      context.report({
        // Name the option that performs the exemption, not just the outcome: a reader told to "mark it
        // an entry point" had no way to learn from the finding which key does that (W-05).
        message: `${node.path} has no incoming references; link it from another document or add it to GRP-002's \`entryPoints\`.`,
        line: 0,
        filePath: node.path,
        data: { path: node.path },
      });
    }
  },
});

const chainStageSchema = z
  .object({
    stage: z.string().min(1),
    files: z.array(z.string()).min(1),
    idColumn: z.string().min(1).optional(),
    refColumn: z.string().min(1),
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
    fixable: false,
  },
  optionsSchema: z
    .object({
      chain: z.array(chainStageSchema).min(2),
      idPattern: regexStringSchema.optional(),
    })
    .strict(),
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
          idPattern,
        })) {
          nextReferences.add(occurrence.id);
        }
      }

      // Each current-stage id must appear there.
      for (const document of documents) {
        for (const occurrence of extractColumnIds(document, {
          files: current.files,
          column: current.idColumn,
          idPattern,
        })) {
          if (!nextReferences.has(occurrence.id)) {
            context.report({
              message: `ID "${occurrence.id}" from stage "${current.stage}" is not carried into stage "${next.stage}".`,
              line: occurrence.line,
              filePath: occurrence.filePath,
              data: {
                id: occurrence.id,
                fromStage: current.stage,
                toStage: next.stage,
              },
            });
          }
        }
      }
    }
  },
});

export const GRP_RULES: readonly RuleDefinition[] = [grp001, grp002, grp003];
