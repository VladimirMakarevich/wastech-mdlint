import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Element } from "hast";
import { h } from "hastscript";

import type { GitRepository } from "@wastech-mdlint/core";

import type { ChangeTracker } from "./changes.js";
import type { Corpus } from "./corpus.js";
import type { Diagnostics } from "./diagnostics.js";
import type { EventHub } from "./event-hub.js";
import { renderFindingsPanel } from "./findings-panel.js";
import { sendHtml } from "./http-send.js";
import type { Launcher } from "./open-file.js";
import { renderPage, type PageParams } from "./page.js";
import type { RenderCache } from "./render-cache.js";
import type { SinceReview } from "./review-state.js";
import type { ReviewStore } from "./review-store.js";
import type { DocumentSearch } from "./search.js";
import { treeMarksOf } from "./tree-marks.js";

// What every route of one running viewer shares: the corpus and what is known about it, the git
// review, the switches the command line set, and the few actions that touch all of it. The server
// builds it once and hands the same object to each group of routes, so a route reads state it is
// given rather than state it can reach, and no route keeps a second copy of the corpus or the review.

export const NO_CHANGES =
  "Changes compares the documents with a base branch, and this directory is not in a git work tree, or git is not on PATH.";

/** A page as a route describes it; the parts every page shares are filled in by `page`. */
export type PageBody = Omit<
  PageParams,
  | "siteName"
  | "documentPaths"
  | "showChanges"
  | "marks"
  | "eventSequence"
  | "findingsPanel"
>;

// A document page's findings panel, read with the tree's counts so the two never disagree. Nothing
// until the first lint is in: the page then says so by leaving findings out of the tree's current
// marks, and its script asks for both once the lint finishes.
function findingsPanelOf(
  state: { corpus: Corpus; diagnostics: Diagnostics },
  relPath: string | undefined,
): Element | undefined {
  const document =
    relPath === undefined ? undefined : state.corpus.documents.get(relPath);
  return document === undefined || !state.diagnostics.ready
    ? undefined
    : renderFindingsPanel(document.path, state.diagnostics.findings(document));
}

export type ViewerContext = {
  corpus: Corpus;
  // Undefined outside a git work tree, or without `git` on the path.
  changes: ChangeTracker | undefined;
  git: GitRepository | undefined;
  // Undefined where review marks are off: no git work tree, or a binding other machines reach.
  reviewStore: ReviewStore | undefined;
  sinceReviews: SinceReview | undefined;
  search: DocumentSearch;
  diagnostics: Diagnostics;
  renders: RenderCache;
  events: EventHub;
  allowConfigWrites: boolean;
  // Absolute paths and authors' names stay on this machine: shown only on a loopback binding.
  showAbsolutePaths: boolean;
  // Whether the repository is watched; without a watcher, a route that changes the corpus reloads it.
  watch: boolean;
  launch: Launcher;
  // Why opening the config is refused on this binding, or undefined where it is allowed.
  openRefused: string | undefined;
  // Random per process and written only into the pages that send a change, so a change request that
  // carries it came from a page this server rendered.
  changeToken: string;
  page(params: PageBody): Promise<string>;
  sendNotFound(
    request: IncomingMessage,
    response: ServerResponse,
    message: string,
  ): Promise<void>;
  // A repository file's path on this machine, in the platform's own form, for the copy button — or
  // nothing when pages are read from other machines.
  absolutePathOf(relPath: string): string | undefined;
  relint(): void;
};

export function viewerContext(
  state: Omit<
    ViewerContext,
    "page" | "sendNotFound" | "absolutePathOf" | "relint"
  >,
): ViewerContext {
  const siteName = path.basename(state.corpus.rootDir) || "repository";
  const page = async (params: PageBody): Promise<string> => {
    // Read before the marks, so an event sent while they are read is one the page is sent again
    // rather than one it claims to include. The panel is read in the same turn as the tree's counts,
    // which `treeMarksOf` takes before it waits for anything, so no lint can land between the two.
    const eventSequence = state.events.sequence;
    const findingsPanel = findingsPanelOf(state, params.documentPath);
    const marks = await treeMarksOf({
      diagnostics: state.diagnostics,
      review: state.changes?.cached(true),
      reviewStore: state.reviewStore,
      watch: state.watch,
    });
    return renderPage({
      ...params,
      siteName,
      documentPaths: [...state.corpus.documents.keys()],
      showChanges: state.changes !== undefined,
      showReview: state.reviewStore !== undefined,
      marks,
      eventSequence,
      findingsPanel,
    });
  };
  return {
    ...state,
    page,
    async sendNotFound(request, response, message) {
      sendHtml(
        response,
        404,
        await page({
          title: "Not found",
          article: [h("h1", "Not found"), h("p", message)],
        }),
        request.method === "HEAD",
      );
    },
    absolutePathOf(relPath) {
      return state.showAbsolutePaths
        ? path.join(state.corpus.rootDir, ...relPath.split("/"))
        : undefined;
    },
    // Runs on the event loop: `lintContext` is synchronous and takes a few hundred milliseconds on a
    // corpus of hundreds of documents, which is cheaper than handing the corpus to a worker and short
    // enough that the requests it holds up do not notice.
    relint() {
      try {
        state.diagnostics.update(state.corpus.lint());
        state.events.broadcast("diagnostics", {});
      } catch (error) {
        // The previous results stay; the terminal says why they did not refresh.
        process.stderr.write(
          `wastech-mdlint-viewer: linting failed: ${(error as Error).message}\n`,
        );
      }
    },
  };
}
