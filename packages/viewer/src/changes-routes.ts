import type { IncomingMessage, ServerResponse } from "node:http";

import {
  changesPayload,
  diffPayload,
  type DocumentReview,
  renderChangesArticle,
} from "./changes.js";
import { sendHtml, sendJson } from "./http-send.js";
import { contextOf, marksOf, sinceOf, worktreeOf } from "./review-queries.js";
import {
  baselineOf,
  markOf,
  markReview,
  parseMarkRequest,
  parseResetRequest,
  parseSectionRequest,
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

export function changesRoutes(ctx: ViewerContext) {
  const { changes, reviewStore } = ctx;

  async function sendChangesPage(
    request: IncomingMessage,
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    if (changes === undefined) {
      ctx.sendNotFound(request, response, NO_CHANGES);
      return;
    }
    const worktree = worktreeOf(params);
    const review = await changes.review(worktree);
    const marks = await marksOf(ctx, review);
    const baseline = baselineOf(params);
    sendHtml(
      response,
      200,
      ctx.page({
        title: "Changes",
        section: "changes",
        article: renderChangesArticle(
          review,
          worktree,
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

  async function sendChangesData(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    if (changes === undefined) {
      sendJson(response, { error: NO_CHANGES }, 404);
      return;
    }
    const review = await changes.review(worktreeOf(params));
    sendJson(
      response,
      changesPayload(
        review,
        await contextOf(ctx, review),
        await marksOf(ctx, review),
      ),
    );
  }

  async function sendChangeDiff(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    if (changes === undefined) {
      sendJson(response, { error: NO_CHANGES }, 404);
      return;
    }
    const review = await changes.review(worktreeOf(params));
    if ("available" in review) {
      sendJson(response, changesPayload(review), 409);
      return;
    }
    // Only ever compared against the review's own paths, like the graph's parameters.
    const relPath = params.get("path") ?? "";
    if (baselineOf(params) === "review") {
      const entry = review.documents.find(
        (document) => document.path === relPath,
      );
      const marks = await marksOf(ctx, review);
      const since =
        entry === undefined
          ? undefined
          : (await sinceOf(ctx, review, marks)).get(relPath);
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
      sendJson(
        response,
        diffPayload({ ...review, documents: [since] }, relPath),
      );
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

  // Records that the reader reviewed a document, or takes that back, or forgets the marks of every
  // document a page listed. The text marked is always the one this server's review holds for the
  // page's comparison, never one the request supplies, and only when its hash is the one the page
  // showed: a reader can mark exactly the version they saw, as a config save applies only to the
  // version the page edited.
  async function changeMarks(
    response: ServerResponse,
    target: string,
    body: unknown,
  ): Promise<void> {
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
    const review = await changes.review(parsed.request.worktree);
    if ("available" in review) {
      sendJson(response, { status: "refused", error: review.message }, 409);
      return;
    }
    const listed =
      "documents" in parsed.request
        ? parsed.request.documents
        : [{ path: parsed.request.path, hash: parsed.request.hash }];
    const entries: DocumentReview[] = [];
    for (const { path: relPath, hash } of listed) {
      // Only ever compared against the review's own paths.
      const entry = review.documents.find(
        (document) => document.path === relPath,
      );
      if (entry === undefined || contentHash(entry.headText) !== hash) {
        sendJson(
          response,
          {
            status: "conflict",
            error:
              entry === undefined
                ? "This document is no longer among the changes. Reload the page to see what changed now."
                : "The document changed since this page showed it. Reload the page to review the version there now.",
          },
          409,
        );
        return;
      }
      entries.push(entry);
    }
    let change: MarkChange;
    if ("documents" in parsed.request) {
      change = {
        kind: "reset",
        documents: entries.map((entry) => ({
          path: entry.path,
          ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
          hash: contentHash(entry.headText),
        })),
      };
    } else {
      const entry = entries[0]!;
      change = parsed.request.reviewed
        ? {
            kind: "mark",
            path: entry.path,
            hash: parsed.request.hash,
            text: entry.headText,
            sections: sectionHashes(entry),
          }
        : {
            kind: "unmark",
            path: entry.path,
            ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
            hash: parsed.request.hash,
            sections: sectionHashes(entry),
          };
    }
    const outcome = await reviewStore.update(change);
    if (!outcome.ok) {
      sendUpdateFailure(response, outcome);
      return;
    }
    // Every open page counts what is left, so each is told; nothing on disk the watcher sees changed.
    ctx.events.broadcast("review", {});
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
  async function changeSectionMark(
    response: ServerResponse,
    body: unknown,
  ): Promise<void> {
    if (reviewStore === undefined || changes === undefined) {
      sendJson(response, { status: "refused", error: REVIEW_OFF }, 403);
      return;
    }
    const parsed = parseSectionRequest(body);
    if (!parsed.ok) {
      sendJson(response, { status: "refused", error: parsed.message }, 400);
      return;
    }
    const review = await changes.review(true);
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
    ctx.events.broadcast("review", {});
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

  return {
    sendChangesPage,
    sendChangesData,
    sendChangeDiff,
    changeMarks,
    changeSectionMark,
  };
}

// A mark the store could not write: a write that failed, another viewer holding the lock, or marks
// it refused to change because it cannot read the ones already there — each its own status, so the
// page can say which.
function sendUpdateFailure(
  response: ServerResponse,
  outcome: Extract<WriteOutcome, { ok: false }>,
): void {
  sendJson(
    response,
    { status: outcome.status, error: outcome.message },
    outcome.status === "failed" ? 500 : outcome.status === "busy" ? 503 : 409,
  );
}
