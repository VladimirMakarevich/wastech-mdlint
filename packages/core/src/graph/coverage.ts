import { existsSync } from "node:fs";
import path from "node:path";

import { escapesRoot, filePart, resolveTargetCandidates } from "../engine/path-resolve.js";
import type { SiteRouterSettings } from "../engine/types.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import type { ContextGraph } from "./context-graph-types.js";

// G5 coverage signal (P4.06): report graph size plus on-disk Markdown files that are linked-to from
// the corpus but fall outside it (excluded from `include`, so they never became graph nodes). This
// re-scans raw link/image/import targets rather than reusing `ContextGraph` edges — the graph only
// ever materializes edges to *corpus* nodes (architecture invariant: `ContextGraph` owns adjacency;
// coverage widens the on-disk existence check the graph deliberately skips, it does not add a
// parallel traversal).

export type GraphCoverage = {
  nodeCount: number;
  edgeCount: number;
  filesOutsideCorpus: string[];
};

export type ComputeGraphCoverageOptions = {
  rootDir: string;
  siteRouter?: SiteRouterSettings;
};

const MARKDOWN_EXTENSIONS = [".md", ".markdown"];

function isMarkdownFile(relPath: string): boolean {
  return MARKDOWN_EXTENSIONS.some((extension) => relPath.toLowerCase().endsWith(extension));
}

// Scheme-qualified targets (http:, https:, data:, …) are never a local file; mirrors REF-003's
// imageResolves guard so coverage never flags an external image as an out-of-corpus Markdown file.
function hasScheme(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

// Every local-file raw target a document can point at: link (file part only, fragment dropped),
// image (external schemes excluded), and `@import` (leading `@` dropped).
function collectRawTargets(document: ParsedDocument): string[] {
  const targets: string[] = [];

  for (const link of document.links) {
    if (link.kind === "local-file") {
      targets.push(filePart(link.rawTarget));
    }
  }

  for (const image of document.images) {
    const target = filePart(image.rawTarget);
    if (target.length > 0 && !hasScheme(target)) {
      targets.push(target);
    }
  }

  for (const importRecord of document.imports) {
    targets.push(importRecord.rawTarget.slice(1));
  }

  return targets;
}

/**
 * Compute the G5 coverage signal: graph node/edge counts plus the deduped, sorted list of on-disk
 * Markdown files that are linked-to but outside the analyzed corpus. Core-only for P4.06 — there is
 * no CLI/lint-output consumer yet (P4.07 surfaces this in the `graph` command).
 */
export function computeGraphCoverage(
  documents: Map<string, ParsedDocument>,
  graph: ContextGraph,
  options: ComputeGraphCoverageOptions
): GraphCoverage {
  const nodeSet = new Set(graph.nodes.map((node) => node.path));
  const outsideCorpus = new Set<string>();

  for (const document of documents.values()) {
    for (const rawTarget of collectRawTargets(document)) {
      for (const candidate of resolveTargetCandidates(document.path, rawTarget, options.siteRouter)) {
        if (
          isMarkdownFile(candidate) &&
          !escapesRoot(candidate) &&
          !nodeSet.has(candidate) &&
          existsSync(path.resolve(options.rootDir, candidate))
        ) {
          outsideCorpus.add(candidate);
        }
      }
    }
  }

  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    filesOutsideCorpus: [...outsideCorpus].sort((left, right) => left.localeCompare(right))
  };
}
