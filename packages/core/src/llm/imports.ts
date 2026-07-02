import path from "node:path";

import type { Root, Text } from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";

import { matchesConfigGlob, normalizeRelativePath } from "../discovery/globs.js";
import type {
  AuditConfig,
  EntrypointImportGraph,
  Finding,
  LlmImport,
  LlmImportCycle,
  LlmImportEdge,
  LlmImportGraph,
  MarkdownFile
} from "../types.js";

const markdownProcessor = remark().use(remarkParse).use(remarkGfm);
const IMPORT_PATTERN = /(^|[\s(])@(?<target>\/?[^\s@]+?\.md)\b/gm;

function resolveImportTarget(sourcePath: string, rawTarget: string): string {
  if (rawTarget.startsWith("/")) {
    return normalizeRelativePath(path.posix.normalize(rawTarget.slice(1)));
  }

  const sourceDirectory = path.posix.dirname(sourcePath);
  return normalizeRelativePath(path.posix.normalize(path.posix.join(sourceDirectory, rawTarget)));
}

function extractImportsFromTree(tree: Root, sourcePath: string): LlmImport[] {
  const imports: LlmImport[] = [];

  visit(tree, "text", (node: Text) => {
    const matches = node.value.matchAll(IMPORT_PATTERN);

    for (const match of matches) {
      const rawTarget = match.groups?.target;

      if (rawTarget === undefined) {
        continue;
      }

      const matchIndex = match.index ?? 0;
      const rawStartIndex = match[0].lastIndexOf(`@${rawTarget}`);
      const startColumn = (node.position?.start.column ?? 1) + matchIndex + rawStartIndex;

      imports.push({
        sourcePath,
        rawTarget: `@${rawTarget}`,
        targetPath: resolveImportTarget(sourcePath, rawTarget),
        line: node.position?.start.line,
        column: startColumn
      });
    }
  });

  return imports.sort((left, right) => {
    return (
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
      left.rawTarget.localeCompare(right.rawTarget)
    );
  });
}

function createCycleKey(paths: string[]): string {
  return paths.join("\u0000");
}

function normalizeCycle(paths: string[]): string[] {
  const cycleNodes = paths.slice(0, -1);

  if (cycleNodes.length === 0) {
    return paths;
  }

  let bestRotation = cycleNodes;

  for (let index = 1; index < cycleNodes.length; index += 1) {
    const rotated = cycleNodes.slice(index).concat(cycleNodes.slice(0, index));

    if (rotated.join("\u0000").localeCompare(bestRotation.join("\u0000")) < 0) {
      bestRotation = rotated;
    }
  }

  return [...bestRotation, bestRotation[0]!];
}

function buildCycle(stack: string[], targetPath: string): string[] {
  const cycleStartIndex = stack.indexOf(targetPath);
  const cycle = stack.slice(cycleStartIndex).concat(targetPath);
  return normalizeCycle(cycle);
}

function buildCycleMessage(paths: string[]): string {
  return `Eager import cycle detected: ${paths.join(" -> ")}.`;
}

function buildMissingImportMessage(importRef: LlmImport): string {
  return `Missing eager import ${importRef.rawTarget}; resolved to ${importRef.targetPath}.`;
}

function collectEntrypointPaths(files: MarkdownFile[], config: AuditConfig): string[] {
  return files
    .map((file) => file.path)
    .filter((filePath) => matchesConfigGlob(filePath, config.llm.entrypoints))
    .sort((left, right) => left.localeCompare(right));
}

function buildFileMap(files: MarkdownFile[]): Map<string, MarkdownFile> {
  return new Map(files.map((file) => [file.path, file]));
}

function buildImportMap(files: MarkdownFile[]): Map<string, LlmImport[]> {
  const importsByFile = new Map<string, LlmImport[]>();

  for (const file of files) {
    const tree = markdownProcessor.parse(file.text ?? "") as Root;
    importsByFile.set(file.path, extractImportsFromTree(tree, file.path));
  }

  return importsByFile;
}

export function analyzeLlmImports(params: {
  files: MarkdownFile[];
  config: AuditConfig;
}): {
  findings: Finding[];
  importGraph: LlmImportGraph;
} {
  const fileMap = buildFileMap(params.files);
  const entrypoints = collectEntrypointPaths(params.files, params.config);
  const importsByFile = buildImportMap(params.files);
  const importEdgeKeys = new Set<string>();
  const allImports = [...importsByFile.values()].flat().sort((left, right) => {
    return (
      left.sourcePath.localeCompare(right.sourcePath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
      left.rawTarget.localeCompare(right.rawTarget)
    );
  });
  const findings: Finding[] = [];
  const traversals: EntrypointImportGraph[] = [];

  for (const entrypointPath of entrypoints) {
    const importedPaths = new Set<string>();
    const missingImports: LlmImport[] = [];
    const cycles: LlmImportCycle[] = [];
    const cycleKeys = new Set<string>();
    const visited = new Set<string>([entrypointPath]);
    const stack = [entrypointPath];

    const visitFile = (sourcePath: string) => {
      const imports = importsByFile.get(sourcePath) ?? [];

      for (const importRef of imports) {
        const targetFile = fileMap.get(importRef.targetPath);

        if (targetFile === undefined) {
          missingImports.push(importRef);
          findings.push({
            ruleId: "llm/eager-imports",
            severity: "warning",
            path: importRef.sourcePath,
            line: importRef.line,
            column: importRef.column,
            message: buildMissingImportMessage(importRef)
          });
          continue;
        }

        importEdgeKeys.add(`${importRef.sourcePath}\u0000${importRef.targetPath}\u0000eager-import`);

        if (stack.includes(importRef.targetPath)) {
          const cyclePaths = buildCycle(stack, importRef.targetPath);
          const cycleKey = createCycleKey(cyclePaths);

          if (!cycleKeys.has(cycleKey)) {
            cycleKeys.add(cycleKey);
            cycles.push({
              paths: cyclePaths,
              sourcePath: importRef.sourcePath,
              line: importRef.line,
              column: importRef.column
            });
            findings.push({
              ruleId: "llm/eager-imports",
              severity: "warning",
              path: importRef.sourcePath,
              line: importRef.line,
              column: importRef.column,
              message: buildCycleMessage(cyclePaths)
            });
          }

          continue;
        }

        if (importRef.targetPath !== entrypointPath) {
          importedPaths.add(importRef.targetPath);
        }

        if (visited.has(importRef.targetPath)) {
          continue;
        }

        visited.add(importRef.targetPath);
        stack.push(importRef.targetPath);
        visitFile(importRef.targetPath);
        stack.pop();
      }
    };

    visitFile(entrypointPath);

    traversals.push({
      entrypointPath,
      importedPaths: [...importedPaths].sort((left, right) => left.localeCompare(right)),
      missingImports: missingImports.sort((left, right) => {
        return (
          left.sourcePath.localeCompare(right.sourcePath) ||
          (left.line ?? 0) - (right.line ?? 0) ||
          (left.column ?? 0) - (right.column ?? 0) ||
          left.rawTarget.localeCompare(right.rawTarget)
        );
      }),
      cycles: cycles.sort((left, right) => createCycleKey(left.paths).localeCompare(createCycleKey(right.paths)))
    });
  }

  const edges: LlmImportEdge[] = [...importEdgeKeys]
    .map((edgeKey) => {
      const [from, to] = edgeKey.split("\u0000");

      return {
        from,
        to,
        kind: "eager-import" as const
      };
    })
    .sort((left, right) => {
      return (
        left.from.localeCompare(right.from) ||
        left.to.localeCompare(right.to) ||
        left.kind.localeCompare(right.kind)
      );
    });

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
    findings,
    importGraph: {
      entrypoints,
      imports: allImports,
      edges,
      traversals
    }
  };
}
