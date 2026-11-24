import { readFile } from "node:fs/promises";
import path from "node:path";

import type { LoadedConfiguration } from "../config/load-config.js";
import { parseConfiguration } from "../config/load-config.js";
import { createScopeTester } from "../config/scope-tester.js";
import type { ContextGraph } from "../graph/context-graph-types.js";
import { loadContext } from "../graph/load-context.js";
import {
  type GitChange,
  type GitRepository,
  type GitUnavailable,
  openGitRepository,
} from "../git/git-repository.js";
import { parseDocument } from "../markdown/parse-document.js";
import type { ParsedDocument } from "../markdown/document-types.js";
import {
  type ChangeSet,
  collectChangeSet,
  type CorpusMembership,
} from "./change-set.js";
import {
  type ChangedDocument,
  computeContextDelta,
  type ContextDelta,
  lineLinkTargets,
  swapsTowardBase,
  swapsTowardHead,
} from "./context-delta.js";
import {
  eagerContextPaths,
  type RankedChange,
  rankByInfluence,
} from "./influence.js";
import { replaceDocuments } from "./snapshot.js";
import { diffText, tableRowLines, type TextDiff } from "./text-diff.js";

// A branch's review of the corpus: what changed against the base, each changed document read and
// parsed on both sides with its diff, and what the change does to the context. One sequence for
// every host — the viewer reviewing a branch, `lint --since` and `impact --since` in the CLI, the
// MCP tools' `since` — so none of them can pick a different base, read a different side or lint the
// base differently.

/** One changed corpus document, both sides read, with its diff and its place in the review. */
export type ReviewedDocument = RankedChange & {
  diff: TextDiff;
  // The texts the diff compares, "" on the side a document does not exist.
  baseText: string;
  headText: string;
  // Each side parsed, where it exists: the diff needs their table rows, and the context delta lints
  // them, so neither parses a changed document a second time.
  baseDocument?: ParsedDocument;
  headDocument?: ParsedDocument;
};

/** The config file's change, when it changed: the base side is what the base is linted with. */
export type ReviewedConfig = {
  path: string;
  status: GitChange["status"];
  diff: TextDiff;
  baseText?: string;
  headText?: string;
};

/** The corpus as a host loaded it from the work tree, at one moment. */
export type CorpusSnapshot = {
  documents: ReadonlyMap<string, ParsedDocument>;
  graph: ContextGraph;
  configuration: LoadedConfiguration;
  membership: CorpusMembership;
};

export type BranchReview = {
  set: ChangeSet;
  /** Most influential first: eager context, then reach, then path. */
  documents: ReviewedDocument[];
  config?: ReviewedConfig;
};

/**
 * Review a branch's changes to `corpus`. With `worktree`, the head side is the corpus as read from
 * disk — the text every page and every lint of the work tree shows; without it, what `HEAD` holds.
 */
export async function reviewBranch(
  repository: GitRepository,
  params: { base?: string; worktree: boolean; corpus: CorpusSnapshot },
): Promise<BranchReview | GitUnavailable> {
  const { documents, graph, configuration, membership } = params.corpus;
  const set = await collectChangeSet(repository, {
    ...(params.base === undefined ? {} : { base: params.base }),
    worktree: params.worktree,
    corpus: membership,
  });
  if ("available" in set) {
    return set;
  }

  const configPath = set.configChanged ? membership.configPath : undefined;
  const basePaths = set.documents.flatMap((change) =>
    change.status === "A" ? [] : [change.oldPath ?? change.path],
  );
  const headPaths = set.documents.flatMap((change) =>
    change.status === "D" ? [] : [change.path],
  );
  if (configPath !== undefined) {
    basePaths.push(configPath);
    headPaths.push(configPath);
  }
  const baseTexts = await repository.readBlobs(set.mergeBase, basePaths);
  const headBlobs = params.worktree
    ? undefined
    : await repository.readBlobs(set.head, headPaths);
  const headText = (relPath: string): string | undefined =>
    headBlobs === undefined
      ? documents.get(relPath)?.content
      : headBlobs.get(relPath);

  const ranked = rankByInfluence(set.documents, {
    graph,
    eager: eagerContextPaths(graph, configuration.config),
  });
  const reviews = ranked.map((change): ReviewedDocument => {
    const basePath = change.oldPath ?? change.path;
    const base = change.status === "A" ? "" : (baseTexts.get(basePath) ?? "");
    const head = change.status === "D" ? "" : (headText(change.path) ?? "");
    const baseDocument = parseDocument({ path: basePath, content: base });
    const headDocument =
      (headBlobs === undefined ? documents.get(change.path) : undefined) ??
      parseDocument({ path: change.path, content: head });
    return {
      ...change,
      baseText: base,
      headText: head,
      ...(change.status === "A" ? {} : { baseDocument }),
      ...(change.status === "D" ? {} : { headDocument }),
      diff: diffText(base, head, {
        baseTableRows: tableRowLines(baseDocument),
        headTableRows: tableRowLines(headDocument),
      }),
    };
  });

  let config: ReviewedConfig | undefined;
  if (configPath !== undefined) {
    const base = baseTexts.get(configPath);
    const head =
      headBlobs === undefined
        ? await readConfigText(configuration.configPath)
        : headBlobs.get(configPath);
    config = {
      path: configPath,
      status: configChangeStatus(base, head),
      diff: diffText(base ?? "", head ?? ""),
      ...(base === undefined ? {} : { baseText: base }),
      ...(head === undefined ? {} : { headText: head }),
    };
  }

  return { set, documents: reviews, config };
}

// The config's change from its text at each end: absent at the base means added, absent at the head
// means deleted, present at both means modified.
function configChangeStatus(
  base: string | undefined,
  head: string | undefined,
): ReviewedConfig["status"] {
  if (base === undefined) {
    return "A";
  }
  return head === undefined ? "D" : "M";
}

async function readConfigText(
  absolutePath: string | undefined,
): Promise<string | undefined> {
  return absolutePath === undefined
    ? undefined
    : readFile(absolutePath, "utf8").catch(() => undefined);
}

export type BranchContext = {
  delta: ContextDelta;
  /** The review's documents in the order to read them, with documents given new errors moved up. */
  order: string[];
  /** Why a side could not be linted with its own config, when it could not. */
  configProblems: string[];
};

/**
 * What `review`'s change does to the context. `worktree` is the work-tree review of the same
 * merge-base — `review` itself in that mode — and `disk` the corpus it was made from: only that
 * review lists every document that differs from the merge-base, so only it can turn the files on
 * disk into the merge-base's version of the corpus. Without the work tree, the head side is the
 * merge-base's version with the branch's commits applied, so uncommitted edits stay out of it just
 * as they stay out of that mode's diffs.
 */
export async function branchContext(params: {
  repository: GitRepository;
  rootDir: string;
  review: BranchReview;
  worktree: BranchReview;
  disk: CorpusSnapshot;
  // The order's graph and configuration: the corpus the review itself was read from.
  ordering?: CorpusSnapshot;
}): Promise<BranchContext> {
  const { review, worktree, rootDir, disk } = params;
  const configProblems: string[] = [];
  const configPath =
    disk.configuration.configPath ??
    path.join(rootDir, ...(disk.membership.configPath ?? "").split("/"));
  const configurationFrom = (
    text: string | undefined,
    side: string,
  ): LoadedConfiguration => {
    try {
      // A side without a config file lints as the defaults do: every Markdown file, no rules.
      return parseConfiguration({
        text: text ?? "{}",
        cwd: rootDir,
        configPath,
      });
    } catch (error) {
      configProblems.push(
        `The config at the ${side} does not load, so the ${side} is linted with the current one: ${(error as Error).message}`,
      );
      return disk.configuration;
    }
  };

  const baseConfiguration =
    worktree.config === undefined
      ? disk.configuration
      : configurationFrom(worktree.config.baseText, "base");
  let headConfiguration: LoadedConfiguration;
  if (review.set.worktree) {
    headConfiguration = disk.configuration;
  } else if (review.config === undefined) {
    headConfiguration = baseConfiguration;
  } else {
    headConfiguration = configurationFrom(
      review.config.headText,
      "last commit",
    );
  }

  const baseDocuments = replaceDocuments(
    new Map(disk.documents),
    swapsTowardBase(worktree.documents.map(changedDocument)),
  );
  const changes = review.documents.map(changedDocument);
  const headDocuments = review.set.worktree
    ? new Map(disk.documents)
    : replaceDocuments(baseDocuments, swapsTowardHead(changes));

  const delta = computeContextDelta({
    cwd: rootDir,
    base: { documents: baseDocuments, configuration: baseConfiguration },
    head: {
      documents: headDocuments,
      configuration: headConfiguration,
      ...(headConfiguration === disk.configuration && review.set.worktree
        ? { graph: disk.graph }
        : {}),
    },
    changes,
    codeFiles: await linkedCodeTexts(params, headDocuments, headConfiguration),
  });

  const ordering = params.ordering ?? disk;
  const order = rankByInfluence(review.documents, {
    graph: ordering.graph,
    eager: eagerContextPaths(ordering.graph, ordering.configuration.config),
    newErrors: new Set(delta.newErrors),
  }).map((change) => change.path);

  return { delta, order, configProblems };
}

function changedDocument(review: ReviewedDocument): ChangedDocument {
  return {
    path: review.path,
    ...(review.oldPath === undefined ? {} : { oldPath: review.oldPath }),
    status: review.status,
    diff: review.diff,
    ...(review.baseDocument === undefined ? {} : { base: review.baseDocument }),
    ...(review.headDocument === undefined ? {} : { head: review.headDocument }),
  };
}

/**
 * Both versions of every changed non-Markdown file a document links into with a line fragment
 * (`file.ts#L12-L20`): the only changed code whose lines a link can pin. Read from git in one process
 * per side, the head side from disk in the work-tree mode, so the comparison sees exactly the files
 * the diff of that mode sees. A file added by the branch is left out: no link written before it
 * existed can point into it.
 */
async function linkedCodeTexts(
  params: { repository: GitRepository; rootDir: string; review: BranchReview },
  documents: Map<string, ParsedDocument>,
  configuration: LoadedConfiguration,
): Promise<Map<string, { baseText: string; headText: string }>> {
  const { repository, review, rootDir } = params;
  const targets = lineLinkTargets(
    documents.values(),
    configuration.settings.siteRouter,
  );
  const changed = review.set.otherFiles.filter(
    (change) => change.status !== "A" && targets.has(change.path),
  );
  const texts = new Map<string, { baseText: string; headText: string }>();
  if (changed.length === 0) {
    return texts;
  }
  const baseTexts = await repository.readBlobs(
    review.set.mergeBase,
    changed.map((change) => change.oldPath ?? change.path),
  );
  const headTexts = review.set.worktree
    ? undefined
    : await repository.readBlobs(
        review.set.head,
        changed.map((change) => change.path),
      );
  for (const change of changed) {
    const baseText = baseTexts.get(change.oldPath ?? change.path);
    if (baseText === undefined) {
      continue;
    }
    let headText: string;
    if (change.status === "D") {
      headText = "";
    } else if (headTexts !== undefined) {
      headText = headTexts.get(change.path) ?? "";
    } else {
      // A path git reported under the root, read only to compare it, never served.
      headText = await readFile(
        path.join(rootDir, ...change.path.split("/")),
        "utf8",
      ).catch(() => "");
    }
    texts.set(change.path, { baseText, headText });
  }
  return texts;
}

export type SinceAnalysis = {
  review: BranchReview;
  context: BranchContext;
  snapshot: CorpusSnapshot;
};

/**
 * Everything a command needs to answer "since `ref`": the corpus loaded from `cwd`, the work tree's
 * changes against where the branch left `ref`, and what they do to the context. For a one-shot host
 * — a CLI command, an MCP call — that loads the corpus once and asks once; a long-lived host keeps
 * its own corpus and calls `reviewBranch` and `branchContext` itself.
 *
 * A directory outside any git work tree, a missing `git`, or a `ref` that names nothing answers with
 * the reason rather than throwing, so a host can say what to fix.
 */
export async function analyzeSince(params: {
  cwd: string;
  configuration: LoadedConfiguration;
  ref: string;
  env?: NodeJS.ProcessEnv;
}): Promise<SinceAnalysis | GitUnavailable> {
  const rootDir = path.resolve(params.cwd);
  const repository = await openGitRepository(rootDir, {
    ...(params.env === undefined ? {} : { env: params.env }),
  });
  if (!repository.available) {
    return repository;
  }
  const { configuration } = params;
  const { documents, graph } = await loadContext({
    cwd: rootDir,
    config: configuration.config,
    settings: configuration.settings,
  });
  const snapshot: CorpusSnapshot = {
    documents,
    graph,
    configuration,
    membership: {
      documents,
      scope: createScopeTester({ cwd: rootDir, config: configuration.config }),
      ...(configuration.configPath === undefined
        ? {}
        : {
            configPath: path
              .relative(rootDir, configuration.configPath)
              .split(path.sep)
              .join("/"),
          }),
    },
  };
  const review = await reviewBranch(repository, {
    base: params.ref,
    worktree: true,
    corpus: snapshot,
  });
  if ("available" in review) {
    return review;
  }
  const context = await branchContext({
    repository,
    rootDir,
    review,
    worktree: review,
    disk: snapshot,
  });
  return { review, context, snapshot };
}
