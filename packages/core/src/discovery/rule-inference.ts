import path from "node:path";

import { resolveCorpusScope } from "../config/corpus-scope.js";
import { compareStrings } from "../deterministic-sort.js";
import { matchesConfigGlob } from "./globs.js";
import { lintCorpus } from "../engine/lint-corpus.js";
import { filePart } from "../engine/path-resolve.js";
import { noPlaceholders } from "../engine/primitives/content.js";
import type { RuleMetadata, RuleRegistry } from "../engine/registry.js";
import { DEFAULT_GRP001_MIN_CYCLE_LENGTH } from "../engine/rules/grp.js";
import type {
  LintMessage,
  ResolvedRule,
  ResolvedSettings,
  RuleCategory,
  Severity,
  SeverityOverride,
} from "../engine/types.js";
import { buildContextGraph } from "../graph/build-context-graph.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import { loadDocuments } from "../markdown/load-documents.js";
import type { DocCluster } from "./repo-scan.js";

// Rule inference: turns the repo scan's `DocCluster[]` into a draft, registry-sourced `rules[]`
// proposal with per-rule rationale, ready for `init`'s confirmation prompt.
//
// Every number this module states is measured over the corpus the config it drafts will actually
// lint — never over a sample of it. Reading three-to-five files per cluster was cheaper and produced
// rationales off by more than an order of magnitude (29 checklist items claimed for a corpus holding
// 433), which then went into the config as a permanent justification nobody could reproduce. On a
// merge it was worse than imprecise: the existing `include` is preserved verbatim while the scan
// walks the whole repository, so a rule could be appended whose only evidence lived in files that
// config will never read. Measuring the corpus is what makes both impossible — the evidence and the
// run are the same file set by construction.

export type DetectedPatterns = {
  localLinkCount: number;
  anchorLinkCount: number;
  imageCount: number;
  tableCount: number;
  checklistItemCount: number;
  placeholderSectionCount: number;
  // [] unless every document in the cluster shares an ADR-style heading set (detectAdrSections).
  adrSections: string[];
};

export type InferredRule = {
  rule: string;
  category: RuleCategory;
  // metadata.description, verbatim — proves the mapping tracks the registry rather than a
  // parallel hardcoded string.
  description: string;
  defaultSeverity: Severity;
  // The severity the written entry carries; absent when the entry runs at `defaultSeverity`. Only
  // ever `"off"` today — see `proposedSeverity`.
  severity?: SeverityOverride;
  fixable: boolean;
  rationale: string;
  // Only set when derivable from the corpus without guessing (currently: SEC-001's cluster-scoped
  // files/sections — see "why global vs cluster-scoped" below).
  options?: Record<string, unknown>;
};

export type ClusterRuleInference = {
  clusterPath: string;
  includeGlob: string;
  // The corpus files this cluster's glob selects — the evidence its patterns were measured on.
  files: string[];
  patterns: DetectedPatterns;
  // Canonical ids this cluster's own evidence alone would justify (a subset of the global `rules`
  // gate, attributed per cluster so the confirmation prompt can show which cluster earned each rule).
  contributesTo: string[];
};

/**
 * The scope of the config being drafted: the keys that decide which files it will lint. A fresh
 * write passes the cluster globs it is about to write; a merge passes the existing config's own
 * values, so inference cannot justify a rule with files that config does not read.
 */
export type InferenceScope = {
  include?: string[];
  exclude?: string[];
  respectGitignore?: boolean;
  // Graph edge resolution reads these, so a cycle named in a rationale is the cycle the run would
  // see only when they match what the config carries.
  settings?: ResolvedSettings;
};

export type RuleInferenceResult = {
  clusters: ClusterRuleInference[];
  rules: InferredRule[];
  // How many files the drafted config lints. Named in every rationale so a reader can reproduce the
  // counts beside it with a single `lint`.
  corpusFileCount: number;
};

// Structural pattern tally. This decides *relevance* — does the corpus contain the construct a rule
// inspects at all — and is deliberately presence-only (count > 0, no magic thresholds). It is a
// separate question from the severity decision below, which asks whether the rule is satisfied
// today; conflating the two would either propose a rule for a corpus with nothing to check, or
// judge a rule by how much material it has rather than by how much of it is wrong.
//
// Deliberate exception: placeholderSectionCount is a *quality* signal (does the corpus already
// contain TBD/TODO?), computed via the real `noPlaceholders` primitive rather than reimplemented
// here.
//
// The link/image counts must mirror what `linkResolves`/`imageResolves` (REF-001/003) and
// GRP-001's graph edges actually evaluate — otherwise a rule gets proposed from evidence it would
// never look at (an empty `[]()` target, or an `http:`/`data:` image `imageResolves` skips
// outright), which is not a "justified" proposal.
function tallyPatterns(
  docs: ParsedDocument[],
): Omit<DetectedPatterns, "adrSections"> {
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
      // Mirrors imageResolves (REF-003)'s *skip guards* — it counts, it does not resolve: skip an
      // empty target and any scheme-qualified target (http:, https:, data:, …), neither of which
      // REF-003 ever evaluates.
      if (target.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
        continue;
      }
      imageCount += 1;
    }
    tableCount += doc.tables.length;
    checklistItemCount += doc.checkItems.length;
    placeholderSectionCount += noPlaceholders(doc, {}).length;
  }

  return {
    localLinkCount,
    anchorLinkCount,
    imageCount,
    tableCount,
    checklistItemCount,
    placeholderSectionCount,
  };
}

const ADR_CORE_TERMS = ["status", "context", "decision"];
const ADR_VOCABULARY = new Set([
  ...ADR_CORE_TERMS,
  "consequences",
  "alternatives",
]);

// ADR-triplet detection. Two-part gate, deliberately: the lower-cased vocabulary match decides
// *whether* a cluster is ADR-like (case-insensitive, so "STATUS" and "Status" both count as
// evidence towards the >=2-of-3 threshold); the exact-string intersection below decides *what to
// require* from every file in it. `sectionPresent` (SEC-001's primitive) matches section names
// case-sensitively, so requiring a heading whose exact casing isn't guaranteed across every document
// would risk a false SEC-001 finding later — this sidesteps that risk and only risks a missed
// (not false) proposal.
//
// The result preserves the *first* document's reading order rather than alphabetizing:
// `doc.sections` is a reading-order sequence, not a set, and SEC-001's fix scaffolds any missing
// section at EOF in the order `options.sections` lists them — alphabetizing here would silently
// reorder that downstream scaffold order away from how the ADRs actually read.
function detectAdrSections(docs: ParsedDocument[]): string[] {
  let sharedSections: string[] | undefined;

  for (const doc of docs) {
    const lowerSections = new Set(
      doc.sections.map((section) => section.toLowerCase()),
    );
    const coreMatchCount = ADR_CORE_TERMS.filter((term) =>
      lowerSections.has(term),
    ).length;
    if (coreMatchCount < 2) {
      return [];
    }

    const vocabSections: string[] = [];
    const seenVocabSections = new Set<string>();
    for (const section of doc.sections) {
      if (
        ADR_VOCABULARY.has(section.toLowerCase()) &&
        !seenVocabSections.has(section)
      ) {
        vocabSections.push(section);
        seenVocabSections.add(section);
      }
    }

    if (sharedSections === undefined) {
      sharedSections = vocabSections;
    } else {
      const vocabSectionSet = new Set(vocabSections);
      sharedSections = sharedSections.filter((section) =>
        vocabSectionSet.has(section),
      );
    }
  }

  return sharedSections ?? [];
}

// A cycle as the shared `ContextGraph` reports it: a *closed* path, with the start node repeated at
// the end, so the distinct-document count is one less than the array length. GRP-001 applies exactly
// that arithmetic against its floor, and a rationale that cited a cycle by array length would
// disagree with the rule it is describing by one document.
function distinctCycleLength(cycle: string[]): number {
  return cycle.length - 1;
}

// The cycle a GRP-001 rationale names. Shortest first so the citation is the tightest loop in the
// corpus rather than an arbitrarily long one, then lexicographic, because `cycles` carries one
// representative path per strongly connected component in traversal order and a rationale written
// into a config file must not change between two runs over the same tree.
function pickCitedCycle(cycles: string[][]): string[] | undefined {
  return [...cycles].sort(
    (left, right) =>
      distinctCycleLength(left) - distinctCycleLength(right) ||
      compareStrings(left.join(" -> "), right.join(" -> ")),
  )[0];
}

// The one place gate ids are referenced as string literals; each is used purely as a lookup key
// into the registry-derived `idIndex` below, never as a standalone hardcoded metadata object. If a
// lookup misses (a rule renamed or removed from the registry), the caller skips that proposal
// silently instead of emitting a dangling id or crashing — that degradation is what "no hardcoded
// drift" buys.
//
// Why these 7 and not the other 17 built-ins: every other rule has a *required* option with no
// safe way to derive it from the corpus without inventing a threshold (a pipeline `chain`, a
// `template` file, a `zonesDir`, an idColumn/idPattern split, a glossary table, an enumerated
// `values` set, etc.).
//
// That scope was re-examined for the two rules the README leads with, SIZE-001 and LLM-001, and
// reached the same answer: both are budgets, and a budget is a choice rather than a measurement —
// the corpus can say how large a document is, not how large it ought to be. So inference was
// deliberately not widened; the gap is made visible instead — `init`'s draft names both rules and
// points at their guide pages. Changing that means changing the disclosure too.
const PATTERN_GATES: Record<
  string,
  {
    gate: (patterns: DetectedPatterns) => boolean;
    // The clause naming what in the corpus makes this rule relevant. The verdict clause — what the
    // rule reports over that same corpus today — is appended by `composeRationale` for every rule
    // alike, so no gate can forget to state it.
    relevance: (patterns: DetectedPatterns, cycles: string[][]) => string;
  }
> = {
  "REF-001": {
    gate: (patterns) => patterns.localLinkCount > 0,
    relevance: (patterns) =>
      `The corpus contains ${patterns.localLinkCount} relative link(s) to other files; REF-001 checks that every one resolves to a file in the corpus.`,
  },
  "REF-002": {
    gate: (patterns) => patterns.anchorLinkCount > 0,
    relevance: (patterns) =>
      `The corpus contains ${patterns.anchorLinkCount} link(s) carrying a heading anchor; REF-002 checks that each anchor matches a real heading slug.`,
  },
  "REF-003": {
    gate: (patterns) => patterns.imageCount > 0,
    relevance: (patterns) =>
      `The corpus contains ${patterns.imageCount} image reference(s); REF-003 checks that every one resolves to a file on disk.`,
  },
  "TBL-002": {
    gate: (patterns) => patterns.tableCount > 0,
    relevance: (patterns) =>
      `The corpus contains ${patterns.tableCount} table(s); TBL-002 checks that target cells are not left empty.`,
  },
  "CTX-001": {
    gate: (patterns) => patterns.placeholderSectionCount > 0,
    relevance: (patterns) =>
      `The corpus contains ${patterns.placeholderSectionCount} section(s) that are empty or placeholder-only; CTX-001 flags these.`,
  },
  "CTX-002": {
    gate: (patterns) => patterns.checklistItemCount > 0,
    relevance: (patterns) =>
      `The corpus contains ${patterns.checklistItemCount} checklist item(s); CTX-002 checks that every one is checked.`,
  },
  "GRP-001": {
    gate: (patterns) => patterns.localLinkCount > 0,
    // Three forms, because the useful thing to say depends on what the graph holds — and the third
    // is the one that has to be said out loud. A cycle below GRP-001's floor is real, visible to
    // anyone reading the two documents, and deliberately not reported: two documents indexing each
    // other is an ordinary documentation shape, and failing a build on it invites disabling the rule
    // and forfeiting the genuinely tangled multi-hop cycles with it. Naming the cycle and then
    // stating that the proposed config leaves it alone is what keeps the evidence concrete without
    // quietly lowering the floor to match it.
    relevance: (patterns, cycles) => {
      const cited = pickCitedCycle(cycles);
      if (cited === undefined) {
        return `The corpus contains ${patterns.localLinkCount} relative link(s) forming a reference graph with no cycles in it today; GRP-001 checks for circular references.`;
      }
      const distinct = distinctCycleLength(cited);
      if (distinct >= DEFAULT_GRP001_MIN_CYCLE_LENGTH) {
        return `The corpus contains a reference chain that loops back on itself (${cited.join(" -> ")}); GRP-001 checks for circular references.`;
      }
      return `The corpus contains a reference chain that loops back on itself (${cited.join(" -> ")}), which this config will NOT report: GRP-001 only reports a cycle spanning ${DEFAULT_GRP001_MIN_CYCLE_LENGTH} or more documents, and two documents linking each other is an ordinary index-and-member shape rather than a tangle; GRP-001 checks for the longer cycles that are.`;
    },
  },
};

function sec001Relevance(cluster: {
  includeGlob: string;
  adrSections: string[];
}): string {
  return `Files in ${cluster.includeGlob} share the ADR sections ${cluster.adrSections.join(", ")}; SEC-001 checks that every file in this cluster has all of them.`;
}

// Groups registry metadata by category and flattens it into an id-keyed lookup — the mapping this
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

// A rule the corpus makes relevant, before the dry run has decided what severity to write it at.
// `ownsMessage` exists because one rule id can appear as several entries: SEC-001 is proposed once
// per ADR cluster, and judging both entries by the combined finding count would switch off a clean
// cluster because a different one is not.
type RuleCandidate = {
  metadata: RuleMetadata;
  relevance: string;
  options?: Record<string, unknown>;
  ownsMessage: (message: LintMessage) => boolean;
};

// Severity policy, and the whole reason inference measures rather than samples: a rule joins the
// gate at its own severity only when the corpus it will run over reports nothing for it. Anything
// else is written as a disabled entry carrying its real count, so the config states the work
// remaining instead of performing it on day one.
//
// A gate that reports hundreds of findings the first time it runs is ignored, then disabled, and
// takes the rules that *were* clean down with it — and a first run offered alongside a CI workflow
// makes that failure the new adopter's first build. An entry written `"off"` with the count beside
// it costs one word to reverse and keeps the number in front of whoever reverses it.
function proposedSeverity(findingCount: number): SeverityOverride | undefined {
  return findingCount === 0 ? undefined : "off";
}

// Relevance first, then what the rule reports over the same corpus right now. Both halves name a
// number the reader can reproduce by running `lint` against the config this comment sits in, which
// is the property the whole module exists to hold.
function composeRationale(params: {
  relevance: string;
  findingCount: number;
  affectedFileCount: number;
  corpusFileCount: number;
}): string {
  const { relevance, findingCount, affectedFileCount, corpusFileCount } =
    params;
  if (findingCount === 0) {
    return `${relevance} It reports nothing over the ${corpusFileCount} file(s) this config lints, so it is enabled.`;
  }
  return `${relevance} It reports ${findingCount} finding(s) across ${affectedFileCount} of the ${corpusFileCount} file(s) this config lints, so it is written off rather than failing the first run; switch it on once those are cleared.`;
}

// Repeated ids (only SEC-001 can repeat) sort by their first scoped file after the id itself, so
// the final `rules` order is fully deterministic regardless of cluster traversal order.
function fileScopeSortKey(rule: InferredRule): string {
  const files = rule.options?.["files"];
  return Array.isArray(files) && typeof files[0] === "string" ? files[0] : "";
}

/**
 * Samples nothing: loads the corpus the drafted config will lint, detects
 * reference/table/checklist/placeholder/ADR/cycle patterns across it, runs the candidate rules over
 * it once, and maps the result to a draft, registry-sourced rule set with per-rule rationale.
 *
 * Read-only — it writes nothing, and the lint pass it runs is the ordinary in-memory one.
 */
export async function inferRuleSet(params: {
  cwd: string;
  clusters: DocCluster[];
  registry: RuleRegistry;
  scope: InferenceScope;
}): Promise<RuleInferenceResult> {
  const { cwd, clusters, registry, scope } = params;
  const idIndex = buildIdIndex(registry);
  const rootDir = path.resolve(cwd);

  // Resolved through the same helper the lint path uses, so the defaults a silent key falls back to
  // are identical to the ones the user's first `lint` will apply. Deriving them here instead would
  // put a second copy of the default `exclude` in the tree for the two to disagree over.
  const corpusScope = resolveCorpusScope({
    ...(scope.include === undefined ? {} : { include: scope.include }),
    ...(scope.exclude === undefined ? {} : { exclude: scope.exclude }),
    ...(scope.respectGitignore === undefined
      ? {}
      : { respectGitignore: scope.respectGitignore }),
  });
  const loaded = await loadDocuments(corpusScope.include, {
    cwd: rootDir,
    exclude: corpusScope.exclude,
    respectGitignore: corpusScope.respectGitignore,
  });

  // Re-keyed to repo-relative POSIX paths, matching what the lint orchestrator hands `lintCorpus`:
  // those keys are the identity rules resolve link and ID targets against.
  const documents = new Map<string, ParsedDocument>();
  for (const document of loaded.values()) {
    documents.set(document.path, document);
  }
  const corpusFileCount = documents.size;
  const allDocs = [...documents.values()];

  const settings: ResolvedSettings = scope.settings ?? {};
  const graph = buildContextGraph(documents, {
    ...(settings.siteRouter === undefined
      ? {}
      : { siteRouter: settings.siteRouter }),
    ...(settings.idRef === undefined ? {} : { idRef: settings.idRef }),
  });

  const clusterInferences: ClusterRuleInference[] = clusters.map((cluster) => {
    // Partitioned by the cluster's own glob rather than by the scan's sample list. That is also what
    // keeps SEC-001's inferred `files` scope honest: the evidence for an ADR proposal can only come
    // from files the glob it proposes actually selects, so a scope that checks none of the files
    // that justified it is unreachable rather than guarded against.
    const docs = allDocs
      .filter((doc) => matchesConfigGlob(doc.path, [cluster.includeGlob]))
      .sort((left, right) => compareStrings(left.path, right.path));
    const adrSections = detectAdrSections(docs);
    const patterns: DetectedPatterns = {
      ...tallyPatterns(docs),
      adrSections,
    };

    const contributesTo = Object.entries(PATTERN_GATES)
      .filter(
        ([id, definition]) => idIndex.has(id) && definition.gate(patterns),
      )
      .map(([id]) => id);
    if (adrSections.length > 0 && idIndex.has("SEC-001")) {
      contributesTo.push("SEC-001");
    }
    contributesTo.sort(compareStrings);

    return {
      clusterPath: cluster.path,
      includeGlob: cluster.includeGlob,
      files: docs.map((doc) => doc.path),
      patterns,
      contributesTo,
    };
  });

  // Tallied over the corpus itself, not summed across clusters: a merge's `include` can select files
  // no cluster glob covers, and summing overlapping clusters would double-count. The corpus is the
  // thing the config lints, so it is the thing the global gates read.
  const globalPatterns: DetectedPatterns = {
    ...tallyPatterns(allDocs),
    adrSections: [],
  };

  const candidates: RuleCandidate[] = [];

  for (const [id, definition] of Object.entries(PATTERN_GATES)) {
    const metadata = idIndex.get(id);
    if (metadata === undefined || !definition.gate(globalPatterns)) {
      continue;
    }
    candidates.push({
      metadata,
      relevance: definition.relevance(globalPatterns, graph.cycles),
      ownsMessage: (message) => message.ruleId === id,
    });
  }

  const sec001Metadata = idIndex.get("SEC-001");
  if (sec001Metadata !== undefined) {
    for (const cluster of clusterInferences) {
      if (cluster.patterns.adrSections.length === 0) {
        continue;
      }
      const includeGlob = cluster.includeGlob;
      candidates.push({
        metadata: sec001Metadata,
        relevance: sec001Relevance({
          includeGlob,
          adrSections: cluster.patterns.adrSections,
        }),
        options: {
          files: [includeGlob],
          sections: cluster.patterns.adrSections,
        },
        ownsMessage: (message) =>
          message.ruleId === "SEC-001" &&
          matchesConfigGlob(message.filePath, [includeGlob]),
      });
    }
  }

  // Resolve through the registry exactly as the config loader does, so the dry run below exercises
  // the same options validation the written file will face. A candidate the registry refuses is
  // dropped rather than thrown on: the same silent degradation a missing id gets, since a draft that
  // crashes is strictly worse for the user than one proposing one rule fewer.
  const dryRunRules: ResolvedRule[] = [];
  const runnable: RuleCandidate[] = [];
  for (const candidate of candidates) {
    try {
      dryRunRules.push({
        rule: registry.resolveRule(candidate.metadata.id, candidate.options),
      });
      runnable.push(candidate);
    } catch {
      continue;
    }
  }

  // One pass over the corpus already in memory, with the graph already built — the same entry point
  // `lintFiles` reaches after its own discovery half, so inline `disable` directives, project-scope
  // rules and severity resolution all behave here exactly as they will for the user.
  const dryRun = lintCorpus({
    documents,
    rules: dryRunRules,
    rootDir,
    settings,
    graph,
  });

  const rules: InferredRule[] = runnable.map((candidate) => {
    const owned = dryRun.messages.filter((message) =>
      candidate.ownsMessage(message),
    );
    const affectedFileCount = new Set(owned.map((message) => message.filePath))
      .size;
    const severity = proposedSeverity(owned.length);
    return {
      rule: candidate.metadata.id,
      category: candidate.metadata.category,
      description: candidate.metadata.description,
      defaultSeverity: candidate.metadata.defaultSeverity,
      ...(severity === undefined ? {} : { severity }),
      fixable: candidate.metadata.fixable,
      rationale: composeRationale({
        relevance: candidate.relevance,
        findingCount: owned.length,
        affectedFileCount,
        corpusFileCount,
      }),
      ...(candidate.options === undefined
        ? {}
        : { options: candidate.options }),
    };
  });

  rules.sort((left, right) => {
    const idDiff = compareStrings(left.rule, right.rule);
    return idDiff !== 0
      ? idDiff
      : compareStrings(fileScopeSortKey(left), fileScopeSortKey(right));
  });

  return { clusters: clusterInferences, rules, corpusFileCount };
}
