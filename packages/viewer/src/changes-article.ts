import type { Element, ElementContent } from "hast";
import { h } from "hastscript";

import type { GitChange, TextDiff } from "@wastech-mdlint/core";

import { BASELINES, changesHref, documentViewHref } from "./change-banner.js";
import { plural, renderDiff, stats, statusBadge } from "./change-diff.js";
import {
  changeCardId,
  type CompareMode,
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
import { firstScreenMarker } from "./page.js";
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
  mode: CompareMode,
  context?: ReviewContext,
  reviewed?: ReviewView,
): ElementContent[] {
  const baseline = reviewed?.baseline ?? "base";
  const article: ElementContent[] = [
    h("h1", "Changes"),
    renderControls(mode, baseline, reviewed),
  ];
  if ("available" in result) {
    article.push(
      h("p.changes-unavailable", result.message),
      h("p.changes-hint", result.hint),
    );
    return article;
  }

  article.push(...renderSummary(result, mode, context));
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
    article.push(
      renderFileList({ documents, mode, context, markOf, reviewed }),
    );
  }
  const affected =
    context === undefined ? undefined : renderAffected(context.delta);
  if (affected !== undefined) {
    article.push(affected);
  }
  const cards = [
    ...(result.config === undefined
      ? []
      : [configCard(result.config, context)]),
    ...documents.map((review) =>
      documentCard(review, {
        mode,
        context,
        mark: markOf(review.path),
        reviewed,
      }),
    ),
  ];
  // The page is drawn once the overview and the first card are read; the diffs of the rest, most of
  // the page, follow out of sight.
  article.push(
    ...cards.slice(0, 1),
    ...(cards.length > 1 ? [firstScreenMarker()] : []),
    ...cards.slice(1),
  );
  return article;
}

// The comparisons the switch offers. The whole branch is the default and comes first; each of the
// other two leaves part of it out — the work not committed yet, or everything already committed.
const COMPARE_SEGMENTS: readonly (readonly [CompareMode, string])[] = [
  ["branch", "Branch"],
  ["commits", "Commits only"],
  ["uncommitted", "Uncommitted"],
];

// What the review starts from, named for a sentence: the base branch, or — for uncommitted work —
// the last commit, which a reader would not recognise as "the base branch".
function startName(mode: CompareMode): string {
  return mode === "uncommitted" ? "the last commit" : "the base branch";
}

// What to compare: the whole branch, its commits only or the uncommitted work alone, and — with
// review marks — what the review starts from or the reader's last review.
function renderControls(
  mode: CompareMode,
  baseline: Baseline,
  reviewed: ReviewView | undefined,
): Element {
  return h("div.changes-controls", [
    h(
      "nav.changes-mode.segmented",
      { ariaLabel: "What to compare" },
      COMPARE_SEGMENTS.map(([value, label]) =>
        h(
          "a.segment",
          {
            href: changesHref(value, baseline),
            ariaCurrent: value === mode ? "page" : undefined,
          },
          label,
        ),
      ),
    ),
    reviewed === undefined
      ? undefined
      : h(
          "nav.changes-since.segmented",
          { ariaLabel: "Compare with" },
          BASELINES.map(([value, label]) =>
            h(
              "a.segment",
              {
                href: changesHref(mode, value),
                ariaCurrent: value === baseline ? "page" : undefined,
              },
              value === "base" && mode === "uncommitted"
                ? "Last commit"
                : label,
            ),
          ),
        ),
  ]);
}

function renderSummary(
  result: Review,
  mode: CompareMode,
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
    h("p.changes-base", baseText(set, mode)),
    ...(context === undefined ? [] : renderContextSummary(context)),
  ];
}

// The sentence naming the comparison. An uncommitted review's base is `HEAD` itself, so "compared
// with HEAD at its tip" would be true and say nothing; it names the last commit instead.
function baseText(set: Review["set"], mode: CompareMode): (string | Element)[] {
  if (mode === "uncommitted") {
    return [
      "Compared with the last commit, ",
      h("code", set.mergeBase.slice(0, 7)),
      ": only what is not committed yet, untracked files included.",
    ];
  }
  return [
    "Compared with ",
    h("code", set.base.ref),
    set.mergeBase === set.base.commit
      ? " at its tip "
      : " where this branch left it, at ",
    h("code", set.mergeBase.slice(0, 7)),
    mode === "branch"
      ? ", including uncommitted and untracked files."
      : ", up to the last commit.",
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
  mode: CompareMode;
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
            stats(shownDiff(review, mark, list.reviewed, list.mode).diff),
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
    mode: CompareMode;
    context: ReviewContext | undefined;
    mark: DocumentMark | undefined;
    reviewed: ReviewView | undefined;
  },
): Element {
  const { mark, reviewed } = shown;
  const baseline = reviewed?.baseline ?? "base";
  const delta = documentContext(shown.context, review.path);
  const diff = shownDiff(review, mark, reviewed, shown.mode);
  return changeCard({
    id: changeCardId(review.path),
    status: review.status,
    path: review.path,
    href:
      review.status === "D"
        ? undefined
        : documentViewHref(
            documentHref(review.path),
            "rendered",
            baseline,
            shown.mode,
          ),
    oldPath: review.oldPath,
    eager: review.eager,
    note: diff.note,
    diff: diff.diff,
    headText: review.headText,
    context: delta === undefined ? undefined : renderDocumentContext(delta),
    ...(mark === undefined
      ? {}
      : { mark, toggle: reviewToggle(review, mark, shown.mode) }),
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
 * nothing to show; one never reviewed, or whose reviewed text is no longer kept, falls back to what
 * the review starts from, and the card says so rather than passing one comparison off as the other.
 */
function shownDiff(
  review: DocumentReview,
  mark: DocumentMark | undefined,
  reviewed: ReviewView | undefined,
  mode: CompareMode,
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
        ? `The version you reviewed is no longer kept, so this compares with ${startName(mode)}.`
        : `Not reviewed yet, so this compares with ${startName(mode)}.`,
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
