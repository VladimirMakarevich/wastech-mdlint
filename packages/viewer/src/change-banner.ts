import type { Element } from "hast";
import { h } from "hastscript";

import { stats, statusBadge, statusName } from "./change-diff.js";
import { changeCardId, type DocumentReview } from "./changes.js";
import { documentHref } from "./render-document.js";
import {
  type Baseline,
  type DocumentMark,
  reviewChip,
  type SectionMark,
  reviewToggle,
} from "./review-state.js";

// The line a changed document's page carries above its text, and the addresses both it and the
// Changes page build: which view of the changes, and which baseline they compare with, live in the
// address, so a reload and a shared link show the same thing.

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

/** What the line above a changed document says about the reader's review of it. */
export type BannerReview = {
  mark: DocumentMark;
  // Each section's own place in the review, by its key, for the outline.
  sections: ReadonlyMap<string, SectionMark>;
  baseline: Baseline;
  // The document's review since the reader's last review, when the page compares with that.
  since?: DocumentReview;
};

export const BASELINES: readonly (readonly [Baseline, string])[] = [
  ["base", "Base branch"],
  ["review", "My last review"],
];

/**
 * The line above a changed document's text: what the branch did to it, the switch between the
 * views of its changes, and the way to its card on the Changes page. Rendered with the page, from the
 * review the page was marked with, so it is there without script and nothing below it moves once
 * the page has loaded. The switch is a row of links, which work without script too.
 *
 * The stylesheet pins the line under the header while the text scrolls, so the views and the
 * "Viewed" mark stay in reach on a long document. The commits that last touched the document are
 * therefore not part of it: opened inside a pinned line, their list would cover the text it was
 * meant to sit above. The page renders them below the line instead, as it does for any document.
 */
export function renderChangeBanner(
  review: DocumentReview,
  view: DiffView,
  reviewed?: BannerReview,
): Element {
  const page = documentHref(review.path);
  const baseline = reviewed?.baseline ?? "base";
  return h("div.changes-banner", [
    statusBadge(review.status),
    h("span.changes-banner-text", bannerText(review, reviewed, baseline)),
    reviewChip(reviewed?.mark),
    reviewed === undefined
      ? undefined
      : reviewToggle(review, reviewed.mark, true),
    baselineSwitch(page, view, baseline, reviewed),
    h(
      "nav.changes-view.segmented.is-compact.is-even",
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

// What the branch did to the document, or — compared with the reader's last review — what changed
// since then.
function bannerText(
  review: DocumentReview,
  reviewed: BannerReview | undefined,
  baseline: Baseline,
): string {
  const since = baseline === "review" ? reviewed?.since : undefined;
  if (since === undefined) {
    const from = review.oldPath === undefined ? "" : `, from ${review.oldPath}`;
    return `${statusName(review.status)} in this branch${from} · ${stats(review.diff)}`;
  }
  if (since.diff.hunks.length === 0 && !since.diff.newlineAtEndChanged) {
    return "Unchanged since your review";
  }
  return `Changed since your review · ${stats(since.diff)}`;
}

// Offered where an earlier version was reviewed, and kept on a reviewed document while it is in use,
// so the way back is there. A document never reviewed has nothing to compare with.
function baselineSwitch(
  page: string,
  view: DiffView,
  baseline: Baseline,
  reviewed: BannerReview | undefined,
): Element | undefined {
  if (
    reviewed === undefined ||
    !(
      reviewed.mark.status === "changed" ||
      (reviewed.mark.status === "reviewed" && baseline === "review")
    )
  ) {
    return undefined;
  }
  return h(
    "nav.changes-since.segmented.is-compact.is-even",
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
  );
}

/**
 * The commits that last touched a document, asked of git only when the reader opens it: the page
 * itself never waits for a walk through history. Hidden until the script that loads it has run.
 * Placed below a changed document's banner, or alone above an unchanged one's text.
 */
export function historyDetails(relPath: string): Element {
  return h("details.changes-history", { hidden: true, dataPath: relPath }, [
    h("summary", "History"),
    h("ol.changes-history-list"),
  ]);
}

export function documentViewHref(
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

export function changesHref(worktree: boolean, baseline: Baseline): string {
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
