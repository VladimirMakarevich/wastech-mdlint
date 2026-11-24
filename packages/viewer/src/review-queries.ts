import type {
  DocumentReview,
  Review,
  ReviewContext,
  ReviewResult,
} from "./changes.js";
import { markReview, type ReviewMarksView } from "./review-state.js";
import type { ViewerContext } from "./viewer-context.js";

// The questions several pages ask of the branch review — its context, the reader's marks, the
// review since the last one — answered in one place, so the Changes page, its JSON, the graph and
// the dashboard all read the same answer.

// `worktree=0` limits a review to committed changes; anything else, or nothing, includes the work
// tree, which is what a reader in the middle of an edit wants to see.
export function worktreeOf(params: URLSearchParams): boolean {
  return params.get("worktree") !== "0";
}

/**
 * The context of a review, or `undefined` when there is none to show. A failure to compute it is
 * reported here and leaves the page with its diffs, which do not depend on it.
 */
export async function contextOf(
  ctx: ViewerContext,
  review: ReviewResult,
): Promise<ReviewContext | undefined> {
  if (ctx.changes === undefined || "available" in review) {
    return undefined;
  }
  try {
    return await ctx.changes.context(review);
  } catch (error) {
    process.stderr.write(
      `wastech-mdlint-viewer: could not compare the context: ${(error as Error).message}\n`,
    );
    return undefined;
  }
}

/**
 * What the branch did, for the pages that show it beside everything else — the dashboard and the
 * graph. The work-tree review, as both show the files on disk; `undefined` outside a git work tree
 * or while there is nothing to compare.
 */
export async function workTreeChanges(
  ctx: ViewerContext,
): Promise<{ review: Review; context: ReviewContext } | undefined> {
  if (ctx.changes === undefined) {
    return undefined;
  }
  const review = await ctx.changes.review(true);
  if ("available" in review) {
    return undefined;
  }
  const context = await contextOf(ctx, review);
  return context === undefined ? undefined : { review, context };
}

/** The marks of a review's documents, or `undefined` where review marks are off. */
export async function marksOf(
  ctx: ViewerContext,
  review: ReviewResult,
): Promise<ReviewMarksView | undefined> {
  if (ctx.reviewStore === undefined || "available" in review) {
    return undefined;
  }
  return markReview(review, await ctx.reviewStore.read());
}

/**
 * Each changed document's review since the reader's last review of it, for a page that compares
 * with that: only documents changed since they were reviewed, and only those whose reviewed text
 * is still kept.
 */
export async function sinceOf(
  ctx: ViewerContext,
  review: Review,
  marks: ReviewMarksView | undefined,
): Promise<Map<string, DocumentReview>> {
  const since = new Map<string, DocumentReview>();
  if (ctx.sinceReviews === undefined || marks?.ok !== true) {
    return since;
  }
  for (const entry of review.documents) {
    const version = marks.documents.get(entry.path)?.since;
    const rebased =
      version === undefined
        ? undefined
        : await ctx.sinceReviews.of(entry, version);
    if (rebased !== undefined) {
      since.set(entry.path, rebased);
    }
  }
  return since;
}
