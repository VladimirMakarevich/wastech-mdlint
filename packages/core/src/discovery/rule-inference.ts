import { readFile } from "node:fs/promises";
import path from "node:path";

import { matchesConfigGlob } from "./globs.js";
import { filePart, resolveTargetCandidates } from "../engine/path-resolve.js";
import { noPlaceholders } from "../engine/primitives/content.js";
import type { RuleMetadata, RuleRegistry } from "../engine/registry.js";
import type { RuleCategory, Severity } from "../engine/types.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import { parseDocument } from "../markdown/parse-document.js";
import type { DocCluster } from "./repo-scan.js";

// Rule inference (P6.02): turns P6.01's `DocCluster[]` into a draft, registry-sourced `rules[]`
// proposal with per-rule rationale, ready for P6.03's confirmation prompt.

export type DetectedPatterns = {
  localLinkCount: number;
  anchorLinkCount: number;
  imageCount: number;
  tableCount: number;
  checklistItemCount: number;
  placeholderSectionCount: number;
  // [] unless every sampled doc in the cluster shares an ADR-style heading set (detectAdrSections).
  adrSections: string[];
};

export type InferredRule = {
  rule: string;
  category: RuleCategory;
  // metadata.description, verbatim — proves the mapping tracks the registry rather than a
  // parallel hardcoded string.
  description: string;
  defaultSeverity: Severity;
  fixable: boolean;
  rationale: string;
  // Only set when derivable from sampled evidence without guessing (currently: SEC-001's
  // cluster-scoped files/sections — see "why global vs cluster-scoped" below).
  options?: Record<string, unknown>;
};

export type ClusterRuleInference = {
  clusterPath: string;
  includeGlob: string;
  sampledFiles: string[];
  patterns: DetectedPatterns;
  // Canonical ids this cluster's own evidence alone would justify (a subset of the global `rules`
  // gate, attributed per cluster for the P6.03 confirmation UI).
  contributesTo: string[];
};

export type RuleInferenceResult = {
  clusters: ClusterRuleInference[];
  rules: InferredRule[];
};

// Reads + parses one cluster's sample files, mirroring load-documents.ts's read+parse pairing. A
// sample path going stale between P6.01's scan and this call (e.g. deleted or renamed) must not
// crash the whole inference, so a failed read is skipped rather than thrown.
async function readSampleDocuments(cwd: string, sampleFiles: string[]): Promise<ParsedDocument[]> {
  const results = await Promise.all(
    sampleFiles.map(async (relPath) => {
      try {
        const content = await readFile(path.join(cwd, relPath), "utf8");
        return parseDocument({ path: relPath, content });
      } catch {
        return undefined;
      }
    })
  );
  return results.filter((doc): doc is ParsedDocument => doc !== undefined);
}

// Structural pattern tally (presence-only: count > 0 is the gate, no magic thresholds). Deliberate
// exception: placeholderSectionCount is a *quality* signal (do the samples already contain
// TBD/TODO?), computed via the real `noPlaceholders` primitive rather than reimplemented here.
//
// The link/image counts must mirror what `linkResolves`/`imageResolves` (REF-001/003) and
// GRP-001's graph edges actually evaluate — otherwise a rule gets proposed from evidence it would
// never look at (an empty `[]()` target, or an `http:`/`data:` image `imageResolves` skips
// outright), which is not a "justified" proposal.
function tallyPatterns(docs: ParsedDocument[]): Omit<DetectedPatterns, "adrSections"> {
  let localLinkCount = 0;
  let anchorLinkCount = 0;
  let imageCount = 0;
  let tableCount = 0;
  let checklistItemCount = 0;
  let placeholderSectionCount = 0;

  for (const doc of docs) {
    for (const link of doc.links) {
      const hasAnchor = link.anchor !== undefined && link.anchor.length > 0;
      if (link.kind === "local-file") {
        // linkResolves (REF-001) skips a link whose file part is empty; count it the same way so
        // REF-001/GRP-001 are never proposed from evidence those rules never evaluate.
        if (filePart(link.rawTarget).length === 0) {
          continue;
        }
        localLinkCount += 1;
        if (hasAnchor) {
          anchorLinkCount += 1;
        }
      } else if (link.kind === "same-file-anchor" && hasAnchor) {
        anchorLinkCount += 1;
      }
    }
    for (const image of doc.images) {
      const target = filePart(image.rawTarget);
      // Mirrors imageResolves (REF-003): skip an empty target and any scheme-qualified target
      // (http:, https:, data:, …), neither of which REF-003 ever evaluates.
      if (target.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
        continue;
      }
      imageCount += 1;
    }
    tableCount += doc.tables.length;
    checklistItemCount += doc.checkItems.length;
    placeholderSectionCount += noPlaceholders(doc, {}).length;
  }

  return { localLinkCount, anchorLinkCount, imageCount, tableCount, checklistItemCount, placeholderSectionCount };
}

const ADR_CORE_TERMS = ["status", "context", "decision"];
const ADR_VOCABULARY = new Set([...ADR_CORE_TERMS, "consequences", "alternatives"]);

// ADR-triplet detection. Two-part gate, deliberately: the lower-cased vocabulary match decides
// *whether* a cluster is ADR-like (case-insensitive, so "STATUS" and "Status" both count as
// evidence towards the >=2-of-3 threshold); the exact-string intersection below decides *what to
// require* from every sampled file. `sectionPresent` (SEC-001's primitive) matches section names
// case-sensitively, so requiring a heading whose exact casing isn't guaranteed across every sample
// would risk a false SEC-001 finding later — this sidesteps that risk and only risks a missed
// (not false) proposal, which the phase exit criteria explicitly allow.
//
// The result preserves the *first* sampled doc's reading order rather than alphabetizing:
// `doc.sections` is a reading-order sequence, not a set, and SEC-001's fix scaffolds any missing
// section at EOF in the order `options.sections` lists them — alphabetizing here would silently
// reorder that downstream scaffold order away from how the sampled ADRs actually read.
function detectAdrSections(docs: ParsedDocument[]): string[] {
  let sharedSections: string[] | undefined;

  for (const doc of docs) {
    const lowerSections = new Set(doc.sections.map((section) => section.toLowerCase()));
    const coreMatchCount = ADR_CORE_TERMS.filter((term) => lowerSections.has(term)).length;
    if (coreMatchCount < 2) {
      return [];
    }

    const vocabSections: string[] = [];
    const seenVocabSections = new Set<string>();
    for (const section of doc.sections) {
      if (ADR_VOCABULARY.has(section.toLowerCase()) && !seenVocabSections.has(section)) {
        vocabSections.push(section);
        seenVocabSections.add(section);
      }
    }

    if (sharedSections === undefined) {
      sharedSections = vocabSections;
    } else {
      const vocabSectionSet = new Set(vocabSections);
      sharedSections = sharedSections.filter((section) => vocabSectionSet.has(section));
    }
  }

  return sharedSections ?? [];
}

// Sum every cluster's numeric pattern counts into one repo-wide total. adrSections is inherently
// per-cluster (SEC-001 is the only rule scoped to it — see below), so the total carries an empty
// placeholder that no gate reads.
function sumPatterns(patterns: DetectedPatterns[]): DetectedPatterns {
  const totals: DetectedPatterns = {
    localLinkCount: 0,
    anchorLinkCount: 0,
    imageCount: 0,
    tableCount: 0,
    checklistItemCount: 0,
    placeholderSectionCount: 0,
    adrSections: []
  };

  for (const entry of patterns) {
    totals.localLinkCount += entry.localLinkCount;
    totals.anchorLinkCount += entry.anchorLinkCount;
    totals.imageCount += entry.imageCount;
    totals.tableCount += entry.tableCount;
    totals.checklistItemCount += entry.checklistItemCount;
    totals.placeholderSectionCount += entry.placeholderSectionCount;
  }

  return totals;
}

// The full sampled cycle path, in traversal order (an edge from each entry to the next, wrapping
// from the last entry back to the first). Carrying the whole path — not just the DFS back-edge —
// matters once a cycle has more than 2 nodes: for `a -> b -> c -> a` the back-edge is `(c, a)`,
// but "c and a reference each other" would be false (only `a -> b` and `c -> a` actually exist).
type SampleCycle = string[];

// Cross-cluster cycle heuristic (global, not per-cluster): a small bounded DFS over the combined
// sample-file map (N is at most a few clusters * sample size, so no explicit bound is needed) that
// stops at the first back-edge and returns the full path from that edge's target back to the
// current node. This is an explicit approximation over samples only, used solely to make the
// GRP-001 rationale concrete — the real GRP-001 check still runs later over the full corpus via
// buildContextGraph. Edge resolution must share the real pipeline's semantics
// (`resolveTargetCandidates`, the same helper REF-001/002 and the graph builder use) or this
// heuristic can fabricate an edge — e.g. misresolving a root-relative link as source-relative, or
// treating a broken anchor as a same-target edge — that the shared graph would never actually
// create.
function findSampleCycle(sampleDocs: Map<string, ParsedDocument>): SampleCycle | undefined {
  const adjacency = new Map<string, string[]>();
  for (const [sourcePath, doc] of sampleDocs) {
    const targets: string[] = [];
    for (const link of doc.links) {
      if (link.kind !== "local-file") {
        continue;
      }
      const targetFilePart = filePart(link.rawTarget);
      if (targetFilePart.length === 0) {
        continue;
      }

      for (const candidate of resolveTargetCandidates(sourcePath, targetFilePart)) {
        if (candidate === sourcePath) {
          continue;
        }
        const targetDoc = sampleDocs.get(candidate);
        if (targetDoc === undefined) {
          continue;
        }
        // Mirrors REF-002: an anchored link is only a real edge to that document if the target
        // sample actually has a matching heading slug; a broken anchor is REF-002's evidence, not
        // GRP-001's, and must not be counted as a graph edge here.
        if (
          link.anchor !== undefined &&
          link.anchor.length > 0 &&
          !targetDoc.headings.some((heading) => heading.slug === link.anchor)
        ) {
          continue;
        }
        targets.push(candidate);
      }
    }
    adjacency.set(sourcePath, targets);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  // Mirrors `visiting` but as an ordered stack, so a found back-edge can slice out the exact
  // sampled path that closes the cycle instead of just its two endpoints.
  const stack: string[] = [];

  function visit(node: string): SampleCycle | undefined {
    visiting.add(node);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if (visiting.has(next)) {
        const cycleStart = stack.indexOf(next);
        return stack.slice(cycleStart);
      }
      if (!visited.has(next)) {
        const found = visit(next);
        if (found !== undefined) {
          return found;
        }
      }
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return undefined;
  }

  for (const sourcePath of [...sampleDocs.keys()].sort((left, right) => left.localeCompare(right))) {
    if (!visited.has(sourcePath)) {
      const found = visit(sourcePath);
      if (found !== undefined) {
        return found;
      }
    }
  }

  return undefined;
}

// The one place gate ids are referenced as string literals; each is used purely as a lookup key
// into the registry-derived `idIndex` below, never as a standalone hardcoded metadata object. If a
// lookup misses (a rule renamed or removed from the registry), the caller skips that proposal
// silently instead of emitting a dangling id or crashing — that degradation is what "no hardcoded
// drift" buys.
//
// Why these 7 and not the other 17 built-ins: every other rule has a *required* option with no
// safe way to derive it from 3-5 sampled files (a pipeline `chain`, a `template` file, a
// `zonesDir`, an idColumn/idPattern split, a glossary table, an enumerated `values` set, etc.) —
// see docs/mdlint_v2/P6-init/02-rule-inference.md's "Deliberately not inferred" note.
const PATTERN_GATES: Record<
  string,
  {
    gate: (patterns: DetectedPatterns) => boolean;
    rationale: (patterns: DetectedPatterns, cycle: SampleCycle | undefined) => string;
  }
> = {
  "REF-001": {
    gate: (patterns) => patterns.localLinkCount > 0,
    rationale: (patterns) =>
      `Sampled files contain ${patterns.localLinkCount} relative link(s) to other files; REF-001 checks that every one resolves to a file in the corpus.`
  },
  "REF-002": {
    gate: (patterns) => patterns.anchorLinkCount > 0,
    rationale: (patterns) =>
      `Sampled files contain ${patterns.anchorLinkCount} link(s) carrying a heading anchor; REF-002 checks that each anchor matches a real heading slug.`
  },
  "REF-003": {
    gate: (patterns) => patterns.imageCount > 0,
    rationale: (patterns) =>
      `Sampled files contain ${patterns.imageCount} image reference(s); REF-003 checks that every one resolves to a file on disk.`
  },
  "TBL-002": {
    gate: (patterns) => patterns.tableCount > 0,
    rationale: (patterns) =>
      `Sampled files contain ${patterns.tableCount} table(s); TBL-002 checks that target cells are not left empty.`
  },
  "CTX-001": {
    gate: (patterns) => patterns.placeholderSectionCount > 0,
    rationale: (patterns) =>
      `Sampled files contain ${patterns.placeholderSectionCount} section(s) that are empty or placeholder-only; CTX-001 flags these.`
  },
  "CTX-002": {
    gate: (patterns) => patterns.checklistItemCount > 0,
    rationale: (patterns) =>
      `Sampled files contain ${patterns.checklistItemCount} checklist item(s); CTX-002 checks that every one is checked.`
  },
  "GRP-001": {
    gate: (patterns) => patterns.localLinkCount > 0,
    rationale: (patterns, cycle) =>
      cycle === undefined
        ? `Sampled files contain ${patterns.localLinkCount} relative link(s) forming a reference graph; GRP-001 checks the full corpus for circular references.`
        : `Sampled files form a reference chain that loops back on itself (${[...cycle, cycle[0]].join(" -> ")}); GRP-001 checks the full corpus for circular references.`
  }
};

function sec001Rationale(cluster: { includeGlob: string; adrSections: string[] }): string {
  return `Sampled files in ${cluster.includeGlob} share the ADR sections ${cluster.adrSections.join(", ")}; SEC-001 checks that every file in this cluster has all of them.`;
}

// SEC-001's inferred `files` scope is the cluster's own `includeGlob` — verify it actually matches
// every sampled file that produced the ADR evidence before proposing it. The accepted P6.01
// fallback shape is a case where it might not: `scanRepository`'s global fallback cluster can
// sample both `.md` and `.mdx` files under the literal glob `**/*.md` (deliberately not
// `.mdx`-aware — it mirrors the tool's real zero-config default, not the scan's own discovery
// criteria). Proposing `SEC-001` scoped to a glob that misses its own sampled `.mdx` evidence
// would be a dead rule: valid config, but it would check none of the files that justified it.
function sec001ScopeMatchesSamples(cluster: { includeGlob: string; sampledFiles: string[] }): boolean {
  return cluster.sampledFiles.every((file) => matchesConfigGlob(file, [cluster.includeGlob]));
}

// Groups registry metadata by category (the literal "group ruleRegistry.getAllMetadata() on
// metadata.category" the task requires) and flattens it into an id-keyed lookup — the mapping this
// module uses to turn a gate id into real, current rule metadata instead of a duplicated table.
function buildIdIndex(registry: RuleRegistry): Map<string, RuleMetadata> {
  const byCategory = new Map<RuleCategory, RuleMetadata[]>();
  for (const metadata of registry.getAllMetadata()) {
    const existing = byCategory.get(metadata.category);
    if (existing === undefined) {
      byCategory.set(metadata.category, [metadata]);
    } else {
      existing.push(metadata);
    }
  }

  const idIndex = new Map<string, RuleMetadata>();
  for (const metadataForCategory of byCategory.values()) {
    for (const metadata of metadataForCategory) {
      idIndex.set(metadata.id, metadata);
    }
  }
  return idIndex;
}

function toInferredRule(metadata: RuleMetadata, rationale: string, options?: Record<string, unknown>): InferredRule {
  return {
    rule: metadata.id,
    category: metadata.category,
    description: metadata.description,
    defaultSeverity: metadata.defaultSeverity,
    fixable: metadata.fixable,
    rationale,
    ...(options === undefined ? {} : { options })
  };
}

// Repeated ids (only SEC-001 can repeat) sort by their first scoped file after the id itself, so
// the final `rules` order is fully deterministic regardless of cluster traversal order.
function fileScopeSortKey(rule: InferredRule): string {
  const files = rule.options?.["files"];
  return Array.isArray(files) && typeof files[0] === "string" ? files[0] : "";
}

/**
 * Samples each cluster's files, detects reference/table/checklist/placeholder/ADR/cycle patterns,
 * and maps them to a draft, registry-sourced rule set with per-rule rationale (P6.02). Pure and
 * read-only, like `scanRepository` (P6.01) — does not write anything.
 */
export async function inferRuleSet(params: {
  cwd: string;
  clusters: DocCluster[];
  registry: RuleRegistry;
}): Promise<RuleInferenceResult> {
  const { cwd, clusters, registry } = params;
  const idIndex = buildIdIndex(registry);

  const perClusterDocs = await Promise.all(
    clusters.map((cluster) => readSampleDocuments(cwd, cluster.sampleFiles))
  );

  // Combined map for the cross-cluster cycle heuristic; later clusters win on an (unexpected)
  // path collision, which cannot happen in practice since P6.01 scopes clusters disjointly.
  const combinedSamples = new Map<string, ParsedDocument>();
  for (const docs of perClusterDocs) {
    for (const doc of docs) {
      combinedSamples.set(doc.path, doc);
    }
  }
  const cycle = findSampleCycle(combinedSamples);

  const clusterInferences: ClusterRuleInference[] = clusters.map((cluster, index) => {
    const docs = perClusterDocs[index];
    const adrSections = detectAdrSections(docs);
    const patterns: DetectedPatterns = { ...tallyPatterns(docs), adrSections };
    const sampledFiles = docs.map((doc) => doc.path).sort((left, right) => left.localeCompare(right));

    const contributesTo = Object.entries(PATTERN_GATES)
      .filter(([id, definition]) => idIndex.has(id) && definition.gate(patterns))
      .map(([id]) => id);
    if (
      adrSections.length > 0 &&
      idIndex.has("SEC-001") &&
      sec001ScopeMatchesSamples({ includeGlob: cluster.includeGlob, sampledFiles })
    ) {
      contributesTo.push("SEC-001");
    }
    contributesTo.sort((left, right) => left.localeCompare(right));

    return {
      clusterPath: cluster.path,
      includeGlob: cluster.includeGlob,
      sampledFiles,
      patterns,
      contributesTo
    };
  });

  const globalPatterns = sumPatterns(clusterInferences.map((cluster) => cluster.patterns));

  const rules: InferredRule[] = [];

  for (const [id, definition] of Object.entries(PATTERN_GATES)) {
    const metadata = idIndex.get(id);
    if (metadata === undefined || !definition.gate(globalPatterns)) {
      continue;
    }
    rules.push(toInferredRule(metadata, definition.rationale(globalPatterns, cycle)));
  }

  const sec001Metadata = idIndex.get("SEC-001");
  if (sec001Metadata !== undefined) {
    for (const cluster of clusterInferences) {
      if (cluster.patterns.adrSections.length === 0 || !sec001ScopeMatchesSamples(cluster)) {
        continue;
      }
      rules.push(
        toInferredRule(
          sec001Metadata,
          sec001Rationale({ includeGlob: cluster.includeGlob, adrSections: cluster.patterns.adrSections }),
          { files: [cluster.includeGlob], sections: cluster.patterns.adrSections }
        )
      );
    }
  }

  rules.sort((left, right) => {
    const idDiff = left.rule.localeCompare(right.rule);
    return idDiff !== 0 ? idDiff : fileScopeSortKey(left).localeCompare(fileScopeSortKey(right));
  });

  return { clusters: clusterInferences, rules };
}
