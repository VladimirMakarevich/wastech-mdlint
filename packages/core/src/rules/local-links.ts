import path from "node:path";

import type { AnchorIndex, Finding, MarkdownFile, MarkdownLink } from "../types.js";

const RULE_ID = "links/broken-links";

function isInsideScanRoot(targetPath: string): boolean {
  const normalized = path.posix.normalize(targetPath);

  return normalized !== ".." && !normalized.startsWith("../") && !path.posix.isAbsolute(normalized);
}

function isMarkdownTarget(targetPath: string | undefined): targetPath is string {
  return targetPath !== undefined && targetPath.toLowerCase().endsWith(".md");
}

function getKnownFilePaths(files: MarkdownFile[]): Set<string> {
  return new Set(files.map((file) => file.path));
}

function buildMissingFileFinding(link: MarkdownLink): Finding {
  return {
    ruleId: RULE_ID,
    severity: "warning",
    path: link.sourcePath,
    line: link.line,
    column: link.column,
    message: `Broken local link "${link.rawTarget}": target file not found.`
  };
}

function buildMissingAnchorFinding(link: MarkdownLink, targetPath: string): Finding {
  return {
    ruleId: RULE_ID,
    severity: "warning",
    path: link.sourcePath,
    line: link.line,
    column: link.column,
    message: `Broken local link "${link.rawTarget}": anchor "${link.anchor}" not found in ${targetPath}.`
  };
}

export function checkLocalLinks(params: {
  files: MarkdownFile[];
  links: MarkdownLink[];
  anchorIndex: AnchorIndex;
}): Finding[] {
  const knownFiles = getKnownFilePaths(params.files);
  const findings: Finding[] = [];

  for (const link of params.links) {
    if (link.kind === "external" || link.kind === "mailto" || link.kind === "other") {
      continue;
    }

    if (link.kind === "same-file-anchor") {
      if (link.anchor === undefined) {
        continue;
      }

      const anchors = params.anchorIndex[link.sourcePath] ?? [];

      if (!anchors.includes(link.anchor)) {
        findings.push(buildMissingAnchorFinding(link, link.sourcePath));
      }

      continue;
    }

    if (!isMarkdownTarget(link.targetPath)) {
      continue;
    }

    if (!isInsideScanRoot(link.targetPath) || !knownFiles.has(link.targetPath)) {
      findings.push(buildMissingFileFinding(link));
      continue;
    }

    if (link.anchor === undefined) {
      continue;
    }

    const anchors = params.anchorIndex[link.targetPath] ?? [];

    if (!anchors.includes(link.anchor)) {
      findings.push(buildMissingAnchorFinding(link, link.targetPath));
    }
  }

  findings.sort((left, right) => {
    return (
      left.path.localeCompare(right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
      left.message.localeCompare(right.message)
    );
  });

  return findings;
}
