import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  type ChangedDocument,
  computeContextDelta,
  type ContextDelta,
  eagerContextPaths,
  type GitRepository,
  lineLinkTargets,
  type LoadedConfiguration,
  parseConfiguration,
  type ParsedDocument,
  rankByInfluence,
  replaceDocuments,
  swapsTowardBase,
  swapsTowardHead,
} from "@wastech-mdlint/core";

import type { DocumentReview, Review } from "./changes.js";

// What a review's change does to the context — findings, sizes, the session budget, links, the
// documents it reaches — computed by core's `computeContextDelta` from two versions of the corpus
// assembled here. Only the parsing the review already did and a lint of each version are spent; the
// corpus is never loaded a second time.

export type ReviewContext = {
  delta: ContextDelta;
  /** The review's documents in the order to read them, with documents given new errors moved up. */
  order: string[];
  /** Why a side could not be linted with its own config, when it could not. */
  configProblems: string[];
};

/**
 * The context delta of `review`. `worktree` is the work-tree review of the same merge-base, which
 * `review` is itself in that mode: only it lists every document that differs from the merge-base,
 * so only it can turn the files on disk into the merge-base's version of the corpus.
 *
 * In the work-tree mode the head side is the corpus as read from disk. With commits only, it is the
 * merge-base's version with the branch's commits applied, so uncommitted edits stay out of it just
 * as they stay out of that mode's diffs.
 */
export async function computeReviewContext(params: {
  repository: GitRepository;
  rootDir: string;
  review: Review;
  worktree: Review;
}): Promise<ReviewContext> {
  const { review, worktree, rootDir } = params;
  const configProblems: string[] = [];
  const disk = worktree.snapshot;
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
  const headConfiguration = review.set.worktree
    ? disk.configuration
    : review.config === undefined
      ? baseConfiguration
      : configurationFrom(review.config.headText, "last commit");

  const baseDocuments = replaceDocuments(
    disk.documents,
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

  const order = rankByInfluence(review.documents, {
    graph: review.snapshot.graph,
    eager: eagerContextPaths(
      review.snapshot.graph,
      review.snapshot.configuration.config,
    ),
    newErrors: new Set(delta.newErrors),
  }).map((change) => change.path);

  return { delta, order, configProblems };
}

function changedDocument(review: DocumentReview): ChangedDocument {
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
  params: { repository: GitRepository; rootDir: string; review: Review },
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
    const headText =
      change.status === "D"
        ? ""
        : headTexts !== undefined
          ? (headTexts.get(change.path) ?? "")
          : // A path git reported under the root, read only to compare it, never served.
            await readFile(
              path.join(rootDir, ...change.path.split("/")),
              "utf8",
            ).catch(() => "");
    texts.set(change.path, { baseText, headText });
  }
  return texts;
}
