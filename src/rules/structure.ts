import { matchesConfigGlob } from "../discovery/globs.js";
import type { AuditConfig, DependencyGraph, Finding } from "../types.js";

const ORPHAN_RULE_ID = "structure/orphan-docs";
const CYCLE_RULE_ID = "graph/dependencies";

function buildIncomingEdgeCount(graph: DependencyGraph): Map<string, number> {
  const incoming = new Map(graph.nodes.map((node) => [node.path, 0]));

  for (const edge of graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  return incoming;
}

function getOrphanExemptionPatterns(config: AuditConfig): string[] {
  return [...new Set([...config.structure.orphanExemptions, ...config.llm.entrypoints])];
}

function isExemptFromOrphanRule(filePath: string, config: AuditConfig): boolean {
  return matchesConfigGlob(filePath, getOrphanExemptionPatterns(config));
}

function buildOrphanMessage(filePath: string): string {
  return `${filePath} has no incoming Markdown links. Link it from an index document, remove it, or keep it as standalone when future suppression support exists.`;
}

type TarjanState = {
  index: number;
  indices: Map<string, number>;
  lowLinks: Map<string, number>;
  stack: string[];
  onStack: Set<string>;
  components: string[][];
};

function buildAdjacency(graph: DependencyGraph): Map<string, string[]> {
  const adjacency = new Map(graph.nodes.map((node) => [node.path, [] as string[]]));

  for (const edge of graph.edges) {
    const neighbors = adjacency.get(edge.from);

    if (neighbors !== undefined) {
      neighbors.push(edge.to);
    }
  }

  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => left.localeCompare(right));
  }

  return adjacency;
}

function runTarjanVisit(nodePath: string, adjacency: Map<string, string[]>, state: TarjanState): void {
  state.indices.set(nodePath, state.index);
  state.lowLinks.set(nodePath, state.index);
  state.index += 1;
  state.stack.push(nodePath);
  state.onStack.add(nodePath);

  for (const neighborPath of adjacency.get(nodePath) ?? []) {
    if (!state.indices.has(neighborPath)) {
      runTarjanVisit(neighborPath, adjacency, state);
      state.lowLinks.set(
        nodePath,
        Math.min(state.lowLinks.get(nodePath) ?? 0, state.lowLinks.get(neighborPath) ?? 0)
      );
      continue;
    }

    if (state.onStack.has(neighborPath)) {
      state.lowLinks.set(
        nodePath,
        Math.min(state.lowLinks.get(nodePath) ?? 0, state.indices.get(neighborPath) ?? 0)
      );
    }
  }

  if (state.lowLinks.get(nodePath) !== state.indices.get(nodePath)) {
    return;
  }

  const component: string[] = [];

  while (state.stack.length > 0) {
    const stackNode = state.stack.pop()!;
    state.onStack.delete(stackNode);
    component.push(stackNode);

    if (stackNode === nodePath) {
      break;
    }
  }

  component.sort((left, right) => left.localeCompare(right));
  state.components.push(component);
}

function findStronglyConnectedComponents(graph: DependencyGraph): string[][] {
  const adjacency = buildAdjacency(graph);
  const state: TarjanState = {
    index: 0,
    indices: new Map(),
    lowLinks: new Map(),
    stack: [],
    onStack: new Set(),
    components: []
  };
  const nodePaths = [...adjacency.keys()].sort((left, right) => left.localeCompare(right));

  for (const nodePath of nodePaths) {
    if (!state.indices.has(nodePath)) {
      runTarjanVisit(nodePath, adjacency, state);
    }
  }

  return state.components
    .filter((component) => component.length > 1)
    .sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000")));
}

function findCyclePathForComponent(graph: DependencyGraph, component: string[]): string[] {
  const componentSet = new Set(component);
  const adjacency = buildAdjacency(graph);
  const startPath = component[0]!;
  const visited = new Set<string>([startPath]);
  const path = [startPath];

  const walk = (currentPath: string): string[] | undefined => {
    const neighbors = (adjacency.get(currentPath) ?? []).filter((neighbor) => componentSet.has(neighbor));

    for (const neighbor of neighbors) {
      if (neighbor === startPath && path.length > 1) {
        return [...path, startPath];
      }

      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      path.push(neighbor);
      const cyclePath = walk(neighbor);

      if (cyclePath !== undefined) {
        return cyclePath;
      }

      path.pop();
      visited.delete(neighbor);
    }

    return undefined;
  };

  return walk(startPath) ?? [...component, startPath];
}

function buildCycleMessage(cyclePath: string[]): string {
  return `Dependency cycle detected: ${cyclePath.join(" -> ")}.`;
}

export function checkStructureRules(params: {
  graph: DependencyGraph;
  config: AuditConfig;
}): Finding[] {
  const findings: Finding[] = [];

  if (params.config.structure.orphanDocs !== "off") {
    const incoming = buildIncomingEdgeCount(params.graph);

    for (const node of params.graph.nodes) {
      if ((incoming.get(node.path) ?? 0) > 0) {
        continue;
      }

      if (isExemptFromOrphanRule(node.path, params.config)) {
        continue;
      }

      findings.push({
        ruleId: ORPHAN_RULE_ID,
        severity: params.config.structure.orphanDocs,
        path: node.path,
        message: buildOrphanMessage(node.path)
      });
    }
  }

  for (const component of findStronglyConnectedComponents(params.graph)) {
    findings.push({
      ruleId: CYCLE_RULE_ID,
      severity: "warning",
      path: component[0]!,
      message: buildCycleMessage(findCyclePathForComponent(params.graph, component))
    });
  }

  findings.sort((left, right) => {
    return (
      left.path.localeCompare(right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
      left.ruleId.localeCompare(right.ruleId) ||
      left.message.localeCompare(right.message)
    );
  });

  return findings;
}
