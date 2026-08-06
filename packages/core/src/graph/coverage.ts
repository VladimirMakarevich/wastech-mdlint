import { existsSync } from "node:fs";
import path from "node:path";

import { compareStrings } from "../deterministic-sort.js";
import { isMarkdownFile } from "../discovery/markdown-extensions.js";
import {
  candidateEscapesRoot,
  filePart,
  resolveTargetCandidates,
} from "../engine/path-resolve.js";
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

// Scheme-qualified targets (http:, https:, data:, …) are never a local file; mirrors REF-003's
// imageResolves guard so coverage never flags an external image as an out-of-corpus Markdown file.
function hasScheme(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

// A raw target plus whether the site router applies to it. Kinds cannot be flattened away here
// (P13.05 / W-10): an image is router-blind, because a router maps a URL to *Markdown source* and
// REF-003 resolves a root-relative image target against the repository root. Routing images would
// make coverage disagree with the rule it exists to complement.
type RawTarget = { target: string; routable: boolean };

// Every local-file raw target a document can point at: link (file part only, fragment dropped),
// image (external schemes excluded), and `@import` (leading `@` dropped).
function collectRawTargets(document: ParsedDocument): RawTarget[] {
  const targets: RawTarget[] = [];

  for (const link of document.links) {
    if (link.kind === "local-file") {
      targets.push({ target: filePart(link.rawTarget), routable: true });
    }
  }

  for (const image of document.images) {
    const target = filePart(image.rawTarget);
    if (target.length > 0 && !hasScheme(target)) {
      targets.push({ target, routable: false });
    }
  }

  for (const importRecord of document.imports) {
    targets.push({
      target: importRecord.rawTarget.slice(1),
      routable: true,
    });
  }

  return targets;
}

/**
 * Compute the G5 coverage signal: graph node/edge counts plus the deduped, sorted list of on-disk
 * Markdown files that are linked-to but outside the analyzed corpus. Core-only for P4.06 — there is
 * no CLI/lint-output consumer yet (P4.07 surfaces this in the `graph` command).
 *
 * "Markdown file" is `MARKDOWN_EXTENSIONS` (`discovery/markdown-extensions.ts`) — the same set the
 * repo scan walks, so a file this reports is one a proposed `include` could actually admit.
 */
export function computeGraphCoverage(
  documents: Map<string, ParsedDocument>,
  graph: ContextGraph,
  options: ComputeGraphCoverageOptions,
): GraphCoverage {
  const nodeSet = new Set(graph.nodes.map((node) => node.path));
  const outsideCorpus = new Set<string>();

  for (const document of documents.values()) {
    for (const { target, routable } of collectRawTargets(document)) {
      for (const candidate of resolveTargetCandidates(
        document.path,
        target,
        routable ? options.siteRouter : undefined,
      )) {
        if (
          isMarkdownFile(candidate) &&
          !candidateEscapesRoot(candidate) &&
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
    filesOutsideCorpus: [...outsideCorpus].sort(compareStrings),
  };
}
