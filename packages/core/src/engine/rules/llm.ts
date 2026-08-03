import { z } from "zod";

import { compareStrings } from "../../deterministic-sort.js";
import {
  matchesConfigGlob,
  normalizeRelativePath,
} from "../../discovery/globs.js";
import type { ParsedDocument } from "../../markdown/document-types.js";
import { resolveTargetCandidates } from "../path-resolve.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { estimateTokens } from "../tokens.js";
import type { ReportInput, SiteRouterSettings } from "../types.js";

// LLM-001 — eager-import context budget per entrypoint (D3, P3.07). Single total budget
// (maxTokensPerEntrypoint) — parity with the legacy llm/budget; per-type limits are out of scope
// (audit 3.2). Traverses ParsedDocument.imports (one parse pass, P1) — it does not re-parse.

// Resolves an eager `@target` import through the same `resolveTargetCandidates` helper the
// ContextGraph builder (P4.01/P4.06) and REF-001/002 already use — not an ad hoc resolver. A
// root-relative import under a configured `siteRouter` must resolve identically here and in the
// graph's "import" edges; otherwise LLM-001's own traversal and compile's S6 budget (which walks
// those same edges) can silently disagree on what an entrypoint eagerly imports. Falls back to the
// first candidate when none resolve, so a genuinely missing import still reports a stable,
// deterministic `targetPath`.
function resolveImportTarget(
  sourcePath: string,
  rawTarget: string,
  documents: Map<string, ParsedDocument>,
  siteRouter: SiteRouterSettings | undefined,
): string {
  const target = rawTarget.replace(/^@/, "");
  const candidates = resolveTargetCandidates(sourcePath, target, siteRouter);
  return (
    candidates.find((candidate) => documents.has(candidate)) ??
    candidates[0] ??
    normalizeRelativePath(target)
  );
}

type EntrypointTraversal = {
  importedPaths: Set<string>;
  missing: {
    sourcePath: string;
    rawTarget: string;
    targetPath: string;
    line: number;
    column?: number;
  }[];
  cycles: { paths: string[]; sourcePath: string; line: number }[];
};

// Depth-first traversal of eager imports from one entrypoint, collecting reachable files, missing
// imports, and cycles (dedup per entrypoint).
//
// `visit` recurses once per hop along the current DFS path through the eager-import graph, so its
// stack depth is bounded by how many files one entrypoint transitively imports — not by any single
// authored chain, since `visited` is never unwound and a branching import tree descends just as far.
// Both are single digits in practice: `@path` imports are hand-authored, not a corpus-wide link
// graph. `visited`/`stack` already stop a cycle from recursing forever. The same accepted "no explicit
// depth guard" bound as the graph traversals applies (P12.05, finding SC-3), but this is the least
// exposed of the four sites.
function traverse(
  entrypoint: string,
  documents: Map<string, ParsedDocument>,
  siteRouter: SiteRouterSettings | undefined,
): EntrypointTraversal {
  const importedPaths = new Set<string>();
  const missing: EntrypointTraversal["missing"] = [];
  const cycles: EntrypointTraversal["cycles"] = [];
  const cycleKeys = new Set<string>();
  const visited = new Set<string>([entrypoint]);
  const stack = [entrypoint];

  const visit = (sourcePath: string): void => {
    for (const eagerImport of documents.get(sourcePath)?.imports ?? []) {
      const targetPath = resolveImportTarget(
        sourcePath,
        eagerImport.rawTarget,
        documents,
        siteRouter,
      );
      const targetDoc = documents.get(targetPath);

      if (targetDoc === undefined) {
        missing.push({
          sourcePath,
          rawTarget: eagerImport.rawTarget,
          targetPath,
          line: eagerImport.line,
          column: eagerImport.column,
        });
        continue;
      }

      if (stack.includes(targetPath)) {
        const cyclePaths = [
          ...stack.slice(stack.indexOf(targetPath)),
          targetPath,
        ];
        const key = cyclePaths.join(" ");
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push({
            paths: cyclePaths,
            sourcePath,
            line: eagerImport.line,
          });
        }
        continue;
      }

      if (targetPath !== entrypoint) {
        importedPaths.add(targetPath);
      }
      if (visited.has(targetPath)) {
        continue;
      }
      visited.add(targetPath);
      stack.push(targetPath);
      visit(targetPath);
      stack.pop();
    }
  };

  visit(entrypoint);
  return { importedPaths, missing, cycles };
}

// Collected instead of reported inline so the rule can suppress cross-entrypoint duplicates (audit
// L-3): entrypoints with overlapping import closures re-derive the same missing-import/cycle
// diagnostic once per traversal. `filePath` is required — LLM-001 is a project rule, so every
// finding self-attributes to the file it is about rather than inheriting a current document.
type PendingFinding = ReportInput & { filePath: string };

// Stable identity of a diagnostic: its location plus its rendered message. Every LLM-001 `data`
// payload is derived 1:1 from the message it accompanies (raw/resolved target, cycle path), so equal
// keys carry equal payloads and dropping a duplicate cannot lose information. A looser key (file +
// line only) would collapse genuinely different diagnostics that share a position.
function findingKey(finding: PendingFinding): string {
  // NUL-joined because both paths and messages contain spaces: a space-separated key is not
  // injective and could fuse two distinct findings into one.
  return [
    finding.filePath,
    finding.line,
    finding.column ?? "",
    finding.message,
  ].join("\u0000");
}

function comparePendingFindings(
  left: PendingFinding,
  right: PendingFinding,
): number {
  return (
    compareStrings(left.filePath, right.filePath) ||
    left.line - right.line ||
    (left.column ?? 0) - (right.column ?? 0) ||
    compareStrings(left.message, right.message)
  );
}

// Pure per-entrypoint collection (parsed inputs in, structured findings out): it takes the
// `siteRouter` setting rather than the whole `RuleContext`, so it cannot report and the caller owns
// the reporting boundary where dedup happens.
function collectEntrypointFindings(
  entrypoint: string,
  entrypointDoc: ParsedDocument,
  documents: Map<string, ParsedDocument>,
  maxTokens: number,
  siteRouter: SiteRouterSettings | undefined,
): PendingFinding[] {
  const findings: PendingFinding[] = [];
  const traversal = traverse(entrypoint, documents, siteRouter);

  let totalTokens = estimateTokens(entrypointDoc.content);
  for (const importedPath of traversal.importedPaths) {
    totalTokens += estimateTokens(documents.get(importedPath)?.content ?? "");
  }

  if (totalTokens > maxTokens) {
    const percentOver = (((totalTokens - maxTokens) / maxTokens) * 100).toFixed(
      1,
    );
    findings.push({
      message: `Entrypoint ${entrypoint} is over context budget: ${totalTokens} estimated tokens exceeds ${maxTokens} (${percentOver}% over).`,
      line: 0,
      filePath: entrypoint,
      data: {
        totalTokens,
        maxTokens,
        importedFiles: traversal.importedPaths.size,
      },
      helpUri: "LLM-001",
    });
  }

  for (const missing of traversal.missing) {
    findings.push({
      message: `Missing eager import ${missing.rawTarget}; resolved to ${missing.targetPath}.`,
      line: missing.line,
      column: missing.column,
      filePath: missing.sourcePath,
      data: { rawTarget: missing.rawTarget, targetPath: missing.targetPath },
      helpUri: "LLM-001",
    });
  }

  for (const cycle of traversal.cycles) {
    findings.push({
      message: `Eager import cycle detected: ${cycle.paths.join(" -> ")}.`,
      line: cycle.line,
      filePath: cycle.sourcePath,
      data: { cycle: cycle.paths },
      helpUri: "LLM-001",
    });
  }

  return findings;
}

export const llm001: RuleDefinition = defineRule({
  metadata: {
    id: "LLM-001",
    category: "LLM",
    description:
      "Eager-import context stays within the per-entrypoint token budget.",
    defaultSeverity: "warning",
    scope: "project",
    fixable: false,
  },
  optionsSchema: z
    .object({
      entrypoints: z.array(z.string()).min(1),
      maxTokensPerEntrypoint: z.number().int().positive(),
    })
    .strict(),
  check: (options) => (context) => {
    const documents = context.documents!;
    const entrypoints = [...documents.keys()]
      .filter((filePath) => matchesConfigGlob(filePath, options.entrypoints))
      .sort(compareStrings);

    // First writer wins per identity. Entrypoints are traversed in sorted order and equal keys carry
    // equal payloads, so the retained finding never depends on which entrypoint reached the
    // diagnostic first. A cycle is *not* rotation-normalized: entering the same loop at a different
    // node closes it on a different import edge, which is a different file and line the user still
    // has to fix, so those stay separate findings.
    const findings = new Map<string, PendingFinding>();
    for (const entrypoint of entrypoints) {
      for (const finding of collectEntrypointFindings(
        entrypoint,
        documents.get(entrypoint)!,
        documents,
        options.maxTokensPerEntrypoint,
        context.settings.siteRouter,
      )) {
        const key = findingKey(finding);
        if (!findings.has(key)) {
          findings.set(key, finding);
        }
      }
    }

    // Sorted here rather than relying on the runner's own sort, so emission order is a property of
    // the rule instead of Map insertion (i.e. entrypoint iteration) order.
    for (const finding of [...findings.values()].sort(comparePendingFindings)) {
      context.report(finding);
    }
  },
});

export const LLM_RULES: readonly RuleDefinition[] = [llm001];
