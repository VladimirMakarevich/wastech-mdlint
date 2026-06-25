import type {
  AuditResult,
  AuditResultFile,
  DependencyGraph,
  EntrypointBudget,
  Finding,
  FindingSeverity,
  MarkdownFile
} from "../types.js";

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2
};

function normalizeDisplayPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    return (
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
      left.path.localeCompare(right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.message.localeCompare(right.message)
    );
  });
}

function serializeFiles(files: MarkdownFile[]): AuditResultFile[] {
  return files
    .map((file) => ({
      path: file.path,
      bytes: file.bytes
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sortBudgets(budgets: EntrypointBudget[]): EntrypointBudget[] {
  return [...budgets].sort((left, right) => left.entrypoint.localeCompare(right.entrypoint));
}

function countFindingsBySeverity(findings: Finding[]): AuditResult["summary"]["findings"] {
  return findings.reduce(
    (summary, finding) => {
      summary[finding.severity] += 1;
      return summary;
    },
    {
      error: 0,
      warning: 0,
      info: 0
    }
  );
}

function countGraphCycles(graph: DependencyGraph): number {
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    adjacency.set(node.path, []);
  }

  for (const edge of graph.edges) {
    const edges = adjacency.get(edge.from);

    if (edges !== undefined) {
      edges.push(edge.to);
      edges.sort((left, right) => left.localeCompare(right));
    }
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  let cycleCount = 0;

  const visitNode = (nodePath: string) => {
    visited.add(nodePath);
    inStack.add(nodePath);

    for (const nextPath of adjacency.get(nodePath) ?? []) {
      if (!visited.has(nextPath)) {
        visitNode(nextPath);
        continue;
      }

      if (inStack.has(nextPath)) {
        cycleCount += 1;
      }
    }

    inStack.delete(nodePath);
  };

  for (const node of graph.nodes) {
    if (!visited.has(node.path)) {
      visitNode(node.path);
    }
  }

  return cycleCount;
}

function countOrphans(graph: DependencyGraph): number {
  const incoming = new Map(graph.nodes.map((node) => [node.path, 0]));

  for (const edge of graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  return [...incoming.values()].filter((count) => count === 0).length;
}

function formatFindingLocation(finding: Finding): string {
  if (finding.line === undefined) {
    return finding.path;
  }

  if (finding.column === undefined) {
    return `${finding.path}:${finding.line}`;
  }

  return `${finding.path}:${finding.line}:${finding.column}`;
}

function renderFindingSection(severity: FindingSeverity, findings: Finding[]): string[] {
  if (findings.length === 0) {
    return [];
  }

  const label = severity[0]!.toUpperCase() + severity.slice(1);
  const lines = [`${label}s (${findings.length})`];
  let currentRuleId: string | undefined;

  for (const finding of findings) {
    if (finding.ruleId !== currentRuleId) {
      currentRuleId = finding.ruleId;
      lines.push(`${currentRuleId}`);
    }

    lines.push(`- ${formatFindingLocation(finding)} ${finding.message}`);
  }

  return lines;
}

export function createAuditResult(params: {
  rootPath: string;
  files: MarkdownFile[];
  findings: Finding[];
  graph: DependencyGraph;
  budgets: EntrypointBudget[];
}): AuditResult {
  const findings = sortFindings(params.findings);
  const files = serializeFiles(params.files);
  const budgets = sortBudgets(params.budgets);

  return {
    summary: {
      root: normalizeDisplayPath(params.rootPath),
      files: files.length,
      findings: countFindingsBySeverity(findings)
    },
    findings,
    files,
    graph: params.graph,
    budgets
  };
}

export function renderAuditResultJson(result: AuditResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function renderAuditResultText(result: AuditResult, orphanSeverity: string): string {
  const budgetOverLimitCount = result.budgets.filter((budget) => budget.overLimit).length;
  const warnings = result.findings.filter((finding) => finding.severity === "warning");
  const errors = result.findings.filter((finding) => finding.severity === "error");
  const infos = result.findings.filter((finding) => finding.severity === "info");
  const sections = [
    renderFindingSection("error", errors),
    renderFindingSection("warning", warnings),
    renderFindingSection("info", infos)
  ].filter((section) => section.length > 0);
  const lines = [
    "Markdown Context Audit",
    `Root: ${result.summary.root}`,
    `Files: ${result.summary.files}`,
    `Findings: ${result.summary.findings.error} error, ${result.summary.findings.warning} warning, ${result.summary.findings.info} info`,
    `Graph: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges, ${countOrphans(result.graph)} orphan docs (${orphanSeverity}), ${countGraphCycles(result.graph)} cycles`,
    `Budgets: ${result.budgets.length} entrypoints, ${budgetOverLimitCount} over limit`
  ];

  if (result.findings.length === 0) {
    lines.push("No findings.");
    return `${lines.join("\n")}\n`;
  }

  return `${lines.concat("", ...sections.flatMap((section) => [...section, ""])).join("\n").trimEnd()}\n`;
}
