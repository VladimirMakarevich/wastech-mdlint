import { readFile } from "node:fs/promises";

import type { Element, ElementContent } from "hast";
import { h } from "hastscript";

import {
  type ChangeSet,
  collectChangeSet,
  type ContextGraph,
  type CorpusMembership,
  type DiffLine,
  diffText,
  type DocumentContextDelta,
  eagerContextPaths,
  type GitChange,
  type GitRepository,
  type GitUnavailable,
  type LoadedConfiguration,
  openGitRepository,
  parseDocument,
  type ParsedDocument,
  type RankedChange,
  rankByInfluence,
  tableRowLines,
  type TextDiff,
} from "@wastech-mdlint/core";

import type { Corpus } from "./corpus.js";
import { documentHref } from "./render-document.js";
import {
  contextPayload,
  documentContextPayload,
  findingsPayload,
  findingsText,
  renderAffected,
  renderConfigOnly,
  renderContextSummary,
  renderDocumentContext,
} from "./context-view.js";
import { computeReviewContext, type ReviewContext } from "./review-context.js";
import {
  type Baseline,
  type DocumentMark,
  type ReviewMarksView,
  reviewChip,
  reviewProblem,
  reviewToggle,
} from "./review-state.js";

// The review of a branch's changes to the corpus: which documents changed against the base branch,
// most influential first, each with its diff. Everything computed here comes from core — the change
// set, the order, the diff — and this module only keeps it between requests and lays it out.

export type DocumentReview = RankedChange & {
  diff: TextDiff;
  // The texts the diff compares, "" on the side a document does not exist. The base text holds the
  // blocks the branch removed, which a document's page puts back; the head text tells that page
  // whether this diff describes the very text it is rendering.
  baseText: string;
  headText: string;
  // Each side parsed, where it exists: the diff needs their table rows, and the review of the
  // context lints them, so neither parses a changed document a second time.
  baseDocument?: ParsedDocument;
  headDocument?: ParsedDocument;
};

export type ConfigReview = {
  path: string;
  status: GitChange["status"];
  diff: TextDiff;
  // The config's text on each side it exists on: the base side's is what the base was linted with.
  baseText?: string;
  headText?: string;
};

/** The corpus as the review read it: one moment, whatever updates land while it is computed. */
export type ReviewSnapshot = {
  documents: ReadonlyMap<string, ParsedDocument>;
  graph: ContextGraph;
  configuration: LoadedConfiguration;
  membership: CorpusMembership;
};

export type Review = {
  set: ChangeSet;
  documents: DocumentReview[];
  config?: ConfigReview;
  snapshot: ReviewSnapshot;
};

export type ReviewResult = Review | GitUnavailable;

// A diff longer than this starts folded, so a branch with a few large rewrites still opens on the
// list of what changed rather than on the first rewrite.
const FOLDED_DIFF_LINES = 300;

type Cached = { key: string; result: Review };

/**
 * Keeps the review between requests, for as long as the viewer runs.
 *
 * A review is stale when the work tree changed — which the corpus watcher reports, and the server
 * passes on through `invalidate` — or when `HEAD` or the base moved without the work tree changing,
 * as a commit, a `reset --soft` or a fetch does. The second is asked of git on every request, in one
 * process: a few milliseconds, against the several processes and the diffs a full review costs.
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

  private constructor(
    private readonly corpus: Corpus,
    private readonly repository: GitRepository | GitUnavailable,
    private readonly base: string | undefined,
  ) {}

  /**
   * A tracker for the repository holding the corpus, or `undefined` outside any git work tree or
   * without git — where there is no branch to review and the viewer shows no Changes section. A
   * repository git refuses to read (owned by another user, or a git too old) still gets a tracker, so
   * the section can say why it is empty.
   */
  static async open(
    corpus: Corpus,
    options: { base?: string; env?: NodeJS.ProcessEnv },
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
    return new ChangeTracker(corpus, repository, options.base);
  }

  /** The repository, when git can read it: where review marks are kept is decided from it. */
  get git(): GitRepository | undefined {
    return this.repository.available ? this.repository : undefined;
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
      (await repository.revisionKey(cached.result.set.base)) === cached.key
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
    return computeReviewContext({
      repository,
      rootDir: this.corpus.rootDir,
      review,
      worktree,
    });
  }

  private async compute(
    repository: GitRepository,
    worktree: boolean,
  ): Promise<ReviewResult> {
    // One snapshot of the corpus for the whole computation, so the documents, the graph and the
    // config all describe the same moment even if an update lands meanwhile.
    const corpus = this.corpus;
    const membership = corpus.membership();
    const documents = corpus.documents;
    const graph = corpus.graph;
    const configuration = corpus.configuration;

    const set = await collectChangeSet(repository, {
      base: this.base,
      worktree,
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
    // Without the work tree, the other side is what `HEAD` holds; with it, what the corpus read
    // from disk — the same text every other page of the viewer shows.
    const headBlobs = worktree
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
    const reviews = ranked.map((change): DocumentReview => {
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

    let config: ConfigReview | undefined;
    if (configPath !== undefined) {
      const base = baseTexts.get(configPath);
      const head =
        headBlobs === undefined
          ? await readConfigText(configuration.configPath)
          : headBlobs.get(configPath);
      config = {
        path: configPath,
        status: base === undefined ? "A" : head === undefined ? "D" : "M",
        diff: diffText(base ?? "", head ?? ""),
        ...(base === undefined ? {} : { baseText: base }),
        ...(head === undefined ? {} : { headText: head }),
      };
    }

    return {
      set,
      documents: reviews,
      config,
      snapshot: { documents, graph, configuration, membership },
    };
  }
}

async function readConfigText(
  absolutePath: string | undefined,
): Promise<string | undefined> {
  return absolutePath === undefined
    ? undefined
    : readFile(absolutePath, "utf8").catch(() => undefined);
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
          mark === undefined ? null : { status: mark.status, hash: mark.hash },
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
function ordered(review: Review, context?: ReviewContext): DocumentReview[] {
  if (context === undefined) {
    return review.documents;
  }
  const byPath = new Map(review.documents.map((entry) => [entry.path, entry]));
  return context.order.flatMap((relPath) => {
    const entry = byPath.get(relPath);
    return entry === undefined ? [] : [entry];
  });
}

function documentContext(
  context: ReviewContext | undefined,
  relPath: string,
): DocumentContextDelta | undefined {
  return context?.delta.documents.find((entry) => entry.path === relPath);
}

/**
 * The diff of one path in the review — a document or the config — or `undefined` when the review
 * holds no such path. The path is only ever compared with the review's own, never read from disk.
 */
export function diffPayload(
  review: Review,
  relPath: string,
): unknown | undefined {
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

function totalOf(review: Review, side: "added" | "removed"): number {
  return review.documents.reduce(
    (sum, document) => sum + document.diff[side],
    0,
  );
}

/** The id of a path's card on the Changes page; it holds a `.`, as every id the viewer makes does. */
export function changeCardId(relPath: string): string {
  return `change.${encodeURIComponent(relPath)}`;
}

const STATUS_NAMES: Record<GitChange["status"], string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
};

/**
 * How a changed document's page shows its changes: marked on the rendered text, as its source diff
 * in place of the text, or not at all. Kept in the address (`?diff=`), so a reload and a shared link
 * show the same view; anything else there is the default, `rendered`.
 */
export type DiffView = "rendered" | "source" | "off";

export function diffViewOf(params: URLSearchParams): DiffView {
  const value = params.get("diff");
  return value === "source" || value === "off" ? value : "rendered";
}

const DIFF_VIEWS: readonly (readonly [DiffView, string])[] = [
  ["rendered", "Rendered"],
  ["source", "Source"],
  ["off", "Off"],
];

/**
 * The line above a changed document's text: what the branch did to it, the switch between the
 * views of its changes, and the way to its card on the Changes page. Rendered with the page, from the
 * review the page was marked with, so it is there without script and nothing below it moves once
 * the page has loaded. The switch is a row of links, which work without script too.
 */
export function renderChangeBanner(
  review: DocumentReview,
  view: DiffView,
  reviewed?: BannerReview,
): Element {
  const page = documentHref(review.path);
  const baseline = reviewed?.baseline ?? "base";
  const since = baseline === "review" ? reviewed?.since : undefined;
  return h("div.changes-banner", [
    statusBadge(review.status),
    h(
      "span.changes-banner-text",
      since === undefined
        ? `${STATUS_NAMES[review.status]} in this branch${
            review.oldPath === undefined ? "" : `, from ${review.oldPath}`
          } · ${stats(review.diff)}`
        : since.diff.hunks.length === 0 && !since.diff.newlineAtEndChanged
          ? "Unchanged since your review"
          : `Changed since your review · ${stats(since.diff)}`,
    ),
    reviewChip(reviewed?.mark),
    reviewed === undefined
      ? undefined
      : reviewToggle(review, reviewed.mark, true),
    // Offered where an earlier version was reviewed, and kept on a reviewed document while it is in
    // use, so the way back is there. A document never reviewed has nothing to compare with.
    reviewed !== undefined &&
    (reviewed.mark.status === "changed" ||
      (reviewed.mark.status === "reviewed" && baseline === "review"))
      ? h(
          "nav.changes-since.segmented.is-compact",
          { ariaLabel: "Compare with" },
          BASELINES.map(([value, label]) =>
            h(
              "a.segment",
              {
                href: documentViewHref(page, view, value),
                ariaCurrent: value === baseline ? "page" : undefined,
              },
              label,
            ),
          ),
        )
      : undefined,
    h(
      "nav.changes-view.segmented.is-compact",
      { ariaLabel: "Show the changes" },
      DIFF_VIEWS.map(([value, label]) =>
        h(
          "a.segment",
          {
            href: documentViewHref(page, value, baseline),
            ariaCurrent: value === view ? "page" : undefined,
          },
          label,
        ),
      ),
    ),
    h(
      "a.changes-banner-link",
      {
        href: `${changesHref(true, baseline)}#${changeCardId(review.path)}`,
      },
      "Changes page",
    ),
  ]);
}

/** What the line above a changed document says about the reader's review of it. */
export type BannerReview = {
  mark: DocumentMark;
  baseline: Baseline;
  // The document's review since the reader's last review, when the page compares with that.
  since?: DocumentReview;
};

const BASELINES: readonly (readonly [Baseline, string])[] = [
  ["base", "Base branch"],
  ["review", "My last review"],
];

function documentViewHref(
  page: string,
  view: DiffView,
  baseline: Baseline,
): string {
  const params = new URLSearchParams();
  if (view !== "rendered") {
    params.set("diff", view);
  }
  if (baseline === "review") {
    params.set("since", "review");
  }
  const query = params.toString();
  return query === "" ? page : `${page}?${query}`;
}

function changesHref(worktree: boolean, baseline: Baseline): string {
  const params = new URLSearchParams();
  if (!worktree) {
    params.set("worktree", "0");
  }
  if (baseline === "review") {
    params.set("since", "review");
  }
  const query = params.toString();
  return query === "" ? "/changes" : `/changes?${query}`;
}

/**
 * Each hunk of a diff on its own, inert inside a `<template>` until the page script shows one beside
 * the block it changed. Rendered here, by the code that renders the Changes page, so the browser
 * never draws a diff of its own that could disagree with it.
 */
export function renderHunkTemplate(diff: TextDiff): Element {
  return h(
    "template.change-hunks",
    diff.hunks.map((hunk, index) =>
      h(
        "div.change-hunk",
        { dataHunk: index },
        renderDiff({
          hunks: [hunk],
          added: 0,
          removed: 0,
          newlineAtEndChanged: false,
        }),
      ),
    ),
  );
}

/**
 * The Changes page's article, rendered on the server so it reads the same without script. With the
 * review's context, the summary also says what the change does to findings and every session's
 * budget, the documents it reaches follow the list, and each card shows its document's context.
 */
export function renderChangesArticle(
  result: ReviewResult,
  worktree: boolean,
  context?: ReviewContext,
  reviewed?: ReviewView,
): ElementContent[] {
  const baseline = reviewed?.baseline ?? "base";
  const article: ElementContent[] = [
    h("h1", "Changes"),
    h("div.changes-controls", [
      h("nav.changes-mode.segmented", { ariaLabel: "What to compare" }, [
        h(
          "a.segment",
          {
            href: changesHref(true, baseline),
            ariaCurrent: worktree ? "page" : undefined,
          },
          "Work tree",
        ),
        h(
          "a.segment",
          {
            href: changesHref(false, baseline),
            ariaCurrent: worktree ? undefined : "page",
          },
          "Commits only",
        ),
      ]),
      reviewed === undefined
        ? undefined
        : h(
            "nav.changes-since.segmented",
            { ariaLabel: "Compare with" },
            BASELINES.map(([value, label]) =>
              h(
                "a.segment",
                {
                  href: changesHref(worktree, value),
                  ariaCurrent: value === baseline ? "page" : undefined,
                },
                label,
              ),
            ),
          ),
    ]),
  ];
  if ("available" in result) {
    article.push(
      h("p.changes-unavailable", result.message),
      h("p.changes-hint", result.hint),
    );
    return article;
  }

  const { set } = result;
  const added = totalOf(result, "added");
  const removed = totalOf(result, "removed");
  article.push(
    h("p.changes-summary", [
      result.documents.length === 0
        ? "No document changed"
        : `${plural(result.documents.length, "document")} changed`,
      result.documents.length === 0 ? "" : ` · +${added} −${removed}`,
    ]),
    h("p.changes-base", [
      "Compared with ",
      h("code", set.base.ref),
      set.mergeBase === set.base.commit
        ? " at its tip "
        : " where this branch left it, at ",
      h("code", set.mergeBase.slice(0, 7)),
      worktree
        ? ", including uncommitted and untracked files."
        : ", up to the last commit.",
    ]),
    ...(context === undefined ? [] : renderContextSummary(context)),
  );
  if (reviewed !== undefined && result.documents.length > 0) {
    article.push(
      reviewed.marks.ok
        ? h("p.changes-review", [
            h(
              "span.changes-review-count",
              `${String(result.documents.length - reviewed.marks.left)} of ${plural(result.documents.length, "document")} reviewed`,
            ),
            // Starting over needs the script that sends the request, so it is hidden until then.
            h(
              "button.review-reset",
              { type: "button", hidden: true },
              "Reset review",
            ),
          ])
        : reviewProblem(reviewed.marks.message),
    );
  }
  const documents = ordered(result, context);
  const markOf = (relPath: string): DocumentMark | undefined =>
    reviewed?.marks.ok === true
      ? reviewed.marks.documents.get(relPath)
      : undefined;

  if (set.outsideCorpus.length > 0) {
    article.push(
      h("details.changes-outside", [
        h(
          "summary",
          `${plural(set.outsideCorpus.length, "Markdown file")} changed outside the corpus`,
        ),
        h(
          "p",
          "The config's include and exclude leave these out, so the linter and this review do not read them.",
        ),
        h(
          "ul",
          set.outsideCorpus.map((change) =>
            h("li", [statusBadge(change.status), " ", h("code", change.path)]),
          ),
        ),
      ]),
    );
  }

  if (result.documents.length > 0) {
    article.push(
      h(
        "nav.changes-files",
        { ariaLabel: "Changed documents" },
        h(
          "ol",
          documents.map((review) => {
            const delta = documentContext(context, review.path);
            const findings =
              delta === undefined ? undefined : findingsText(delta.findings);
            const mark = markOf(review.path);
            return h("li", { dataReview: mark?.status }, [
              statusBadge(review.status),
              " ",
              h("a", { href: `#${changeCardId(review.path)}` }, review.path),
              " ",
              h(
                "span.change-stats",
                stats(shownDiff(review, mark, reviewed).diff),
              ),
              reviewChip(mark),
              review.eager
                ? h(
                    "span.change-eager",
                    { title: "Loaded into every agent session" },
                    "every session",
                  )
                : undefined,
              findings === undefined
                ? undefined
                : h(
                    "span.change-findings",
                    { title: "Findings the change adds and removes" },
                    findings,
                  ),
            ]);
          }),
        ),
      ),
    );
  }
  const affected =
    context === undefined ? undefined : renderAffected(context.delta);
  if (affected !== undefined) {
    article.push(affected);
  }

  if (result.config !== undefined) {
    article.push(
      changeCard({
        id: changeCardId(result.config.path),
        status: result.config.status,
        path: result.config.path,
        note: "The config decides which files are documents and which rules run.",
        diff: result.config.diff,
        context:
          context === undefined
            ? undefined
            : renderConfigOnly(context.delta.configOnly),
      }),
    );
  }
  for (const review of documents) {
    const delta = documentContext(context, review.path);
    const mark = markOf(review.path);
    const shown = shownDiff(review, mark, reviewed);
    article.push(
      changeCard({
        id: changeCardId(review.path),
        status: review.status,
        path: review.path,
        href:
          review.status === "D"
            ? undefined
            : documentViewHref(documentHref(review.path), "rendered", baseline),
        oldPath: review.oldPath,
        eager: review.eager,
        note: shown.note,
        diff: shown.diff,
        context: delta === undefined ? undefined : renderDocumentContext(delta),
        ...(mark === undefined
          ? {}
          : { mark, toggle: reviewToggle(review, mark, worktree) }),
      }),
    );
  }
  return article;
}

/** How the Changes page shows the reader's review: the marks, and what it compares with. */
export type ReviewView = {
  marks: ReviewMarksView;
  baseline: Baseline;
  // Each changed document's review since the reader's last review of it, when the page compares
  // with that and the reviewed text is still kept.
  since: ReadonlyMap<string, DocumentReview>;
};

const NO_DIFF: TextDiff = {
  hunks: [],
  added: 0,
  removed: 0,
  newlineAtEndChanged: false,
};

/**
 * The diff a card shows and what it is against. Comparing with the reader's last review, a document
 * changed since then shows the diff from the version they reviewed; one they reviewed as it is has
 * nothing to show; one never reviewed, or whose reviewed text is no longer kept, falls back to the
 * base branch, and the card says so rather than passing one comparison off as the other.
 */
function shownDiff(
  review: DocumentReview,
  mark: DocumentMark | undefined,
  reviewed: ReviewView | undefined,
): { diff: TextDiff; note?: string } {
  if (reviewed?.baseline !== "review" || mark === undefined) {
    return { diff: review.diff };
  }
  if (mark.status === "reviewed") {
    return { diff: NO_DIFF, note: "Unchanged since your review." };
  }
  const since = reviewed.since.get(review.path);
  if (mark.status === "changed" && since !== undefined) {
    return { diff: since.diff, note: "Changes since your last review." };
  }
  return {
    diff: review.diff,
    note:
      mark.status === "changed"
        ? "The version you reviewed is no longer kept, so this compares with the base branch."
        : "Not reviewed yet, so this compares with the base branch.",
  };
}

function changeCard(card: {
  id: string;
  status: GitChange["status"];
  path: string;
  href?: string;
  oldPath?: string;
  eager?: boolean;
  note?: string;
  diff: TextDiff;
  context?: Element;
  mark?: DocumentMark;
  toggle?: Element;
}): Element {
  const lineCount = card.diff.hunks.reduce(
    (sum, hunk) => sum + hunk.lines.length,
    0,
  );
  // A reviewed card folds to its header and the diff's summary line, as a viewed file does in a
  // pull request, so what is left stands out; its diff opens with one click.
  const folded =
    card.mark?.status === "reviewed" || lineCount > FOLDED_DIFF_LINES;
  return h(
    "section.change-card",
    { id: card.id, dataReview: card.mark?.status },
    [
      h("header.change-card-header", [
        statusBadge(card.status),
        card.href === undefined
          ? h("span.change-path", card.path)
          : h("a.change-path", { href: card.href }, card.path),
        card.oldPath === undefined
          ? undefined
          : h("span.change-from", `from ${card.oldPath}`),
        card.eager === true
          ? h(
              "span.change-eager",
              { title: "Loaded into every agent session" },
              "every session",
            )
          : undefined,
        reviewChip(card.mark),
        h("span.change-stats", stats(card.diff)),
        card.toggle,
      ]),
      card.note === undefined ? undefined : h("p.change-note", card.note),
      card.context,
      h("details.change-diff", { open: !folded }, [
        h(
          "summary",
          lineCount <= FOLDED_DIFF_LINES
            ? "Diff"
            : `Show the diff (${plural(lineCount, "line")})`,
        ),
        renderDiff(card.diff),
      ]),
    ],
  );
}

function statusBadge(status: GitChange["status"]): Element {
  return h(
    `span.change-status.change-status-${status}`,
    { title: STATUS_NAMES[status] },
    status,
  );
}

function stats(diff: TextDiff): string {
  return `+${diff.added} −${diff.removed}`;
}

/**
 * A diff as a table: base and head line numbers, a marker, the line. A paired line's changed words —
 * or cells — are `del` and `ins`, so they read as changes to assistive technology as well as by color.
 */
export function renderDiff(diff: TextDiff): Element {
  if (diff.hunks.length === 0) {
    return h(
      "p.diff-empty",
      diff.newlineAtEndChanged
        ? "Only the final line break changed."
        : "The text is the same on both sides.",
    );
  }
  const rows: Element[] = [];
  for (const hunk of diff.hunks) {
    rows.push(
      h("tr.diff-hunk", [
        h(
          "td",
          { colSpan: 4 },
          `@@ −${hunk.baseStart},${hunk.baseLines} +${hunk.headStart},${hunk.headLines} @@`,
        ),
      ]),
    );
    for (const line of hunk.lines) {
      rows.push(diffRow(line));
    }
  }
  if (diff.newlineAtEndChanged) {
    rows.push(
      h("tr.diff-note", [
        h("td", { colSpan: 4 }, "The final line break changed too."),
      ]),
    );
  }
  return h("div.diff-wrap", h("table.diff", h("tbody", rows)));
}

function diffRow(line: DiffLine): Element {
  const base = line.kind === "added" ? "" : String(line.baseLine);
  const head = line.kind === "removed" ? "" : String(line.headLine);
  const marker =
    line.kind === "added" ? "+" : line.kind === "removed" ? "−" : "";
  const tag = line.kind === "removed" ? "del" : "ins";
  const code: ElementContent[] =
    line.kind !== "context" && line.segments !== undefined
      ? line.segments.map((segment) =>
          segment.changed
            ? h(tag, segment.text)
            : { type: "text", value: segment.text },
        )
      : [{ type: "text", value: line.text }];
  return h(`tr.diff-line.diff-${line.kind}`, [
    h("td.diff-number", base),
    h("td.diff-number", head),
    h("td.diff-marker", marker),
    h("td.diff-code", code),
  ]);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
