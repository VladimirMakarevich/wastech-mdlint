import type { LoadedConfiguration } from "../config/load-config.js";
import { compareStrings } from "../deterministic-sort.js";
import { parseLineFragment } from "../engine/anchor-resolve.js";
import {
  type DocumentMetrics,
  measureDocument,
} from "../engine/document-metrics.js";
import { lintContext } from "../engine/lint-files.js";
import { filePart, resolveTargetCandidates } from "../engine/path-resolve.js";
import type { LintMessage, ResolvedSettings } from "../engine/types.js";
import type { GitChange } from "../git/git-repository.js";
import { buildContextGraph } from "../graph/build-context-graph.js";
import type {
  ContextGraph,
  ContextGraphEdge,
} from "../graph/context-graph-types.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import { compareFindings, type FindingsDelta } from "./findings-delta.js";
import { baseLineMap } from "./head-changes.js";
import { eagerContextBudgets } from "./influence.js";
import {
  type CodeLineLink,
  compareEdges,
  type EdgesDelta,
  linksIntoChangedLines,
} from "./link-delta.js";
import type { DocumentSwap } from "./snapshot.js";
import type { TextDiff } from "./text-diff.js";

// What a change does to the context, not only to the text: the findings it adds and removes, what
// each changed document weighs, what every agent session loads, the links it makes and breaks, and
// the unchanged documents it reaches. Pure: both versions of the corpus come in parsed, and nothing
// here reads a file or runs git, so every host — a viewer reviewing a branch, a command linting
// "since" a ref — gets the same answer from the same inputs.

/** One changed document, parsed on each side it exists on, with its diff. */
export type ChangedDocument = {
  path: string;
  oldPath?: string;
  status: GitChange["status"];
  diff: TextDiff;
  base?: ParsedDocument;
  head?: ParsedDocument;
};

/** The swaps that turn the head's corpus into the base's for these changes. */
export function swapsTowardBase(
  changes: readonly ChangedDocument[],
): DocumentSwap[] {
  return changes.map((change) => ({
    ...(change.status === "D" ? {} : { remove: change.path }),
    ...(change.base === undefined ? {} : { add: change.base }),
  }));
}

/** The swaps that turn the base's corpus into the head's for these changes. */
export function swapsTowardHead(
  changes: readonly ChangedDocument[],
): DocumentSwap[] {
  return changes.map((change) => ({
    ...(change.status === "A" ? {} : { remove: change.oldPath ?? change.path }),
    ...(change.head === undefined ? {} : { add: change.head }),
  }));
}

/** One version of the corpus: its documents and the configuration that lints them. */
export type ContextSide = {
  documents: Map<string, ParsedDocument>;
  configuration: LoadedConfiguration;
  // The graph over `documents` under `configuration`'s settings, when the caller already holds it.
  graph?: ContextGraph;
};

export type DocumentContextDelta = {
  path: string;
  oldPath?: string;
  /** Findings in this document: added at its head path, removed at its base path and line. */
  findings: FindingsDelta;
  /** Size on each side the document exists on, as SIZE-001 measures it. */
  base?: DocumentMetrics;
  head?: DocumentMetrics;
  /** The document's own links: added from its head path, removed from its base path. */
  links: { added: ContextGraphEdge[]; removed: ContextGraphEdge[] };
};

/** An LLM-001 entrypoint whose session context the change moved; a side it is not on is absent. */
export type EagerContextChange = {
  entrypoint: string;
  base?: number;
  head?: number;
  maxTokens: number;
};

export type AffectedDocuments = {
  /** Unchanged documents with findings they did not have: a heading renamed elsewhere broke a link. */
  findings: { path: string; added: LintMessage[] }[];
  /** Links from unchanged documents into lines of a changed file that no longer show what they did. */
  codeLinks: CodeLineLink[];
  /** Unchanged documents that link to a changed or deleted document, and which. */
  linking: { path: string; targets: string[] }[];
};

export type ContextDelta = {
  /** Every finding the change adds and removes, removed ones at their base path and line. */
  findings: FindingsDelta;
  documents: DocumentContextDelta[];
  /**
   * Every link the change adds and removes, between any documents: removed ones as the base held
   * them. A link from an unchanged document can come and go too, when the target it named appears
   * or disappears.
   */
  links: EdgesDelta;
  eager: EagerContextChange[];
  affected: AffectedDocuments;
  /** Head paths of changed documents with an error they did not have. */
  newErrors: string[];
  /**
   * What the configuration change alone does to findings over the head's documents, when the two
   * sides are linted with different configurations.
   */
  configOnly?: FindingsDelta;
  /**
   * Whether the two configurations select documents differently. Both sides are still read through
   * the head's selection, since the base's would need its own discovery.
   */
  scopeChanged: boolean;
};

/**
 * Compare two versions of a corpus. `changes` are the documents that differ; every other document
 * is the same on both sides. `codeFiles` holds the text of changed non-Markdown files on both sides,
 * for links into their lines; `lineLinkTargets` says which ones are worth reading.
 */
export function computeContextDelta(params: {
  cwd: string;
  base: ContextSide;
  head: ContextSide;
  changes: readonly ChangedDocument[];
  codeFiles?: ReadonlyMap<string, { baseText: string; headText: string }>;
}): ContextDelta {
  const { base, head, changes } = params;
  const baseGraph = base.graph ?? graphOf(base);
  const headGraph = head.graph ?? graphOf(head);
  const baseFindings = lint(params.cwd, base, baseGraph);
  const headFindings = lint(params.cwd, head, headGraph);

  const findings = compareMovedFindings(baseFindings, headFindings, changes);

  const renamed = new Map(
    changes.flatMap((change) =>
      change.oldPath === undefined ? [] : [[change.oldPath, change.path]],
    ),
  );
  const links = compareEdges(baseGraph, headGraph, renamed);

  const documents = changes.map((change) =>
    documentDelta(change, findings, links),
  );

  const configOnly =
    base.configuration === head.configuration
      ? undefined
      : compareFindings(
          lint(params.cwd, { ...head, configuration: base.configuration }),
          headFindings,
        );

  return {
    findings,
    documents,
    links,
    eager: eagerChanges(base, head),
    affected: affectedByChanges({
      base,
      head,
      changes,
      graphs: { base: baseGraph, head: headGraph },
      addedFindings: findings.added,
      renamed,
      codeFiles: params.codeFiles,
    }),
    newErrors: documents
      .filter((document) =>
        document.findings.added.some((message) => message.severity === "error"),
      )
      .map((document) => document.path),
    ...(configOnly === undefined ? {} : { configOnly }),
    scopeChanged:
      JSON.stringify(scopeOf(base.configuration)) !==
      JSON.stringify(scopeOf(head.configuration)),
  };
}

// The findings that appeared and disappeared between the two sides. A base finding is moved to
// where its line is now: an unchanged document keeps it where it was, a deleted one loses it, and a
// changed one maps it through its diff.
function compareMovedFindings(
  baseFindings: LintMessage[],
  headFindings: LintMessage[],
  changes: readonly ChangedDocument[],
): FindingsDelta {
  const byBasePath = new Map(
    changes
      .filter((change) => change.status !== "A")
      .map((change) => [change.oldPath ?? change.path, change]),
  );
  const lineMaps = new Map<
    ChangedDocument,
    (line: number) => number | undefined
  >();
  return compareFindings(baseFindings, headFindings, (message) => {
    const change = byBasePath.get(message.filePath);
    if (change === undefined) {
      return { filePath: message.filePath, line: message.line };
    }
    if (change.status === "D") {
      return undefined;
    }
    let map = lineMaps.get(change);
    if (map === undefined) {
      map = baseLineMap(change.diff);
      lineMaps.set(change, map);
    }
    const line = map(message.line);
    return line === undefined ? undefined : { filePath: change.path, line };
  });
}

// One changed document's share of the corpus-wide finding and link deltas, with its size on each
// side it exists on.
function documentDelta(
  change: ChangedDocument,
  findings: FindingsDelta,
  links: EdgesDelta,
): DocumentContextDelta {
  const basePath = change.oldPath ?? change.path;
  const inHead = change.status !== "D";
  const inBase = change.status !== "A";
  return {
    path: change.path,
    ...(change.oldPath === undefined ? {} : { oldPath: change.oldPath }),
    findings: {
      added: inHead
        ? findings.added.filter((message) => message.filePath === change.path)
        : [],
      removed: inBase
        ? findings.removed.filter((message) => message.filePath === basePath)
        : [],
    },
    ...(change.base === undefined
      ? {}
      : { base: measureDocument(change.base.content) }),
    ...(change.head === undefined
      ? {}
      : { head: measureDocument(change.head.content) }),
    links: {
      added: inHead
        ? links.added.filter((edge) => edge.from === change.path)
        : [],
      removed: inBase
        ? links.removed.filter((edge) => edge.from === basePath)
        : [],
    },
  };
}

// What the change reaches in documents it did not touch: their new findings, their line links into
// changed code, and their links into changed documents.
function affectedByChanges(params: {
  base: ContextSide;
  head: ContextSide;
  changes: readonly ChangedDocument[];
  graphs: { base: ContextGraph; head: ContextGraph };
  addedFindings: LintMessage[];
  renamed: Map<string, string>;
  codeFiles:
    | ReadonlyMap<string, { baseText: string; headText: string }>
    | undefined;
}): ContextDelta["affected"] {
  const { head, changes, graphs, renamed } = params;
  const changedHead = new Set(
    changes.flatMap((change) => (change.status === "D" ? [] : [change.path])),
  );
  // A link from an unchanged document into a changed one is in the base's graph even when the head's
  // lost it — an anchor into a heading the change renamed no longer resolves, so it is no edge there.
  const changedBase = new Set(
    changes.flatMap((change) =>
      change.status === "A" ? [] : [change.oldPath ?? change.path],
    ),
  );
  const unchanged = [...head.documents.values()].filter(
    (document) => !changedHead.has(document.path),
  );

  return {
    findings: groupByPath(
      params.addedFindings.filter(
        (message) =>
          !changedHead.has(message.filePath) &&
          head.documents.has(message.filePath),
      ),
    ),
    codeLinks:
      params.codeFiles === undefined
        ? []
        : linksIntoChangedLines(
            unchanged,
            params.codeFiles,
            head.configuration.settings.siteRouter,
          ),
    linking: linkingTo(
      [
        ...graphs.head.edges.filter((edge) => changedHead.has(edge.to)),
        ...graphs.base.edges
          .filter((edge) => changedBase.has(edge.to))
          .map((edge) => ({ ...edge, to: renamed.get(edge.to) ?? edge.to })),
      ].filter(
        (edge) => head.documents.has(edge.from) && !changedHead.has(edge.from),
      ),
    ),
  };
}

/**
 * Every file a link with a line fragment (`file.ts#L12-L20`) may point at, among all the paths its
 * target could resolve to. A host reads both versions of the changed files among them, and no other.
 */
export function lineLinkTargets(
  documents: Iterable<ParsedDocument>,
  siteRouter?: ResolvedSettings["siteRouter"],
): Set<string> {
  const targets = new Set<string>();
  for (const document of documents) {
    for (const link of document.links) {
      if (
        link.kind !== "local-file" ||
        link.anchor === undefined ||
        parseLineFragment(link.anchor) === undefined
      ) {
        continue;
      }
      for (const candidate of resolveTargetCandidates(
        document.path,
        filePart(link.rawTarget),
        siteRouter,
      )) {
        targets.add(candidate);
      }
    }
  }
  return targets;
}

function graphOf(side: ContextSide): ContextGraph {
  return buildContextGraph(side.documents, {
    siteRouter: side.configuration.settings.siteRouter,
    idRef: side.configuration.settings.idRef,
  });
}

function lint(
  cwd: string,
  side: ContextSide,
  graph: ContextGraph = graphOf(side),
): LintMessage[] {
  return lintContext({
    cwd,
    context: { documents: side.documents, graph },
    rules: side.configuration.rules,
    settings: side.configuration.settings,
  }).messages;
}

function eagerChanges(
  base: ContextSide,
  head: ContextSide,
): EagerContextChange[] {
  const before = new Map(
    eagerContextBudgets(
      base.documents,
      base.configuration.config,
      base.configuration.settings.siteRouter,
    ).map((budget) => [budget.entrypoint, budget]),
  );
  const after = new Map(
    eagerContextBudgets(
      head.documents,
      head.configuration.config,
      head.configuration.settings.siteRouter,
    ).map((budget) => [budget.entrypoint, budget]),
  );
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort(compareStrings)
    .flatMap((entrypoint) => {
      const was = before.get(entrypoint);
      const now = after.get(entrypoint);
      if (was?.tokens === now?.tokens && was?.maxTokens === now?.maxTokens) {
        return [];
      }
      return [
        {
          entrypoint,
          ...(was === undefined ? {} : { base: was.tokens }),
          ...(now === undefined ? {} : { head: now.tokens }),
          maxTokens: (now ?? was)!.maxTokens,
        },
      ];
    });
}

function groupByPath(
  messages: readonly LintMessage[],
): { path: string; added: LintMessage[] }[] {
  const groups = new Map<string, LintMessage[]>();
  for (const message of messages) {
    groups.set(message.filePath, [
      ...(groups.get(message.filePath) ?? []),
      message,
    ]);
  }
  return [...groups]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([path, added]) => ({ path, added }));
}

function linkingTo(
  edges: readonly ContextGraphEdge[],
): { path: string; targets: string[] }[] {
  const targets = new Map<string, Set<string>>();
  for (const edge of edges) {
    const set = targets.get(edge.from) ?? new Set<string>();
    set.add(edge.to);
    targets.set(edge.from, set);
  }
  return [...targets]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([path, set]) => ({ path, targets: [...set].sort(compareStrings) }));
}

// What decides which files are documents. Compared, not applied: see `scopeChanged`.
function scopeOf(configuration: LoadedConfiguration): unknown[] {
  const { include, exclude, respectGitignore } = configuration.config;
  return [include ?? null, exclude ?? null, respectGitignore ?? null];
}
