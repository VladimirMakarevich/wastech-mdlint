import { readFile } from "node:fs/promises";

import type { Element, ElementContent } from "hast";
import { h } from "hastscript";

import {
  type ChangeSet,
  collectChangeSet,
  type DiffLine,
  diffText,
  eagerContextPaths,
  type GitChange,
  type GitRepository,
  type GitUnavailable,
  openGitRepository,
  parseDocument,
  type RankedChange,
  rankByInfluence,
  tableRowLines,
  type TextDiff,
} from "@wastech-mdlint/core";

import type { Corpus } from "./corpus.js";
import { documentHref } from "./render-document.js";

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
};

export type ConfigReview = {
  path: string;
  status: GitChange["status"];
  diff: TextDiff;
};

export type Review = {
  set: ChangeSet;
  documents: DocumentReview[];
  config?: ConfigReview;
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
      const headDocument =
        headBlobs === undefined ? documents.get(change.path) : undefined;
      return {
        ...change,
        baseText: base,
        headText: head,
        diff: diffText(base, head, {
          baseTableRows: tableRowLines(
            parseDocument({ path: basePath, content: base }),
          ),
          headTableRows: tableRowLines(
            headDocument ?? parseDocument({ path: change.path, content: head }),
          ),
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
      };
    }

    return { set, documents: reviews, config };
  }
}

async function readConfigText(
  absolutePath: string | undefined,
): Promise<string | undefined> {
  return absolutePath === undefined
    ? undefined
    : readFile(absolutePath, "utf8").catch(() => undefined);
}

/** `/api/changes`: what the page lists, as data. Diffs are left to `/api/changes/diff`. */
export function changesPayload(result: ReviewResult): unknown {
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
          },
    documents: result.documents.map((review) => ({
      path: review.path,
      ...(review.oldPath === undefined ? {} : { oldPath: review.oldPath }),
      status: review.status,
      eager: review.eager,
      reach: review.reach,
      added: review.diff.added,
      removed: review.diff.removed,
      // The id of its card on the Changes page, so a page script links to it without deriving the
      // id a second way.
      anchor: changeCardId(review.path),
    })),
    outsideCorpus: set.outsideCorpus,
  };
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
): Element {
  const page = documentHref(review.path);
  return h("div.changes-banner", [
    statusBadge(review.status),
    h(
      "span.changes-banner-text",
      `${STATUS_NAMES[review.status]} in this branch${
        review.oldPath === undefined ? "" : `, from ${review.oldPath}`
      } · ${stats(review.diff)}`,
    ),
    h(
      "nav.changes-view.segmented.is-compact",
      { ariaLabel: "Show the changes" },
      DIFF_VIEWS.map(([value, label]) =>
        h(
          "a.segment",
          {
            href: value === "rendered" ? page : `${page}?diff=${value}`,
            ariaCurrent: value === view ? "page" : undefined,
          },
          label,
        ),
      ),
    ),
    h(
      "a.changes-banner-link",
      { href: `/changes#${changeCardId(review.path)}` },
      "Changes page",
    ),
  ]);
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

/** The Changes page's article, rendered on the server so it reads the same without script. */
export function renderChangesArticle(
  result: ReviewResult,
  worktree: boolean,
): ElementContent[] {
  const article: ElementContent[] = [
    h("h1", "Changes"),
    h("nav.changes-mode.segmented", { ariaLabel: "What to compare" }, [
      h(
        "a.segment",
        { href: "/changes", ariaCurrent: worktree ? "page" : undefined },
        "Work tree",
      ),
      h(
        "a.segment",
        {
          href: "/changes?worktree=0",
          ariaCurrent: worktree ? undefined : "page",
        },
        "Commits only",
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
  );

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
          result.documents.map((review) =>
            h("li", [
              statusBadge(review.status),
              " ",
              h("a", { href: `#${changeCardId(review.path)}` }, review.path),
              " ",
              h("span.change-stats", stats(review.diff)),
              review.eager
                ? h(
                    "span.change-eager",
                    { title: "Loaded into every agent session" },
                    "every session",
                  )
                : undefined,
            ]),
          ),
        ),
      ),
    );
  }

  if (result.config !== undefined) {
    article.push(
      changeCard({
        id: changeCardId(result.config.path),
        status: result.config.status,
        path: result.config.path,
        note: "The config decides which files are documents and which rules run.",
        diff: result.config.diff,
      }),
    );
  }
  for (const review of result.documents) {
    article.push(
      changeCard({
        id: changeCardId(review.path),
        status: review.status,
        path: review.path,
        href: review.status === "D" ? undefined : documentHref(review.path),
        oldPath: review.oldPath,
        eager: review.eager,
        diff: review.diff,
      }),
    );
  }
  return article;
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
}): Element {
  const lineCount = card.diff.hunks.reduce(
    (sum, hunk) => sum + hunk.lines.length,
    0,
  );
  return h("section.change-card", { id: card.id }, [
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
      h("span.change-stats", stats(card.diff)),
    ]),
    card.note === undefined ? undefined : h("p.change-note", card.note),
    h("details.change-diff", { open: lineCount <= FOLDED_DIFF_LINES }, [
      h(
        "summary",
        lineCount <= FOLDED_DIFF_LINES
          ? "Diff"
          : `Show the diff (${plural(lineCount, "line")})`,
      ),
      renderDiff(card.diff),
    ]),
  ]);
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
