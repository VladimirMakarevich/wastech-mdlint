import { z } from "zod";

import { matchesConfigGlob, normalizeRelativePath } from "../../discovery/globs.js";
import type { ParsedDocument } from "../../markdown/document-types.js";
import { resolveTargetCandidates } from "../path-resolve.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { estimateTokens } from "../tokens.js";
import type { RuleContext, SiteRouterSettings } from "../types.js";

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
  siteRouter: SiteRouterSettings | undefined
): string {
  const target = rawTarget.replace(/^@/, "");
  const candidates = resolveTargetCandidates(sourcePath, target, siteRouter);
  return candidates.find((candidate) => documents.has(candidate)) ?? candidates[0] ?? normalizeRelativePath(target);
}

type EntrypointTraversal = {
  importedPaths: Set<string>;
  missing: { sourcePath: string; rawTarget: string; targetPath: string; line: number; column?: number }[];
  cycles: { paths: string[]; sourcePath: string; line: number }[];
};

// Depth-first traversal of eager imports from one entrypoint, collecting reachable files, missing
// imports, and cycles (dedup per entrypoint).
function traverse(
  entrypoint: string,
  documents: Map<string, ParsedDocument>,
  siteRouter: SiteRouterSettings | undefined
): EntrypointTraversal {
  const importedPaths = new Set<string>();
  const missing: EntrypointTraversal["missing"] = [];
  const cycles: EntrypointTraversal["cycles"] = [];
  const cycleKeys = new Set<string>();
  const visited = new Set<string>([entrypoint]);
  const stack = [entrypoint];

  const visit = (sourcePath: string): void => {
    for (const eagerImport of documents.get(sourcePath)?.imports ?? []) {
      const targetPath = resolveImportTarget(sourcePath, eagerImport.rawTarget, documents, siteRouter);
      const targetDoc = documents.get(targetPath);

      if (targetDoc === undefined) {
        missing.push({
          sourcePath,
          rawTarget: eagerImport.rawTarget,
          targetPath,
          line: eagerImport.line,
          column: eagerImport.column
        });
        continue;
      }

      if (stack.includes(targetPath)) {
        const cyclePaths = [...stack.slice(stack.indexOf(targetPath)), targetPath];
        const key = cyclePaths.join(" ");
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push({ paths: cyclePaths, sourcePath, line: eagerImport.line });
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

function reportEntrypoint(
  context: RuleContext,
  entrypoint: string,
  entrypointDoc: ParsedDocument,
  documents: Map<string, ParsedDocument>,
  maxTokens: number
): void {
  const traversal = traverse(entrypoint, documents, context.settings.siteRouter);

  let totalTokens = estimateTokens(entrypointDoc.content);
  for (const importedPath of traversal.importedPaths) {
    totalTokens += estimateTokens(documents.get(importedPath)?.content ?? "");
  }

  if (totalTokens > maxTokens) {
    const percentOver = (((totalTokens - maxTokens) / maxTokens) * 100).toFixed(1);
    context.report({
      message: `Entrypoint ${entrypoint} is over context budget: ${totalTokens} estimated tokens exceeds ${maxTokens} (${percentOver}% over).`,
      line: 0,
      filePath: entrypoint,
      data: { totalTokens, maxTokens, importedFiles: traversal.importedPaths.size },
      helpUri: "LLM-001"
    });
  }

  for (const missing of traversal.missing) {
    context.report({
      message: `Missing eager import ${missing.rawTarget}; resolved to ${missing.targetPath}.`,
      line: missing.line,
      column: missing.column,
      filePath: missing.sourcePath,
      data: { rawTarget: missing.rawTarget, targetPath: missing.targetPath },
      helpUri: "LLM-001"
    });
  }

  for (const cycle of traversal.cycles) {
    context.report({
      message: `Eager import cycle detected: ${cycle.paths.join(" -> ")}.`,
      line: cycle.line,
      filePath: cycle.sourcePath,
      data: { cycle: cycle.paths },
      helpUri: "LLM-001"
    });
  }
}

export const llm001: RuleDefinition = defineRule({
  metadata: {
    id: "LLM-001",
    category: "LLM",
    description: "Eager-import context stays within the per-entrypoint token budget.",
    defaultSeverity: "warning",
    scope: "project",
    fixable: false
  },
  optionsSchema: z
    .object({
      entrypoints: z.array(z.string()).min(1),
      maxTokensPerEntrypoint: z.number().int().positive()
    })
    .strict(),
  check: (options) => (context) => {
    const documents = context.documents!;
    const entrypoints = [...documents.keys()]
      .filter((filePath) => matchesConfigGlob(filePath, options.entrypoints))
      .sort((left, right) => left.localeCompare(right));

    for (const entrypoint of entrypoints) {
      reportEntrypoint(context, entrypoint, documents.get(entrypoint)!, documents, options.maxTokensPerEntrypoint);
    }
  }
});

export const LLM_RULES: readonly RuleDefinition[] = [llm001];
