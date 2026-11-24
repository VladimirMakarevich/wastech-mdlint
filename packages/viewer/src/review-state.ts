import type { Element } from "hast";
import { h } from "hastscript";

import {
  diffText,
  documentSections,
  parseDocument,
  tableRowLines,
} from "@wastech-mdlint/core";

import type { DocumentReview, Review } from "./changes.js";
import {
  contentHash,
  type ReviewMarks,
  type ReviewStatus,
  type SectionHash,
  type ReviewStore,
  type StoreRead,
} from "./review-store.js";

// What the reader's marks say about one review: each changed document's status, and the version to
// compare with "since my last review". The store keeps marks; this joins them to the documents a
// review lists and lays the result out, so the Changes page, a document's page and the JSON agree.

/** A changed document against the marks: where it stands and the text it would be marked as. */
export type DocumentMark = {
  status: ReviewStatus;
  // The hash of the text the page shows, which a request to mark it must name.
  hash: string;
  // The newest version reviewed under its path, when it has changed since.
  since?: string;
};

/**
 * The marks of a review's documents, or why there are none: the marks file could not be read. Keyed
 * by path. Statuses are computed here on every read and stored nowhere, so a mark follows content
 * whatever branch or rebase brought the content there.
 */
export type ReviewMarksView =
  | { ok: true; documents: ReadonlyMap<string, DocumentMark>; left: number }
  | { ok: false; message: string };

export function markReview(review: Review, read: StoreRead): ReviewMarksView {
  if (!read.ok) {
    return read;
  }
  const documents = new Map<string, DocumentMark>();
  for (const entry of review.documents) {
    documents.set(entry.path, markOf(entry, read.marks));
  }
  return { ok: true, documents, left: leftOf(documents) };
}

export function markOf(
  entry: DocumentReview,
  marks: ReviewMarks,
): DocumentMark {
  const hash = contentHash(entry.headText);
  return {
    hash,
    ...marks.status({
      path: entry.path,
      ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
      hash,
      sections: sectionHashes(entry),
    }),
  };
}

/**
 * The sections of a changed document as the page shows it, each with the hash of its own text: what
 * marking the document records for them, and what a section's mark must name. None for a deleted
 * document, which has no text to cut.
 */
export function sectionHashes(entry: DocumentReview): SectionHash[] {
  return entry.headDocument === undefined
    ? []
    : documentSections(entry.headDocument).map((section) => ({
        key: section.key,
        hash: contentHash(section.text),
      }));
}

/** A section's place in the reader's review, keyed by its heading's slug for the outline. */
export type SectionMark = SectionHash & { status: ReviewStatus };

export function sectionMarksOf(
  entry: DocumentReview,
  marks: ReviewMarks,
): Map<string, SectionMark> {
  return new Map(
    sectionHashes(entry).map((section) => [
      section.key,
      {
        ...section,
        status: marks.sectionStatus({
          path: entry.path,
          ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
          ...section,
        }),
      },
    ]),
  );
}

function leftOf(documents: ReadonlyMap<string, DocumentMark>): number {
  return [...documents.values()].filter((mark) => mark.status !== "reviewed")
    .length;
}

/** A request to mark one document reviewed or not, as the "Viewed" checkbox sends it. */
export type MarkRequest = {
  path: string;
  hash: string;
  reviewed: boolean;
  // Which review the page showed: the work tree's, or the last commit's.
  worktree: boolean;
};

/** A request to mark one section of a changed document reviewed or not, from the outline. */
export type SectionRequest = {
  path: string;
  section: string;
  hash: string;
  reviewed: boolean;
};

/** A request to forget the marks of the documents a page listed. */
export type ResetRequest = {
  worktree: boolean;
  documents: { path: string; hash: string }[];
};

type Parsed<T> = { ok: true; request: T } | { ok: false; message: string };

const HASH = /^[0-9a-f]{64}$/;

/** Check a mark request's shape; whether it names the version on disk is the server's to judge. */
export function parseMarkRequest(body: unknown): Parsed<MarkRequest> {
  const fields = objectOf(body, ["path", "hash", "reviewed", "worktree"]);
  if (!fields.ok) {
    return fields;
  }
  const { path, hash, reviewed, worktree } = fields.value;
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, message: '"path" must name a changed document.' };
  }
  if (typeof hash !== "string" || !HASH.test(hash)) {
    return {
      ok: false,
      message: '"hash" must name the version of the document the page showed.',
    };
  }
  if (typeof reviewed !== "boolean" || typeof worktree !== "boolean") {
    return {
      ok: false,
      message: '"reviewed" and "worktree" must be true or false.',
    };
  }
  return { ok: true, request: { path, hash, reviewed, worktree } };
}

export function parseSectionRequest(body: unknown): Parsed<SectionRequest> {
  const fields = objectOf(body, ["path", "section", "hash", "reviewed"]);
  if (!fields.ok) {
    return fields;
  }
  const { path, section, hash, reviewed } = fields.value;
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, message: '"path" must name a changed document.' };
  }
  if (typeof section !== "string") {
    return {
      ok: false,
      message: '"section" must be the slug of a section\'s heading.',
    };
  }
  if (typeof hash !== "string" || !HASH.test(hash)) {
    return {
      ok: false,
      message: '"hash" must name the version of the section the page showed.',
    };
  }
  if (typeof reviewed !== "boolean") {
    return { ok: false, message: '"reviewed" must be true or false.' };
  }
  return { ok: true, request: { path, section, hash, reviewed } };
}

export function parseResetRequest(body: unknown): Parsed<ResetRequest> {
  const fields = objectOf(body, ["worktree", "documents"]);
  if (!fields.ok) {
    return fields;
  }
  const { worktree, documents } = fields.value;
  if (typeof worktree !== "boolean") {
    return { ok: false, message: '"worktree" must be true or false.' };
  }
  const listed: { path: string; hash: string }[] = [];
  if (!Array.isArray(documents)) {
    return {
      ok: false,
      message: '"documents" must list the documents the page showed.',
    };
  }
  for (const entry of documents) {
    const document = objectOf(entry, ["path", "hash"]);
    if (
      !document.ok ||
      typeof document.value.path !== "string" ||
      typeof document.value.hash !== "string" ||
      !HASH.test(document.value.hash)
    ) {
      return {
        ok: false,
        message:
          'Each of "documents" must be a path and the hash of the version the page showed.',
      };
    }
    listed.push({ path: document.value.path, hash: document.value.hash });
  }
  return { ok: true, request: { worktree, documents: listed } };
}

function objectOf(
  body: unknown,
  keys: readonly string[],
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "The request body must be a JSON object." };
  }
  const unknownKey = Object.keys(body).find((key) => !keys.includes(key));
  if (unknownKey !== undefined) {
    return { ok: false, message: `Unknown field "${unknownKey}".` };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

/**
 * A document's review restated against the version the reader last reviewed rather than the base:
 * the same shape, so the Changes page, the Source view and the marks on a rendered page all show it
 * through the code that shows the branch's changes. Kept per review and version, so a rendered page
 * marked from it is cached for as long as the review is.
 */
export class SinceReview {
  private readonly cache = new WeakMap<
    DocumentReview,
    Map<string, Promise<DocumentReview | undefined>>
  >();

  constructor(private readonly store: ReviewStore) {}

  /** `undefined` when the reviewed text is no longer kept. */
  of(
    entry: DocumentReview,
    since: string,
  ): Promise<DocumentReview | undefined> {
    let versions = this.cache.get(entry);
    if (versions === undefined) {
      versions = new Map();
      this.cache.set(entry, versions);
    }
    let pending = versions.get(since);
    if (pending === undefined) {
      pending = this.store
        .snapshot(since)
        .then((text) =>
          text === undefined ? undefined : againstText(entry, text),
        );
      versions.set(since, pending);
    }
    return pending;
  }
}

function againstText(entry: DocumentReview, text: string): DocumentReview {
  const baseDocument = parseDocument({ path: entry.path, content: text });
  const rebased: DocumentReview = {
    ...entry,
    // Compared with a version of this very path: a rename is behind it, and a deleted document
    // stays deleted.
    status: entry.status === "D" ? "D" : "M",
    baseText: text,
    baseDocument,
    diff: diffText(text, entry.headText, {
      baseTableRows: tableRowLines(baseDocument),
      ...(entry.headDocument === undefined
        ? {}
        : { headTableRows: tableRowLines(entry.headDocument) }),
    }),
  };
  delete rebased.oldPath;
  return rebased;
}

/** What a page compares a changed document with, kept in the address as `?since=review`. */
export type Baseline = "base" | "review";

export function baselineOf(params: URLSearchParams): Baseline {
  return params.get("since") === "review" ? "review" : "base";
}

const STATUS_TEXT: Record<Exclude<ReviewStatus, "unreviewed">, string> = {
  reviewed: "Reviewed",
  changed: "Changed since review",
};

/** The status beside a changed document; nothing for one never reviewed, which is most of them. */
export function reviewChip(
  mark: DocumentMark | undefined,
): Element | undefined {
  if (mark === undefined || mark.status === "unreviewed") {
    return undefined;
  }
  return h(
    `span.review-chip.review-chip-${mark.status}`,
    STATUS_TEXT[mark.status],
  );
}

/**
 * The "Viewed" checkbox, hidden until the page script that sends the mark has run: without script
 * it could only lie about being checkable. It carries what the request names — the path, the
 * hash of the text the page shows, and which comparison the page made — so the server marks exactly
 * the version the reader saw.
 */
export function reviewToggle(
  entry: DocumentReview,
  mark: DocumentMark,
  worktree: boolean,
): Element {
  return h(
    "label.review-toggle",
    {
      hidden: true,
      dataPath: entry.path,
      dataOldPath: entry.oldPath,
      dataHash: mark.hash,
      dataWorktree: worktree ? "1" : "0",
      title: "Mark as viewed (v)",
    },
    [
      h("input", {
        type: "checkbox",
        checked: mark.status === "reviewed",
      }),
      h("span", "Viewed"),
    ],
  );
}

/** The reason review marks are not shown, where they would be. */
export function reviewProblem(message: string): Element {
  return h("p.review-problem", message);
}
