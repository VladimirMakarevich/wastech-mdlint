import type { Element } from "hast";
import { h } from "hastscript";

import type { Review } from "./changes.js";
import type { Diagnostics, FileCounts } from "./diagnostics.js";
import { markReview } from "./review-state.js";
import type { ReviewStore } from "./review-store.js";

// The marks every page carries beside the documents in its tree and on the header's Changes section:
// how many findings a file has, the letter of what the branch did to it, a dot while it is left to
// review, and how much of the branch is left. They are drawn into the page from what the server
// already holds, so a page is whole from its first frame: fetched by the page script instead, they
// appeared a fifth of a second after every page was drawn, and since the page before had shown
// them, every navigation took them away and gave them back.
//
// The page script draws the same marks again when an event says they changed, from the same data in
// JSON. Its builders in `client/tree-marks.ts` produce exactly this markup, which a test holds equal,
// so a mark the script redraws looks like the one the server drew.

export type ReviewStatus = "unreviewed" | "reviewed" | "changed";

export type ChangeLetter = "A" | "M" | "D" | "R";

/** A document the branch changed, as the tree marks it. */
export type ChangedFile = {
  status: ChangeLetter;
  oldPath?: string;
  // Where the reader's review of it stands, or `null` where review marks are off.
  review: ReviewStatus | null;
};

export type ChangeMarks = {
  files: ReadonlyMap<string, ChangedFile>;
  // The header's count: every changed document, and what is left to review where marks can be read.
  changed: number;
  review: { left: number; total: number } | null;
};

export type TreeMarks = {
  // Per file with any findings; `undefined` until the first lint has finished.
  findings: Readonly<Record<string, FileCounts>> | undefined;
  // `undefined` while no review of the work tree is at hand, and outside a git work tree.
  changes: ChangeMarks | undefined;
  // The marks the page script can take as current, needing nothing more than the events that follow.
  // Changes are current only where the repository is watched: without a watcher no event tells a
  // page that a commit moved the review, so the script asks once, as the page opens.
  current: readonly ("findings" | "changes")[];
};

const STATUS_NAMES: Record<ChangeLetter, string> = {
  A: "Added in this branch",
  M: "Modified in this branch",
  D: "Deleted in this branch",
  R: "Renamed in this branch",
};

const REVIEW_NAMES: Record<Exclude<ReviewStatus, "reviewed">, string> = {
  unreviewed: "Not reviewed yet",
  changed: "Changed since your review",
};

/**
 * The marks as the server holds them now, without asking git: the review is the one kept from the
 * last request that needed it. A document's page has waited for a current one before it gets here;
 * any other page takes what is kept rather than wait for git, and when nothing is kept, its script
 * asks for the changes as the page opens.
 */
export async function treeMarksOf(state: {
  diagnostics: Diagnostics;
  review: Review | undefined;
  reviewStore: ReviewStore | undefined;
  watch: boolean;
}): Promise<TreeMarks> {
  const findings = state.diagnostics.ready
    ? state.diagnostics.summary()
    : undefined;
  const changes =
    state.review === undefined
      ? undefined
      : await changeMarksOf(state.review, state.reviewStore);
  const current: ("findings" | "changes")[] = [];
  if (findings !== undefined) {
    current.push("findings");
  }
  if (changes !== undefined && state.watch) {
    current.push("changes");
  }
  return { findings, changes, current };
}

async function changeMarksOf(
  review: Review,
  reviewStore: ReviewStore | undefined,
): Promise<ChangeMarks> {
  const marks =
    reviewStore === undefined
      ? undefined
      : markReview(review, await reviewStore.read());
  const files = new Map<string, ChangedFile>();
  for (const entry of review.documents) {
    const mark =
      marks?.ok === true ? marks.documents.get(entry.path) : undefined;
    files.set(entry.path, {
      status: entry.status,
      ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
      review: mark?.status ?? null,
    });
  }
  return {
    files,
    changed: review.documents.length,
    review:
      marks?.ok === true
        ? { left: marks.left, total: review.documents.length }
        : null,
  };
}

/** A file's count of findings, red when any is an error. */
export function findingsBadge(counts: FileCounts): Element {
  return h(
    `span.tree-badge${counts.errors > 0 ? ".tree-badge-error" : ""}`,
    {
      title: [
        counts.errors > 0 ? plural(counts.errors, "error") : "",
        counts.warnings > 0 ? plural(counts.warnings, "warning") : "",
      ]
        .filter((part) => part !== "")
        .join(", "),
    },
    String(counts.errors + counts.warnings),
  );
}

/** The letter of what the branch did to a file, naming where a renamed one came from. */
export function changeLetter(file: ChangedFile): Element {
  return h(
    `span.tree-change.tree-change-${file.status}`,
    {
      title:
        file.oldPath === undefined
          ? STATUS_NAMES[file.status]
          : `${STATUS_NAMES[file.status]}, from ${file.oldPath}`,
    },
    file.status,
  );
}

/** The dot beside a changed file left to review: never reviewed, or changed since. */
export function reviewDot(status: ReviewStatus | null): Element | undefined {
  if (status === null || status === "reviewed") {
    return undefined;
  }
  return h(`span.tree-review-dot.tree-review-${status}`, {
    role: "img",
    ariaLabel: REVIEW_NAMES[status],
    title: REVIEW_NAMES[status],
  });
}

/**
 * The count on the header's Changes section: what is left against everything that changed, the queue
 * a reviewer works down, or only how many changed where marks cannot be read. Nothing when nothing
 * changed.
 */
export function changesCount(marks: ChangeMarks): Element | undefined {
  if (marks.changed === 0) {
    return undefined;
  }
  const { review } = marks;
  if (review === null) {
    return h(
      "span.segment-count",
      { title: `${marks.changed} changed ${documents(marks.changed)}` },
      String(marks.changed),
    );
  }
  return h(
    `span.segment-count${review.left === 0 ? ".is-done" : ""}`,
    {
      title: `${review.left} of ${review.total} changed ${documents(review.total)} left to review`,
    },
    `${review.left}/${review.total}`,
  );
}

function documents(count: number): string {
  return count === 1 ? "document" : "documents";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
