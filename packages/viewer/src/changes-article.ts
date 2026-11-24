import type { Element, ElementContent } from "hast";
import { h } from "hastscript";

import type { GitChange, TextDiff } from "@wastech-mdlint/core";

import { BASELINES, changesHref, documentViewHref } from "./change-banner.js";
import { plural, renderDiff, stats, statusBadge } from "./change-diff.js";
import {
  changeCardId,
  type DocumentReview,
  documentContext,
  ordered,
  type Review,
  type ReviewContext,
  type ReviewResult,
  totalOf,
} from "./changes.js";
import {
  findingsText,
  renderAffected,
  renderConfigOnly,
  renderContextSummary,
  renderDocumentContext,
} from "./context-view.js";
import { documentHref } from "./render-document.js";
import {
  type Baseline,
  type DocumentMark,
  type ReviewMarksView,
  reviewChip,
  reviewProblem,
  reviewToggle,
  sectionProgress,
} from "./review-state.js";

// The Changes page's article: the controls, the summary of the branch, the list of changed
// documents and one card per change with its diff.

// A diff longer than this starts folded, so a branch with a few large rewrites still opens on the
// list of what changed rather than on the first rewrite.
const FOLDED_DIFF_LINES = 300;

/** How the Changes page shows the reader's review: the marks, and what it compares with. */
export type ReviewView = {
  marks: ReviewMarksView;
  baseline: Baseline;
  // Each changed document's review since the reader's last review of it, when the page compares
  // with that and the reviewed text is still kept.
  since: ReadonlyMap<string, DocumentReview>;
};

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
    renderControls(worktree, baseline, reviewed),
  ];
  if ("available" in result) {
    article.push(
      h("p.changes-unavailable", result.message),
      h("p.changes-hint", result.hint),
    );
    return article;
  }

  article.push(...renderSummary(result, worktree, context));
  if (reviewed !== undefined && result.documents.length > 0) {
    article.push(renderReviewProgress(result, reviewed.marks));
  }
  const documents = ordered(result, context);
  const markOf = (relPath: string): DocumentMark | undefined =>
    reviewed?.marks.ok === true
      ? reviewed.marks.documents.get(relPath)
      : undefined;

  if (result.set.outsideCorpus.length > 0) {
    article.push(renderOutsideCorpus(result.set.outsideCorpus));
  }
  if (result.documents.length > 0) {
    article.push(renderFileList({ documents, context, markOf, reviewed }));
  }
  const affected =
    context === undefined ? undefined : renderAffected(context.delta);
  if (affected !== undefined) {
    article.push(affected);
  }
  if (result.config !== undefined) {
    article.push(configCard(result.config, context));
  }
  for (const review of documents) {
    article.push(
      documentCard(review, {
        worktree,
        context,
        mark: markOf(review.path),
        reviewed,
      }),
    );
  }
  return article;
}

// What to compare: the work tree or the commits only, and — with review marks — the base branch or
// the reader's last review.
function renderControls(
  worktree: boolean,
  baseline: Baseline,
  reviewed: ReviewView | undefined,
): Element {
  return h("div.changes-controls", [
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
  ]);
}

function renderSummary(
  result: Review,
  worktree: boolean,
  context: ReviewContext | undefined,
): ElementContent[] {
  const { set } = result;
  const added = totalOf(result, "added");
  const removed = totalOf(result, "removed");
  return [
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
  ];
}

function renderReviewProgress(result: Review, marks: ReviewMarksView): Element {
  if (!marks.ok) {
    return reviewProblem(marks.message);
  }
  return h("p.changes-review", [
    h(
      "span.changes-review-count",
      `${String(result.documents.length - marks.left)} of ${plural(result.documents.length, "document")} reviewed`,
    ),
    // Starting over needs the script that sends the request, so it is hidden until then.
    h("button.review-reset", { type: "button", hidden: true }, "Reset review"),
  ]);
}

function renderOutsideCorpus(
  outsideCorpus: Review["set"]["outsideCorpus"],
): Element {
  return h("details.changes-outside", [
    h(
      "summary",
      `${plural(outsideCorpus.length, "Markdown file")} changed outside the corpus`,
    ),
    h(
      "p",
      "The config's include and exclude leave these out, so the linter and this review do not read them.",
    ),
    h(
      "ul",
      outsideCorpus.map((change) =>
        h("li", [statusBadge(change.status), " ", h("code", change.path)]),
      ),
    ),
  ]);
}

function renderFileList(list: {
  documents: DocumentReview[];
  context: ReviewContext | undefined;
  markOf: (relPath: string) => DocumentMark | undefined;
  reviewed: ReviewView | undefined;
}): Element {
  return h(
    "nav.changes-files",
    { ariaLabel: "Changed documents" },
    h(
      "ol",
      list.documents.map((review) => {
        const delta = documentContext(list.context, review.path);
        const findings =
          delta === undefined ? undefined : findingsText(delta.findings);
        const mark = list.markOf(review.path);
        return h("li", { dataReview: mark?.status }, [
          statusBadge(review.status),
          " ",
          h("a", { href: `#${changeCardId(review.path)}` }, review.path),
          " ",
          h(
            "span.change-stats",
            stats(shownDiff(review, mark, list.reviewed).diff),
          ),
          reviewChip(mark),
          review.eager ? eagerBadge() : undefined,
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
  );
}

function eagerBadge(): Element {
  return h(
    "span.change-eager",
    { title: "Loaded into every agent session" },
    "every session",
  );
}

function configCard(
  config: NonNullable<Review["config"]>,
  context: ReviewContext | undefined,
): Element {
  return changeCard({
    id: changeCardId(config.path),
    status: config.status,
    path: config.path,
    note: "The config decides which files are documents and which rules run.",
    diff: config.diff,
    ...(config.headText === undefined ? {} : { headText: config.headText }),
    context:
      context === undefined
        ? undefined
        : renderConfigOnly(context.delta.configOnly),
  });
}

function documentCard(
  review: DocumentReview,
  shown: {
    worktree: boolean;
    context: ReviewContext | undefined;
    mark: DocumentMark | undefined;
    reviewed: ReviewView | undefined;
  },
): Element {
  const { mark, reviewed } = shown;
  const baseline = reviewed?.baseline ?? "base";
  const delta = documentContext(shown.context, review.path);
  const diff = shownDiff(review, mark, reviewed);
  return changeCard({
    id: changeCardId(review.path),
    status: review.status,
    path: review.path,
    href:
      review.status === "D"
        ? undefined
        : documentViewHref(documentHref(review.path), "rendered", baseline),
    oldPath: review.oldPath,
    eager: review.eager,
    note: diff.note,
    diff: diff.diff,
    headText: review.headText,
    context: delta === undefined ? undefined : renderDocumentContext(delta),
    ...(mark === undefined
      ? {}
      : { mark, toggle: reviewToggle(review, mark, shown.worktree) }),
  });
}

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
  // The text the diff ends in, for the unchanged lines a reader can open around each change.
  headText?: string;
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
        card.eager === true ? eagerBadge() : undefined,
        reviewChip(card.mark),
        sectionProgress(card.mark),
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
        renderDiff(card.diff, card.headText),
      ]),
    ],
  );
}
