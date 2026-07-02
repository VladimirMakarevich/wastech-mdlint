import { estimateTokens } from "../rules/size.js";
import type {
  AuditConfig,
  EntrypointBudget,
  EntrypointBudgetImportedFile,
  Finding,
  LlmImportGraph,
  MarkdownFile
} from "../types.js";

const RULE_ID = "llm/context-budget";

function getEstimatedTokens(file: MarkdownFile): number {
  return estimateTokens(file.text ?? "");
}

function formatPercentOver(totalEstimatedTokens: number, maxTokens: number): string {
  const percentOver = ((totalEstimatedTokens - maxTokens) / maxTokens) * 100;
  return percentOver.toFixed(1);
}

function formatBudgetMessage(params: {
  entrypoint: string;
  totalEstimatedTokens: number;
  maxTokens: number;
}): string {
  return `Entrypoint ${params.entrypoint} is over context budget: ${params.totalEstimatedTokens} estimated tokens exceeds ${params.maxTokens} (${formatPercentOver(params.totalEstimatedTokens, params.maxTokens)}% over).`;
}

export function buildEntrypointBudgets(params: {
  files: MarkdownFile[];
  config: AuditConfig;
  importGraph: LlmImportGraph;
}): {
  budgets: EntrypointBudget[];
  findings: Finding[];
} {
  const fileMap = new Map(params.files.map((file) => [file.path, file]));
  const traversalMap = new Map(
    params.importGraph.traversals.map((traversal) => [traversal.entrypointPath, traversal])
  );
  const budgets: EntrypointBudget[] = [];
  const findings: Finding[] = [];

  for (const entrypoint of params.importGraph.entrypoints) {
    const entrypointFile = fileMap.get(entrypoint);

    if (entrypointFile === undefined) {
      continue;
    }

    const traversal = traversalMap.get(entrypoint);
    const importedFiles: EntrypointBudgetImportedFile[] = (traversal?.importedPaths ?? [])
      .map((importedPath) => fileMap.get(importedPath))
      .filter((file): file is MarkdownFile => file !== undefined)
      .map((file) => ({
        path: file.path,
        bytes: file.bytes,
        estimatedTokens: getEstimatedTokens(file)
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const ownEstimatedTokens = getEstimatedTokens(entrypointFile);
    const totalBytes = entrypointFile.bytes + importedFiles.reduce((sum, file) => sum + file.bytes, 0);
    const totalEstimatedTokens =
      ownEstimatedTokens + importedFiles.reduce((sum, file) => sum + file.estimatedTokens, 0);
    const maxTokens = params.config.llm.maxTokensPerEntrypoint;
    const overLimit = totalEstimatedTokens > maxTokens;

    budgets.push({
      entrypoint,
      ownBytes: entrypointFile.bytes,
      ownEstimatedTokens,
      importedFiles,
      totalBytes,
      totalEstimatedTokens,
      maxTokens,
      overLimit,
      cycles: traversal?.cycles ?? [],
      missingImports: traversal?.missingImports ?? []
    });

    if (!overLimit) {
      continue;
    }

    findings.push({
      ruleId: RULE_ID,
      severity: "warning",
      path: entrypoint,
      message: formatBudgetMessage({
        entrypoint,
        totalEstimatedTokens,
        maxTokens
      })
    });
  }

  budgets.sort((left, right) => left.entrypoint.localeCompare(right.entrypoint));
  findings.sort((left, right) => {
    return (
      left.path.localeCompare(right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.message.localeCompare(right.message)
    );
  });

  return {
    budgets,
    findings
  };
}
