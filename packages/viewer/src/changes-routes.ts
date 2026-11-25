import type { IncomingMessage, ServerResponse } from "node:http";

import { renderChangesArticle } from "./changes-article.js";
import {
  changesPayload,
  diffPayload,
  type DocumentReview,
  type Review,
} from "./changes.js";
import { sendHtml, sendJson } from "./http-send.js";
import {
  asMarked,
  compareOf,
  contextOf,
  marksOf,
  sinceOf,
} from "./review-queries.js";
import {
  baselineOf,
  markOf,
  markReview,
  type MarkRequest,
  parseMarkRequest,
  parseResetRequest,
  parseSectionRequest,
  type ResetRequest,
  sectionHashes,
  sectionMarksOf,
} from "./review-state.js";
import {
  contentHash,
  type MarkChange,
  type WriteOutcome,
} from "./review-store.js";
import { NO_CHANGES, type ViewerContext } from "./viewer-context.js";

// The Changes page, its JSON, one document's diff, and the review marks the reader sets on them.

const REVIEW_OFF =
  "Review marks are off: they need a git work tree, and a viewer bound to a loopback address, since a mark records this user's review on this machine.";

export class ChangesRoutes {
  constructor(private readonly ctx: ViewerContext) {}

  async sendChangesPage(
    request: IncomingMessage,
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const { ctx } = this;
    if (ctx.changes === undefined) {
      await ctx.sendNotFound(request, response, NO_CHANGES);
      return;
    }
    const mode = compareOf(params);
    const review = await ctx.changes.review(mode);
    const marks = await marksOf(ctx, review);
    const baseline = baselineOf(params);
    sendHtml(
      response,
      200,
      await ctx.page({
        title: "Changes",
        section: "changes",
        firstScreen: true,
        article: renderChangesArticle(
          review,
          mode,
          await contextOf(ctx, review),
          marks === undefined || "available" in review
            ? undefined
            : {
                marks,
                baseline,
                since:
                  baseline === "review"
                    ? await sinceOf(ctx, review, marks)
                    : new Map(),
              },
        ),
        // The "Viewed" checkboxes send their mark with it.
        changeToken: marks === undefined ? undefined : ctx.changeToken,
      }),
      request.method === "HEAD",
    );
  }

  async sendChangesData(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const { ctx } = this;
    if (ctx.changes === undefined) {
      sendJson(response, { error: NO_CHANGES }, 404);
      return;
    }
    const mode = compareOf(params);
    const review = await ctx.changes.review(mode);
    sendJson(
      response,
      changesPayload(
        review,
        mode,
        await contextOf(ctx, review),
        await marksOf(ctx, review),
      ),
    );
  }

  async sendChangeDiff(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const { changes } = this.ctx;
    if (changes === undefined) {
      sendJson(response, { error: NO_CHANGES }, 404);
      return;
    }
    const mode = compareOf(params);
    const review = await changes.review(mode);
    if ("available" in review) {
      sendJson(response, changesPayload(review, mode), 409);
      return;
    }
    // Only ever compared against the review's own paths, like the graph's parameters.
    const relPath = params.get("path") ?? "";
    if (baselineOf(params) === "review") {
      await this.sendDiffSinceReview(response, review, relPath);
      return;
    }
    const answer = diffPayload(review, relPath);
    if (answer === undefined) {
      sendJson(
        response,
        { error: "This path is not among the changed documents." },
        404,
      );
      return;
    }
    sendJson(response, answer);
  }

  // A document's diff from the version the reader last reviewed, rather than from the base branch.
  private async sendDiffSinceReview(
    response: ServerResponse,
    review: Review,
    relPath: string,
  ): Promise<void> {
    const entry = review.documents.find(
      (document) => document.path === relPath,
    );
    const marks = await marksOf(this.ctx, review);
    const since =
      entry === undefined
        ? undefined
        : (await sinceOf(this.ctx, review, marks)).get(relPath);
    if (since === undefined) {
      sendJson(
        response,
        {
          error:
            "This path has no reviewed version to compare with: it is not among the changed documents, was never reviewed, is reviewed as it is, or its reviewed text is no longer kept.",
        },
        404,
      );
      return;
    }
    sendJson(response, diffPayload({ ...review, documents: [since] }, relPath));
  }

  // Records that the reader reviewed a document, or takes that back, or forgets the marks of every
  // document a page listed. The text marked is always the one this server's review holds for the
  // page's comparison, never one the request supplies, and only when its hash is the one the page
  // showed: a reader can mark exactly the version they saw, as a config save applies only to the
  // version the page edited.
  async changeMarks(
    response: ServerResponse,
    target: string,
    body: unknown,
  ): Promise<void> {
    const { reviewStore, changes } = this.ctx;
    if (reviewStore === undefined || changes === undefined) {
      sendJson(response, { status: "refused", error: REVIEW_OFF }, 403);
      return;
    }
    const parsed =
      target === "/api/review/mark"
        ? parseMarkRequest(body)
        : parseResetRequest(body);
    if (!parsed.ok) {
      sendJson(response, { status: "refused", error: parsed.message }, 400);
      return;
    }
    const shown = await changes.review(parsed.request.compare);
    if ("available" in shown) {
      sendJson(response, { status: "refused", error: shown.message }, 409);
      return;
    }
    // Named as the marks know them, so a reset or an unmark also reaches the marks a document kept
    // under the name it had before the branch renamed it.
    const review = await asMarked(this.ctx, shown);
    const matched = listedEntries(review, parsed.request);
    if (!matched.ok) {
      sendJson(response, { status: "conflict", error: matched.message }, 409);
      return;
    }
    const { entries } = matched;
    const outcome = await reviewStore.update(
      markChangeOf(parsed.request, entries),
    );
    if (!outcome.ok) {
      sendUpdateFailure(response, outcome);
      return;
    }
    // Every open page counts what is left, so each is told; nothing on disk the watcher sees changed.
    this.ctx.events.broadcast("review", {});
    const marks = markReview(review, { ok: true, marks: outcome.marks });
    sendJson(response, {
      status: "saved",
      documents: entries.map((entry) => {
        const mark = markOf(entry, outcome.marks);
        return {
          path: entry.path,
          review: { status: mark.status, hash: mark.hash },
          // Marking a document marks its sections too, so the outline follows the answer.
          sections: [...sectionMarksOf(entry, outcome.marks).values()].map(
            (section) => ({ key: section.key, status: section.status }),
          ),
        };
      }),
      left: marks.ok ? marks.left : review.documents.length,
      total: review.documents.length,
    });
  }

  // One section of a changed document marked reviewed or not, from its page's outline. Always the
  // work tree's review, the one a document's page shows; the section's text is the review's own, and
  // only the version the page showed may be marked, as for a whole document.
  async changeSectionMark(
    response: ServerResponse,
    body: unknown,
  ): Promise<void> {
    const { reviewStore, changes } = this.ctx;
    if (reviewStore === undefined || changes === undefined) {
      sendJson(response, { status: "refused", error: REVIEW_OFF }, 403);
      return;
    }
    const parsed = parseSectionRequest(body);
    if (!parsed.ok) {
      sendJson(response, { status: "refused", error: parsed.message }, 400);
      return;
    }
    const review = await changes.review("branch");
    if ("available" in review) {
      sendJson(response, { status: "refused", error: review.message }, 409);
      return;
    }
    const { request: asked } = parsed;
    // Only ever compared against the review's own paths and the document's own section keys.
    const entry = review.documents.find(
      (document) => document.path === asked.path,
    );
    const section =
      entry === undefined
        ? undefined
        : sectionHashes(entry).find(
            (candidate) => candidate.key === asked.section,
          );
    if (entry === undefined || section?.hash !== asked.hash) {
      sendJson(
        response,
        {
          status: "conflict",
          error:
            "The section changed since this page showed it, or is no longer there. Reload the page to review it as it is now.",
        },
        409,
      );
      return;
    }
    const outcome = await reviewStore.update({
      kind: "section",
      path: entry.path,
      ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
      key: section.key,
      hash: section.hash,
      reviewed: asked.reviewed,
    });
    if (!outcome.ok) {
      sendUpdateFailure(response, outcome);
      return;
    }
    this.ctx.events.broadcast("review", {});
    const marks = markReview(review, { ok: true, marks: outcome.marks });
    const mark = markOf(entry, outcome.marks);
    sendJson(response, {
      status: "saved",
      section: {
        key: section.key,
        status: sectionMarksOf(entry, outcome.marks).get(section.key)?.status,
      },
      documents: [
        { path: entry.path, review: { status: mark.status, hash: mark.hash } },
      ],
      left: marks.ok ? marks.left : review.documents.length,
      total: review.documents.length,
    });
  }
}

// The review's entries for the documents a mark or reset request lists, each still at the version
// the page showed. The first one that is not answers for the whole request, so nothing is marked
// from a page that no longer shows what is on disk.
function listedEntries(
  review: Review,
  request: MarkRequest | ResetRequest,
): { ok: true; entries: DocumentReview[] } | { ok: false; message: string } {
  const listed =
    "documents" in request
      ? request.documents
      : [{ path: request.path, hash: request.hash }];
  const entries: DocumentReview[] = [];
  for (const { path: relPath, hash } of listed) {
    // Only ever compared against the review's own paths.
    const entry = review.documents.find(
      (document) => document.path === relPath,
    );
    if (entry === undefined) {
      return {
        ok: false,
        message:
          "This document is no longer among the changes. Reload the page to see what changed now.",
      };
    }
    if (contentHash(entry.headText) !== hash) {
      return {
        ok: false,
        message:
          "The document changed since this page showed it. Reload the page to review the version there now.",
      };
    }
    entries.push(entry);
  }
  return { ok: true, entries };
}

// What the store records for a request whose entries all matched: a reset forgets every listed
// document's mark, a mark or an unmark changes the one document's.
function markChangeOf(
  request: MarkRequest | ResetRequest,
  entries: DocumentReview[],
): MarkChange {
  if ("documents" in request) {
    return {
      kind: "reset",
      documents: entries.map((entry) => ({
        path: entry.path,
        ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
        hash: contentHash(entry.headText),
      })),
    };
  }
  const entry = entries[0]!;
  if (request.reviewed) {
    return {
      kind: "mark",
      path: entry.path,
      hash: request.hash,
      text: entry.headText,
      sections: sectionHashes(entry),
    };
  }
  return {
    kind: "unmark",
    path: entry.path,
    ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
    hash: request.hash,
    sections: sectionHashes(entry),
  };
}

type UpdateFailure = Extract<WriteOutcome, { ok: false }>;

const FAILURE_STATUS: Record<UpdateFailure["status"], number> = {
  failed: 500,
  busy: 503,
  refused: 409,
};

// A mark the store could not write: a write that failed, another viewer holding the lock, or marks
// it refused to change because it cannot read the ones already there - each its own status, so the
// page can say which.
function sendUpdateFailure(
  response: ServerResponse,
  outcome: UpdateFailure,
): void {
  sendJson(
    response,
    { status: outcome.status, error: outcome.message },
    FAILURE_STATUS[outcome.status],
  );
}
