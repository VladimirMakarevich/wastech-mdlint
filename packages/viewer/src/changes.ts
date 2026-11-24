import {
  type BranchContext,
  branchContext,
  type BranchReview,
  type CorpusSnapshot,
  type DocumentContextDelta,
  type GitRepository,
  type GitUnavailable,
  openGitRepository,
  type ReviewedConfig,
  type ReviewedDocument,
  reviewBranch,
} from "@wastech-mdlint/core";

import type { Corpus } from "./corpus.js";
import {
  contextPayload,
  documentContextPayload,
  findingsPayload,
} from "./context-view.js";
import type { ReviewMarksView } from "./review-state.js";

// The review of a branch's changes to the corpus: which documents changed against the base branch,
// most influential first, each with its diff. Everything computed here comes from core — the change
// set, the order, the diff, the context delta — and this module only keeps it between requests and
// lays it out as data; the pages draw it from `changes-article.ts`, `change-banner.ts` and
// `change-diff.ts`.

// A changed document as core reviewed it. The base text holds the blocks the branch removed, which a
// document's page puts back; the head text tells that page whether this diff describes the very
// text it is rendering.
export type DocumentReview = ReviewedDocument;

export type ConfigReview = ReviewedConfig;

/** The corpus as the review read it: one moment, whatever updates land while it is computed. */
export type ReviewSnapshot = CorpusSnapshot;

export type Review = BranchReview & { snapshot: ReviewSnapshot };

/** What a review's change does to the context, as core computes it. */
export type ReviewContext = BranchContext;

export type ReviewResult = Review | GitUnavailable;

type Cached = { key: string; result: Review };

/**
 * Keeps the review between requests, for as long as the viewer runs.
 *
 * A review is stale when the work tree changed — which the corpus watcher reports, and the server
 * passes on through `invalidate` — or when `HEAD` or the base moved without the work tree changing,
 * as a commit, a `reset --soft` or a fetch does. Where the repository is watched, the watcher on
 * git's `HEAD` and refs reports the second too, through `gitMoved`, and a kept review is answered
 * without asking git: that one short process was most of the time a document page took to answer,
 * and every navigation paid it although nothing had moved. Without a watcher nothing would report
 * it, so git is asked on every request instead.
 *
 * Requests that arrive while a review is being computed wait for that one rather than starting
 * their own: after a save, the reloading document page, the open pages' scripts and every other tab
 * all ask at once, and each would otherwise run the whole review again.
 */
export class ChangeTracker {
  private readonly cache = new Map<boolean, Cached>();
  private readonly pending = new Map<boolean, Promise<ReviewResult>>();
  // Bumped by `invalidate`, so a review that was already running when the work tree changed is
  // neither cached nor joined: it describes the files as they were before.
  private generation = 0;
  private readonly contexts = new WeakMap<
    Review,
    Promise<ReviewContext | undefined>
  >();
  private warming: Promise<void> = Promise.resolve();
  // Whether git's `HEAD` and refs are watched now: from the start, until a watch is lost.
  private watched: boolean;

  private constructor(
    private readonly corpus: Corpus,
    private readonly repository: GitRepository | GitUnavailable,
    private readonly options: { base?: string; watched: boolean },
  ) {
    this.watched = options.watched;
  }

  /**
   * A tracker for the repository holding the corpus, or `undefined` outside any git work tree or
   * without git — where there is no branch to review and the viewer shows no Changes section. A
   * repository git refuses to read (owned by another user, or a git too old) still gets a tracker, so
   * the section can say why it is empty.
   */
  static async open(
    corpus: Corpus,
    options: {
      base?: string;
      env?: NodeJS.ProcessEnv;
      // Whether the server watches git's `HEAD` and refs and calls `gitMoved` when they move.
      watched?: boolean;
    },
  ): Promise<ChangeTracker | undefined> {
    const repository = await openGitRepository(corpus.rootDir, {
      env: options.env,
    });
    if (
      !repository.available &&
      (repository.reason === "not-a-repository" ||
        repository.reason === "no-git-binary")
    ) {
      return undefined;
    }
    return new ChangeTracker(corpus, repository, {
      ...(options.base === undefined ? {} : { base: options.base }),
      watched: options.watched === true,
    });
  }

  /** The repository, when git can read it: where review marks are kept is decided from it. */
  get git(): GitRepository | undefined {
    return this.repository.available ? this.repository : undefined;
  }

  /** The review kept for a mode, without asking git whether it is still current. */
  cached(worktree: boolean): Review | undefined {
    return this.cache.get(worktree)?.result;
  }

  /**
   * Compute the work-tree review and what it does to the context in the background, ahead of the
   * first page that needs them. The context — the base linted beside the head — is what the Changes
   * page, the dashboard's Branch column and a changed document's small graph wait for, a second or so
   * on a corpus of six hundred documents. Every page used to ask for the changes as it opened, which
   * computed it on the way; pages now draw the branch's marks from the review alone, so without this
   * the first of those pages waited for all of it.
   */
  warm(): void {
    const run = this.review(true)
      .then((review) =>
        "available" in review ? undefined : this.context(review),
      )
      .then(
        () => undefined,
        () => undefined,
      );
    this.warming = Promise.all([this.warming, run]).then(() => undefined);
  }

  /**
   * Resolves once every warm-up started so far has finished, so the viewer can close without git
   * still running in the repository: on Windows a directory a process is working in cannot be
   * removed, and a test's temporary repository could not be cleaned up.
   */
  idle(): Promise<void> {
    return this.warming;
  }

  /**
   * Called when the watcher on git's `HEAD` and refs saw something move. Each kept review is checked
   * against git and dropped when it no longer matches, and the work-tree one is computed again where
   * it was; true when that one is now a different review, which the open pages are then told. A ref
   * of some other branch moving changes nothing they show, and answers false.
   */
  async gitMoved(): Promise<boolean> {
    const before = this.cached(true);
    const repository = this.repository;
    if (repository.available) {
      for (const [worktree, kept] of [...this.cache]) {
        const key = await repository.revisionKey(kept.result.set.base);
        if (key !== kept.key && this.cache.get(worktree) === kept) {
          this.cache.delete(worktree);
        }
      }
    }
    const after = await this.review(true).catch(() => undefined);
    return after !== undefined && after !== before;
  }

  /**
   * A watch on git's `HEAD` or refs ended or never started, so a move there would go unreported:
   * from now on a kept review is checked against git on every request again.
   */
  watchLost(): void {
    this.watched = false;
  }

  /** Forget every review; the next request computes a fresh one. */
  invalidate(): void {
    this.generation += 1;
    this.cache.clear();
    this.pending.clear();
  }

  async review(worktree: boolean): Promise<ReviewResult> {
    const repository = this.repository;
    if (!repository.available) {
      return repository;
    }
    const cached = this.cache.get(worktree);
    if (
      cached !== undefined &&
      (this.watched ||
        (await repository.revisionKey(cached.result.set.base)) === cached.key)
    ) {
      return cached.result;
    }
    const running = this.pending.get(worktree);
    if (running !== undefined) {
      return running;
    }
    const generation = this.generation;
    const computing: Promise<ReviewResult> = this.compute(repository, worktree)
      .then((result) => {
        // A problem such as a missing base is not kept, and is asked again every time: a fetch or
        // a new branch may have solved it, and nothing on disk the watcher sees would say so.
        if (!("available" in result) && generation === this.generation) {
          this.cache.set(worktree, {
            key: `${result.set.head}:${result.set.base.commit}`,
            result,
          });
        }
        return result;
      })
      .finally(() => {
        if (this.pending.get(worktree) === computing) {
          this.pending.delete(worktree);
        }
      });
    this.pending.set(worktree, computing);
    return computing;
  }

  /**
   * What `review`'s change does to the context, computed on first request and kept with the review,
   * so it lasts exactly as long as the review does. Apart from the review because only the Changes
   * page and its JSON need it: a document's page, which waits for the review, never waits for a lint
   * of two corpora as well. `undefined` when the work-tree review it is built on cannot be made.
   */
  context(review: Review): Promise<ReviewContext | undefined> {
    let pending = this.contexts.get(review);
    if (pending === undefined) {
      pending = this.computeContext(review);
      this.contexts.set(review, pending);
      // A failure is not kept, so the next request tries again rather than showing nothing forever.
      pending.catch(() => this.contexts.delete(review));
    }
    return pending;
  }

  private async computeContext(
    review: Review,
  ): Promise<ReviewContext | undefined> {
    const repository = this.repository;
    const worktree = review.set.worktree ? review : await this.review(true);
    if (
      !repository.available ||
      "available" in worktree ||
      worktree.set.mergeBase !== review.set.mergeBase
    ) {
      // The two reviews disagree about the merge-base only while one of them is being replaced;
      // the next request finds both new.
      this.contexts.delete(review);
      return undefined;
    }
    return branchContext({
      repository,
      rootDir: this.corpus.rootDir,
      review,
      worktree,
      disk: worktree.snapshot,
      ordering: review.snapshot,
    });
  }

  private async compute(
    repository: GitRepository,
    worktree: boolean,
  ): Promise<ReviewResult> {
    // One snapshot of the corpus for the whole computation, so the documents, the graph and the
    // config all describe the same moment even if an update lands meanwhile.
    const corpus = this.corpus;
    const snapshot: ReviewSnapshot = {
      documents: corpus.documents,
      graph: corpus.graph,
      configuration: corpus.configuration,
      membership: corpus.membership(),
    };
    const review = await reviewBranch(repository, {
      ...(this.options.base === undefined ? {} : { base: this.options.base }),
      worktree,
      corpus: snapshot,
    });
    return "available" in review ? review : { ...review, snapshot };
  }
}

/**
 * `/api/changes`: what the page lists, as data. Diffs are left to `/api/changes/diff`. With the
 * review's context, every document carries its findings, size and links, and the list is in the
 * page's order; without it — it could not be computed — those are `null`. With review marks, every
 * document carries its status and the hash a mark must name, and `review` counts what is left; both
 * are `null` where marks are off, and `review` says why when they could not be read. No time from the
 * marks appears here, so the payload depends only on the files and the marks.
 */
export function changesPayload(
  result: ReviewResult,
  context?: ReviewContext,
  marks?: ReviewMarksView,
): unknown {
  if ("available" in result) {
    return {
      status: "unavailable",
      reason: result.reason,
      message: result.message,
      hint: result.hint,
    };
  }
  const { set } = result;
  return {
    status: "ready",
    base: set.base,
    mergeBase: set.mergeBase,
    head: set.head,
    worktree: set.worktree,
    added: totalOf(result, "added"),
    removed: totalOf(result, "removed"),
    config:
      result.config === undefined
        ? null
        : {
            path: result.config.path,
            status: result.config.status,
            added: result.config.diff.added,
            removed: result.config.diff.removed,
            findings:
              context?.delta.configOnly === undefined
                ? null
                : findingsPayload(context.delta.configOnly),
          },
    documents: ordered(result, context).map((review) => {
      const delta = documentContext(context, review.path);
      const mark =
        marks?.ok === true ? marks.documents.get(review.path) : undefined;
      return {
        path: review.path,
        ...(review.oldPath === undefined ? {} : { oldPath: review.oldPath }),
        status: review.status,
        eager: review.eager,
        reach: review.reach,
        added: review.diff.added,
        removed: review.diff.removed,
        // The id of its card on the Changes page, so a page script links to it without deriving
        // the id a second way.
        anchor: changeCardId(review.path),
        context: delta === undefined ? null : documentContextPayload(delta),
        review:
          mark === undefined
            ? null
            : { status: mark.status, hash: mark.hash, sections: mark.sections },
      };
    }),
    outsideCorpus: set.outsideCorpus,
    context: context === undefined ? null : contextPayload(context),
    review: reviewPayload(result, marks),
  };
}

function reviewPayload(
  review: Review,
  marks: ReviewMarksView | undefined,
): unknown {
  if (marks === undefined) {
    return null;
  }
  return marks.ok
    ? { state: "ready", left: marks.left, total: review.documents.length }
    : { state: "unavailable", message: marks.message };
}

// The review's documents in the order to read them: with its context, the order that also moves
// documents given new errors up; without it, the review's own.
export function ordered(
  review: Review,
  context?: ReviewContext,
): DocumentReview[] {
  if (context === undefined) {
    return review.documents;
  }
  const byPath = new Map(review.documents.map((entry) => [entry.path, entry]));
  return context.order.flatMap((relPath) => {
    const entry = byPath.get(relPath);
    return entry === undefined ? [] : [entry];
  });
}

export function documentContext(
  context: ReviewContext | undefined,
  relPath: string,
): DocumentContextDelta | undefined {
  return context?.delta.documents.find((entry) => entry.path === relPath);
}

/**
 * The diff of one path in the review — a document or the config — or `undefined` when the review
 * holds no such path. The path is only ever compared with the review's own, never read from disk.
 */
export function diffPayload(review: Review, relPath: string): unknown {
  const document = review.documents.find((entry) => entry.path === relPath);
  if (document !== undefined) {
    return {
      path: document.path,
      ...(document.oldPath === undefined ? {} : { oldPath: document.oldPath }),
      status: document.status,
      diff: document.diff,
    };
  }
  if (review.config?.path === relPath) {
    return {
      path: review.config.path,
      status: review.config.status,
      diff: review.config.diff,
    };
  }
  return undefined;
}

export function totalOf(review: Review, side: "added" | "removed"): number {
  return review.documents.reduce(
    (sum, document) => sum + document.diff[side],
    0,
  );
}

/** The id of a path's card on the Changes page; it holds a `.`, as every id the viewer makes does. */
export function changeCardId(relPath: string): string {
  return `change.${encodeURIComponent(relPath)}`;
}
