import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { ElementContent } from "hast";
import { h } from "hastscript";

import {
  changedSections,
  documentSections,
  type GitRepository,
  headChanges,
  introductionChanged,
  type ParsedDocument,
} from "@wastech-mdlint/core";

import { blameAnnotator } from "./blame.js";
import {
  type BannerReview,
  type DiffView,
  historyDetails,
  renderChangeBanner,
} from "./change-banner.js";
import { renderDiff, renderHunkTemplate } from "./change-diff.js";
import type { DocumentReview } from "./changes.js";
import { documentNeighbors } from "./graph-view.js";
import { highlight, languageForPath, withCopyButton } from "./highlight.js";
import { sendHtml, sendJson } from "./http-send.js";
import { rawHtml } from "./page.js";
import { resolversFor } from "./render-cache.js";
import {
  documentHref,
  renderDocument,
  type LineAnnotator,
  type RenderedDocument,
} from "./render-document.js";
import { type Baseline, markOf, sectionMarksOf } from "./review-state.js";
import { pageHeaders, rawFileHeaders } from "./security.js";
import {
  NO_CHANGES,
  type PageBody,
  type ViewerContext,
} from "./viewer-context.js";

// A document's page in every view it has — rendered, its changes marked, its diff, blame — and the
// files it links to, which are served beside it.

// Enough of a document's history to see who has been changing it lately, without paging through it.
const HISTORY_COMMITS = 8;

// A source file larger than this is a generated or vendored file, not something a document links to
// for a reader; highlighting it would stall the page for nothing.
const MAX_SOURCE_BYTES = 1024 * 1024;

// Repository files served as-is. Everything else a document links to is shown as highlighted source,
// so no repository file is ever handed to the browser as HTML or script.
const IMAGE_TYPES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

type MarkedDocument = {
  rendered: RenderedDocument;
  changedSections: Set<string>;
  introductionChanged: boolean;
};

/** A document page as its address asks for it: the path and the views it is shown in. */
export type DocumentRequest = {
  relPath: string | undefined;
  view: DiffView;
  baseline: Baseline;
  blame: boolean;
};

// Everything a document page is built from, once the document is found and its review and blame are
// known.
type ShownDocument = DocumentRequest & {
  relPath: string;
  document: ParsedDocument;
  annotate: LineAnnotator | undefined;
  // The work tree's review of this document, when it has changes to show.
  branchReview: DocumentReview | undefined;
  reviewed: BannerReview | undefined;
};

export class DocumentRoutes {
  // A document rendered with its changes marked, kept for as long as the review it was marked from:
  // the tracker replaces every review after the watcher's next batch, which is also what brings a new
  // text or a change in which files the links reach, so an entry never outlives what it was made of.
  private readonly marked = new WeakMap<
    DocumentReview,
    { document: ParsedDocument; result: Promise<MarkedDocument> }
  >();

  constructor(private readonly ctx: ViewerContext) {}

  // With blame, nothing is kept: blame is asked for one page at a time, and the blame of a file moves
  // with every commit, which nothing here would notice.
  private renderMarked(
    document: ParsedDocument,
    review: DocumentReview,
    annotate?: LineAnnotator,
  ): Promise<MarkedDocument> {
    const entry = this.marked.get(review);
    if (annotate === undefined && entry?.document === document) {
      return entry.result;
    }
    const changes = headChanges(review.diff);
    const result = renderDocument(
      document,
      resolversFor(this.ctx.corpus, document),
      {
        changes,
        basePath: review.oldPath ?? review.path,
        baseText: review.baseText,
      },
      annotate,
    ).then((rendered) => ({
      rendered,
      changedSections: new Set(
        changedSections(document.headings, changes).map(
          (heading) => heading.slug,
        ),
      ),
      introductionChanged: introductionChanged(document, changes),
    }));
    if (annotate === undefined) {
      this.marked.set(review, { document, result });
      result.catch(() => this.marked.delete(review));
    }
    return result;
  }

  // The document rendered without its changes marked: from the shared cache, or afresh with blame,
  // which the cache does not keep.
  private renderPlain(
    document: ParsedDocument,
    annotate: LineAnnotator | undefined,
  ): Promise<RenderedDocument> {
    return annotate === undefined
      ? this.ctx.renders.render(document)
      : renderDocument(
          document,
          resolversFor(this.ctx.corpus, document),
          undefined,
          annotate,
        );
  }

  /**
   * The review of a document page's own changes, or `undefined` when it has none to show. Always the
   * work-tree review: the page renders the file on disk, and only that review's line numbers are its
   * lines. Its head text is compared with the text being rendered, so a page requested between a
   * save reaching the corpus and the review being rebuilt is never marked from the other text.
   */
  private async reviewOf(
    document: ParsedDocument,
  ): Promise<DocumentReview | undefined> {
    if (this.ctx.changes === undefined) {
      return undefined;
    }
    const review = await this.ctx.changes.review("branch");
    if ("available" in review) {
      return undefined;
    }
    return review.documents.find(
      (entry) =>
        entry.path === document.path && entry.headText === document.content,
    );
  }

  /**
   * What the line above a changed document says about the reader's review of it, and the review
   * since their last one when the page compares with that; `undefined` where marks are off or
   * cannot be read, which the Changes page explains.
   */
  private async bannerReviewOf(
    review: DocumentReview | undefined,
    baseline: Baseline,
  ): Promise<BannerReview | undefined> {
    const { reviewStore } = this.ctx;
    if (review === undefined || reviewStore === undefined) {
      return undefined;
    }
    const read = await reviewStore.read();
    if (!read.ok) {
      return undefined;
    }
    const mark = markOf(review, read.marks);
    const sections = sectionMarksOf(review, read.marks);
    // A document reviewed as it is compares with its own text, which is kept under its hash
    // whichever path it was marked under: the page then shows that nothing changed since.
    const version = mark.status === "reviewed" ? mark.hash : mark.since;
    const since =
      baseline === "review" && version !== undefined
        ? await this.ctx.sinceReviews?.of(review, version)
        : undefined;
    return {
      mark,
      baseline,
      sections,
      ...(since === undefined ? {} : { since }),
    };
  }

  // The margin notes of one document, or `undefined` when git cannot blame it or the file on disk is
  // no longer the text being rendered.
  private async blameOf(
    repository: GitRepository,
    relPath: string,
    content: string,
  ): Promise<LineAnnotator | undefined> {
    const onDisk = await readFile(
      path.join(this.ctx.corpus.rootDir, ...relPath.split("/")),
      "utf8",
    ).catch(() => undefined);
    if (onDisk !== content) {
      return undefined;
    }
    const lines = await repository.blame(relPath).catch(() => []);
    return lines.length === 0
      ? undefined
      : blameAnnotator(lines, this.ctx.showAbsolutePaths);
  }

  async sendDocument(
    request: IncomingMessage,
    response: ServerResponse,
    asked: DocumentRequest,
  ): Promise<void> {
    const { corpus, git } = this.ctx;
    const { relPath } = asked;
    const document =
      relPath === undefined ? undefined : corpus.documents.get(relPath);
    if (relPath === undefined || document === undefined) {
      await this.ctx.sendNotFound(
        request,
        response,
        "This path is not a document in the corpus. The viewer shows the Markdown files the wastech-mdlint config includes.",
      );
      return;
    }
    // Blame is asked for in the address and drawn on the server, like the other views of a page. The
    // file on disk is what git blames, so it is used only while it is the text the corpus holds; a
    // page asked for between a save and the corpus catching up shows no blame rather than the
    // wrong lines'.
    const annotate =
      asked.blame && git !== undefined
        ? await this.blameOf(git, relPath, document.content)
        : undefined;
    const branchReview = await this.reviewOf(document);
    const shown: ShownDocument = {
      ...asked,
      relPath,
      document,
      annotate,
      branchReview,
      reviewed: await this.bannerReviewOf(branchReview, asked.baseline),
    };
    const { params, introChanged } = await this.documentBody(shown);
    sendHtml(
      response,
      200,
      await this.ctx.page(this.withReviewParts(params, shown, introChanged)),
      request.method === "HEAD",
    );
  }

  // The page parts every view of a document shares: its path, its links and the blame switch.
  private commonParams(
    shown: ShownDocument,
  ): Omit<PageBody, "title" | "article"> {
    const { corpus, git } = this.ctx;
    const { relPath } = shown;
    return {
      displayPath: relPath,
      absolutePath: this.ctx.absolutePathOf(relPath),
      documentPath: relPath,
      backlinks: corpus.backlinks(relPath),
      neighborCount: documentNeighbors(corpus.graph, relPath).length,
      ...(git === undefined
        ? {}
        : {
            blameToggle: {
              on: shown.annotate !== undefined,
              href: documentPageHref(
                relPath,
                shown.view,
                shown.baseline,
                !shown.blame,
              ),
            },
          }),
    };
  }

  // The page in the view asked for: the source diff in place of the text, the text with its changes
  // marked, or the plain text.
  private async documentBody(
    shown: ShownDocument,
  ): Promise<{ params: PageBody; introChanged: boolean }> {
    const { document, view, annotate, branchReview, reviewed } = shown;
    // What the page marks: the branch's changes, or the changes since the reader's last review when
    // the page compares with that and the reviewed text is still kept.
    const review = reviewed?.since ?? branchReview;
    const shared = {
      ...this.commonParams(shown),
      localGraphChanges: review !== undefined && view !== "off",
      changeBanner:
        branchReview === undefined
          ? undefined
          : renderChangeBanner(branchReview, view, reviewed),
    };
    if (review !== undefined && view === "source") {
      // The diff takes the article's place. The outline is left out with the rendered text, since
      // none of its headings is on this page to jump to.
      const { title } = await this.renderPlain(document, annotate);
      return {
        introChanged: false,
        params: {
          ...shared,
          title,
          article: [
            h("div.change-source", renderDiff(review.diff, review.headText)),
          ],
        },
      };
    }
    if (
      review !== undefined &&
      view === "rendered" &&
      // On a document the branch added, every block would carry the same mark the line above it
      // already gives the whole page.
      review.status !== "A" &&
      review.diff.hunks.length > 0
    ) {
      const result = await this.renderMarked(document, review, annotate);
      const { rendered } = result;
      return {
        introChanged: result.introductionChanged,
        params: {
          ...shared,
          title: rendered.title,
          article: [...rawHtml(rendered.html), renderHunkTemplate(review.diff)],
          headings: document.headings,
          changedSections: result.changedSections,
          frontmatter: document.frontmatter,
          frontmatterChange: rendered.frontmatterChange,
        },
      };
    }
    const { html, title } = await this.renderPlain(document, annotate);
    return {
      introChanged: false,
      params: {
        ...shared,
        title,
        article: rawHtml(html),
        headings: document.headings,
        frontmatter: document.frontmatter,
      },
    };
  }

  // The parts of a document page that follow the reader's review: the outline's introduction entry,
  // the history line on an unchanged document, and the section marks with the token that sends them.
  private withReviewParts(
    params: PageBody,
    shown: ShownDocument,
    introChanged: boolean,
  ): PageBody {
    const { branchReview, reviewed } = shown;
    const sectionMarks =
      reviewed === undefined || branchReview === undefined
        ? undefined
        : { path: branchReview.path, marks: reviewed.sections };
    const introduction =
      params.headings === undefined
        ? undefined
        : introductionEntry(
            shown.document,
            introChanged,
            sectionMarks !== undefined,
          );
    return {
      ...params,
      ...(introduction === undefined ? {} : { introduction }),
      ...(this.ctx.git === undefined
        ? {}
        : {
            historyLine: h(
              "div.document-history",
              historyDetails(shown.relPath),
            ),
          }),
      // The "Viewed" checkbox above a changed document sends its mark with it, and so does each
      // section's in the outline.
      ...(sectionMarks === undefined
        ? {}
        : { changeToken: this.ctx.changeToken, sectionMarks }),
    };
  }

  // The commits that last touched a document, for the line above its text: newest first, a few at
  // most, the author's name only on a loopback binding, as a person's name is kept to this machine.
  async sendHistory(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const { corpus, git } = this.ctx;
    // Only ever compared against the corpus's own paths, like the graph's parameters.
    const relPath = params.get("path") ?? "";
    if (git === undefined || !corpus.documents.has(relPath)) {
      sendJson(
        response,
        {
          error:
            git === undefined
              ? NO_CHANGES
              : "This path is not a document in the corpus.",
        },
        404,
      );
      return;
    }
    const commits = await git
      .fileHistory(relPath, HISTORY_COMMITS)
      .catch(() => []);
    sendJson(response, {
      path: relPath,
      commits: commits.map((commit) => ({
        commit: commit.commit,
        short: commit.short,
        date: commit.date,
        subject: commit.subject,
        ...(this.ctx.showAbsolutePaths ? { author: commit.author } : {}),
      })),
    });
  }

  async sendLinkedFile(
    request: IncomingMessage,
    response: ServerResponse,
    relPath: string | undefined,
  ): Promise<void> {
    const { corpus } = this.ctx;
    const absolutePath =
      relPath !== undefined && corpus.isLinkedFile(relPath)
        ? await corpus.resolveFile(relPath)
        : undefined;
    if (relPath === undefined || absolutePath === undefined) {
      await this.ctx.sendNotFound(
        request,
        response,
        "The viewer serves only the repository files a document links to, and no document links here.",
      );
      return;
    }
    const extension = path.extname(relPath).slice(1).toLowerCase();
    const imageType = IMAGE_TYPES[extension];
    if (imageType !== undefined) {
      const bytes = await readFile(absolutePath);
      response.writeHead(200, {
        ...rawFileHeaders(),
        "Content-Type": imageType,
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
      return;
    }
    sendHtml(
      response,
      200,
      await this.ctx.page({
        title: relPath,
        article: await sourceArticle(relPath, absolutePath),
        displayPath: relPath,
        absolutePath: this.ctx.absolutePathOf(relPath),
      }),
      request.method === "HEAD",
    );
  }

  async redirectToIndex(response: ServerResponse): Promise<void> {
    const { corpus } = this.ctx;
    const index = ["README.md", "readme.md", "index.md"].find((name) =>
      corpus.documents.has(name),
    );
    const first = index ?? corpus.documents.keys().next().value;
    if (first === undefined) {
      sendHtml(
        response,
        200,
        await this.ctx.page({
          title: "No documents",
          article: [
            h("h1", "No documents"),
            h(
              "p",
              "The configured include patterns match no Markdown files in this directory.",
            ),
          ],
        }),
      );
      return;
    }
    response
      .writeHead(302, { ...pageHeaders(), Location: documentHref(first) })
      .end();
  }
}

// A linked file that is not an image, as highlighted source — or a line saying why it is not shown.
async function sourceArticle(
  relPath: string,
  absolutePath: string,
): Promise<ElementContent[]> {
  const { size } = await stat(absolutePath);
  if (size > MAX_SOURCE_BYTES) {
    return [h("h1", relPath), h("p", "This file is too large to display.")];
  }
  const bytes = await readFile(absolutePath);
  // A NUL byte in the first block is the same heuristic git uses to call a file binary.
  if (bytes.subarray(0, 8000).includes(0)) {
    return [
      h("h1", relPath),
      h("p", "This is a binary file and cannot be displayed."),
    ];
  }
  const code = await highlight(
    bytes.toString("utf8"),
    languageForPath(relPath),
    {
      lineAnchors: true,
    },
  );
  return [
    h("h1.source-title", relPath),
    h("div.source-view", [withCopyButton(code)]),
  ];
}

// A document page's address with its views as asked: the changes view, the comparison, and blame.
function documentPageHref(
  relPath: string,
  view: DiffView,
  baseline: Baseline,
  blame: boolean,
): string {
  const params = new URLSearchParams();
  if (view !== "rendered") {
    params.set("diff", view);
  }
  if (baseline === "review") {
    params.set("since", "review");
  }
  if (blame) {
    params.set("blame", "1");
  }
  const query = params.toString();
  return query === ""
    ? documentHref(relPath)
    : `${documentHref(relPath)}?${query}`;
}

/**
 * The outline entry for the text before a document's first section, or `undefined` for none. That
 * text is a unit of review like any section, so where the page marks sections it needs an entry to be
 * marked from, and where the branch changed it the entry is where the outline says so. Elsewhere the
 * outline stays a list of headings: an entry for every title and opening paragraph would add a line
 * to every page and tell the reader nothing. A document with no section has no outline to add it to.
 */
function introductionEntry(
  document: ParsedDocument,
  changed: boolean,
  marked: boolean,
): { changed: boolean } | undefined {
  const [introduction, ...sections] = documentSections(document);
  if (
    introduction === undefined ||
    sections.length === 0 ||
    introduction.text.trim() === "" ||
    (!changed && !marked)
  ) {
    return undefined;
  }
  return { changed };
}
