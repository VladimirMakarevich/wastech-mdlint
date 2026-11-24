import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ElementContent } from "hast";
import { h } from "hastscript";

import {
  changedSections,
  compareStrings,
  type GitRepository,
  headChanges,
  type LintMessage,
  type ParsedDocument,
} from "@wastech-mdlint/core";

import {
  ChangeTracker,
  changesPayload,
  diffPayload,
  diffViewOf,
  type DiffView,
  type DocumentReview,
  renderChangeBanner,
  renderChangesArticle,
  renderDiff,
  renderHunkTemplate,
  type BannerReview,
  type Review,
  type ReviewContext,
  type ReviewResult,
} from "./changes.js";
import { blameAnnotator } from "./blame.js";
import { dashboardChanges, graphChanges } from "./branch-changes.js";
import {
  candidateText,
  configApi,
  parseChangeRequest,
  previewCandidate,
  readConfigFile,
  renderConfigArticle,
  saveCandidate,
  validateCandidate,
  writeBlockedReason,
  type ChangeRequest,
  type ConfigFile,
} from "./config-editor.js";
import { Corpus } from "./corpus.js";
import {
  buildDashboard,
  dashboardCsv,
  parseDashboardQuery,
  renderDashboardArticle,
  type DashboardSource,
} from "./dashboard.js";
import { Diagnostics } from "./diagnostics.js";
import {
  buildGraphView,
  buildNeighborhoodView,
  documentNeighbors,
  graphFolders,
  type GraphView,
  renderGraphArticle,
  withChanges,
} from "./graph-view.js";
import { highlight, languageForPath, withCopyButton } from "./highlight.js";
import {
  launchDetached,
  openCommand,
  openRefusal,
  type Launcher,
} from "./open-file.js";
import { rawHtml, renderPage, type PageParams } from "./page.js";
import { findingPrompts } from "./prompts.js";
import {
  renderDocument,
  documentHref,
  type LineAnnotator,
  type RenderedDocument,
} from "./render-document.js";
import { decodeRequestPath } from "./request-path.js";
import {
  baselineOf,
  type Baseline,
  markOf,
  markReview,
  parseMarkRequest,
  parseResetRequest,
  parseSectionRequest,
  sectionHashes,
  sectionMarksOf,
  type ReviewMarksView,
  SinceReview,
} from "./review-state.js";
import { contentHash, type MarkChange, ReviewStore } from "./review-store.js";
import { DocumentSearch } from "./search.js";
import {
  assetHeaders,
  changeRequestProblem,
  exposesAbsolutePaths,
  isAllowedHostHeader,
  isForeignRequest,
  isLoopbackHost,
  pageHeaders,
  rawFileHeaders,
} from "./security.js";
import { defaultStateDir } from "./state-dir.js";
import { watchGitRefs, watchRepository } from "./watch.js";

export type ViewerOptions = {
  cwd: string;
  configPath?: string;
  host: string;
  port: number;
  // An explicit port is a promise to the user; only the default may move to the next free one.
  portExplicit: boolean;
  watch: boolean;
  // Off unless the user asked for it: without it the viewer writes nothing to the repository.
  allowConfigWrites?: boolean;
  // Starts the program that reveals or opens the config file. Replaced in tests, so a test run checks
  // what would be started without opening a window on the machine running it.
  launch?: Launcher;
  // The branch, tag or commit the Changes section compares with; the detected base branch when
  // omitted.
  base?: string;
  // The environment git runs with — the process's own unless a test isolates it from the machine's
  // git configuration.
  gitEnv?: NodeJS.ProcessEnv;
  // Where review marks are kept: the platform's state directory unless `--state-dir` names another.
  // Tests that mark name a temporary one, so a test run never writes to the machine's own marks.
  stateDir?: string;
};

export type RunningViewer = {
  url: string;
  documentCount: number;
  // What the user should know about the startup that is not an error: why the Changes section has
  // nothing to compare, for one.
  notices: string[];
  close(): Promise<void>;
};

// How many ports above the default to try before giving up, so a second viewer started beside a
// first one simply lands next to it.
const PORT_ATTEMPTS = 20;

const GRAPH_NOT_FOUND =
  "The graph shows a folder that holds corpus documents, and can highlight a document in the corpus; this address names something else.";

const NO_CHANGES =
  "Changes compares the documents with a base branch, and this directory is not in a git work tree, or git is not on PATH.";

// `worktree=0` limits a review to committed changes; anything else, or nothing, includes the work
// tree, which is what a reader in the middle of an edit wants to see.
function worktreeOf(params: URLSearchParams): boolean {
  return params.get("worktree") !== "0";
}

// A config change or a review mark is at most a few kilobytes of JSON; anything far beyond that is
// not one, and reading it into memory would cost the server for nothing.
const MAX_CHANGE_BODY_BYTES = 256 * 1024;

// The only requests with a body the server acts on. Each computes from the config, writes it, opens
// it in another program or records a review mark, so each passes the checks in
// `changeRequestProblem` before its body is read.
const CHANGE_ROUTES = new Set([
  "/api/config/preview",
  "/api/config/save",
  "/api/config/open",
  "/api/review/mark",
  "/api/review/section",
  "/api/review/reset",
]);

// Enough of a document's history to see who has been changing it lately, without paging through it.
const HISTORY_COMMITS = 8;

const REVIEW_OFF =
  "Review marks are off: they need a git work tree, and a viewer bound to a loopback address, since a mark records this user's review on this machine.";

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

// The viewer's own files. Both paths climb one level first, so they resolve to the same files from
// `dist/` when installed and from `src/` when the tests load the sources.
const STYLESHEET = fileURLToPath(
  new URL("../assets/viewer.css", import.meta.url),
);
// The tab icon, so a viewer tab stands out among the others a reader has open.
const FAVICON = fileURLToPath(
  new URL("../assets/favicon.ico", import.meta.url),
);
const CLIENT_DIR = fileURLToPath(new URL("../dist/client/", import.meta.url));
// The page scripts are the compiled client modules, which import one another by file name. A name
// is one lowercase segment ending in `.js`, so a request can reach nothing but a compiled module.
const CLIENT_SCRIPT_NAME = /^[a-z][a-z0-9-]*\.js$/;

// Mermaid is served from the installed package rather than a CDN: the viewer works offline, behind
// a proxy, and under a CSP that allows scripts from this origin only. Located through `require`
// resolution rather than `import.meta.resolve`, which test runners that transform modules do not
// provide; the package's `default` export condition makes both land on the same file.
const MERMAID_DIST = path.dirname(
  createRequire(import.meta.url).resolve("mermaid"),
);
const MERMAID_ENTRY = "mermaid.esm.min.mjs";
const MERMAID_CHUNKS = "chunks/mermaid.esm.min/";
// ECharts, for the same reasons. Its browser build is one self-contained module, so that one file
// is the only thing served from the package; any other name under the prefix is not looked up.
const ECHARTS_SCRIPT = path.join(
  path.dirname(createRequire(import.meta.url).resolve("echarts")),
  "echarts.esm.min.mjs",
);

export async function startViewer(
  options: ViewerOptions,
): Promise<RunningViewer> {
  const corpus = await Corpus.load({
    cwd: options.cwd,
    configPath: options.configPath,
  });
  const siteName = path.basename(corpus.rootDir) || "repository";
  const notices: string[] = [];
  const changes = await ChangeTracker.open(corpus, {
    base: options.base,
    env: options.gitEnv,
  });
  if (changes !== undefined) {
    // Computed once now: a `--base` that names nothing is reported where it was typed, and the first
    // visit to the Changes section finds the review ready.
    const first = await changes.review(true);
    if ("available" in first) {
      notices.push(`changes: ${first.message} ${first.hint}`);
    }
  }
  // Review marks, for a reader on this machine only: from another one, anyone who reached the port
  // could record a review in this user's name and read which documents they have reviewed. Nothing
  // is created here; the clone's folder appears with the first mark.
  const git = changes?.git;
  const reviewStore =
    git !== undefined && isLoopbackHost(options.host)
      ? new ReviewStore({
          // A relative `--state-dir` is taken from where the viewer was started, as a shell user
          // expects, and fixed now, so it means the same folder for as long as the viewer runs.
          stateDir:
            options.stateDir === undefined
              ? defaultStateDir(process.platform, process.env, os.homedir())
              : path.resolve(options.stateDir),
          commonDir: git.commonDir,
          keyOf: (relPath) => git.topLevelPath(relPath),
        })
      : undefined;
  const sinceReviews =
    reviewStore === undefined ? undefined : new SinceReview(reviewStore);
  const bound = { host: options.host, port: options.port };
  const eventClients = new Set<ServerResponse>();
  const search = new DocumentSearch();
  const diagnostics = new Diagnostics();
  const allowConfigWrites = options.allowConfigWrites === true;
  const showAbsolutePaths = exposesAbsolutePaths(options.host);
  const launch = options.launch ?? launchDetached;
  const openRefused = openRefusal(options.host);
  // Random per process and written only into the config page, so a change request that carries it
  // came from a page this server rendered.
  const changeToken = randomBytes(32).toString("hex");
  // Saves run one at a time: between checking that the file is the version the page edited and
  // replacing it, a second save must not slip in.
  let configWrites = Promise.resolve();

  // Keyed by the document object, which the corpus replaces whenever the file changes, so an edit
  // misses the cache without any explicit invalidation. Link targets also depend on which other
  // files exist, so a change to the set of documents starts a fresh cache, and a document the corpus
  // reports changed without replacing it — a file it links to appeared or went — is dropped from it.
  let rendered = new WeakMap<ParsedDocument, Promise<RenderedDocument>>();

  function render(document: ParsedDocument): Promise<RenderedDocument> {
    let pending = rendered.get(document);
    if (pending === undefined) {
      pending = renderDocument(document, {
        resolve: (fromPath, target, isImage) =>
          corpus.resolve(fromPath, target, isImage),
        resolveEmbedded: (target, isImage) =>
          corpus.resolveEmbedded(document, target, isImage),
      });
      rendered.set(document, pending);
      // A failed render is not cached, so fixing the file (or a transient read error) recovers.
      pending.catch(() => rendered.delete(document));
    }
    return pending;
  }

  type MarkedDocument = {
    rendered: RenderedDocument;
    changedSections: Set<string>;
  };

  // A document rendered with its changes marked, kept for as long as the review it was marked from:
  // the tracker replaces every review after the watcher's next batch, which is also what brings a new
  // text or a change in which files the links reach, so an entry never outlives what it was made of.
  const marked = new WeakMap<
    DocumentReview,
    { document: ParsedDocument; result: Promise<MarkedDocument> }
  >();

  // With blame, nothing is kept: blame is asked for one page at a time, and the blame of a file moves
  // with every commit, which nothing here would notice.
  function renderMarked(
    document: ParsedDocument,
    review: DocumentReview,
    annotate?: LineAnnotator,
  ): Promise<MarkedDocument> {
    const entry = marked.get(review);
    if (
      annotate === undefined &&
      entry !== undefined &&
      entry.document === document
    ) {
      return entry.result;
    }
    const changes = headChanges(review.diff);
    const result = renderDocument(
      document,
      resolversFor(document),
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
    }));
    if (annotate === undefined) {
      marked.set(review, { document, result });
      result.catch(() => marked.delete(review));
    }
    return result;
  }

  /**
   * The review of a document page's own changes, or `undefined` when it has none to show. Always the
   * work-tree review: the page renders the file on disk, and only that review's line numbers are its
   * lines. Its head text is compared with the text being rendered, so a page requested between a
   * save reaching the corpus and the review being rebuilt is never marked from the other text.
   */
  async function reviewOf(
    document: ParsedDocument,
  ): Promise<DocumentReview | undefined> {
    if (changes === undefined) {
      return undefined;
    }
    const review = await changes.review(true);
    if ("available" in review) {
      return undefined;
    }
    return review.documents.find(
      (entry) =>
        entry.path === document.path && entry.headText === document.content,
    );
  }

  // A repository file's path on this machine, in the platform's own form, for the copy button — or
  // nothing when pages are read from other machines.
  function absolutePathOf(relPath: string): string | undefined {
    return showAbsolutePaths
      ? path.join(corpus.rootDir, ...relPath.split("/"))
      : undefined;
  }

  function page(
    params: Omit<PageParams, "siteName" | "documentPaths" | "showChanges">,
  ): string {
    return renderPage({
      ...params,
      siteName,
      documentPaths: [...corpus.documents.keys()],
      showChanges: changes !== undefined,
      showReview: reviewStore !== undefined,
    });
  }

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!isAllowedHostHeader(request.headers.host, bound)) {
      sendText(
        response,
        403,
        "Forbidden: this server answers only to localhost.",
      );
      return;
    }
    if (
      isForeignRequest(
        request.headers as Parameters<typeof isForeignRequest>[0],
      )
    ) {
      sendText(response, 403, "Forbidden: cross-site request.");
      return;
    }
    const [target = "", queryString = ""] = (request.url ?? "")
      .split("#", 1)[0]!
      .split("?", 2);
    if (CHANGE_ROUTES.has(target)) {
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        sendText(
          response,
          405,
          "Method not allowed: send the change as a POST.",
        );
        return;
      }
      await handleChange(request, response, target);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendText(
        response,
        405,
        "Method not allowed: only the config page's and the review marks' requests take a body.",
      );
      return;
    }

    const params = new URLSearchParams(queryString);
    if (target === "/") {
      redirectToIndex(response);
    } else if (target === "/search") {
      sendSearchPage(request, response, params.get("q") ?? "");
    } else if (target === "/api/search") {
      const query = params.get("q") ?? "";
      sendJson(response, {
        query,
        results: search.search(corpus.documents, query),
      });
    } else if (target === "/graph") {
      await sendGraphPage(request, response, params);
    } else if (target === "/api/graph") {
      const graphRequest = parseGraphRequest(params);
      if (graphRequest === undefined) {
        sendJson(response, { error: GRAPH_NOT_FOUND }, 404);
      } else {
        sendJson(
          response,
          await graphWithChanges(
            buildGraphView(
              corpus.graph,
              corpus.documents,
              graphRequest.folder,
              graphRequest.focus,
            ),
            params,
          ),
        );
      }
    } else if (target === "/api/neighbors") {
      // Only ever compared against the corpus's own paths, like the graph's parameters.
      const path = params.get("path") ?? "";
      if (corpus.documents.has(path)) {
        sendJson(
          response,
          await graphWithChanges(
            buildNeighborhoodView(corpus.graph, corpus.documents, path),
            params,
          ),
        );
      } else {
        sendJson(
          response,
          { error: "This path is not a document in the corpus." },
          404,
        );
      }
    } else if (target === "/changes") {
      await sendChangesPage(request, response, params);
    } else if (target === "/api/changes") {
      if (changes === undefined) {
        sendJson(response, { error: NO_CHANGES }, 404);
      } else {
        const review = await changes.review(worktreeOf(params));
        sendJson(
          response,
          changesPayload(
            review,
            await contextOf(review),
            await marksOf(review),
          ),
        );
      }
    } else if (target === "/api/history") {
      await sendHistory(response, params);
    } else if (target === "/api/changes/diff") {
      await sendChangeDiff(response, params);
    } else if (target === "/dashboard") {
      await sendDashboardPage(request, response, params);
    } else if (target === "/api/dashboard") {
      await sendDashboardData(response, params);
    } else if (target === "/config") {
      sendHtml(
        response,
        200,
        page({
          title: "Linter config",
          section: "config",
          article: await renderConfigArticle(corpus, {
            allowWrites: allowConfigWrites,
            showAbsolutePath: showAbsolutePaths,
            canOpen: openRefused === undefined,
          }),
          changeToken,
        }),
        request.method === "HEAD",
      );
    } else if (target === "/api/config") {
      sendJson(response, await configApi(corpus, allowConfigWrites));
    } else if (target === "/api/diagnostics") {
      sendDiagnostics(response, params);
    } else if (target === "/api/prompts") {
      const line = params.get("line");
      const answer = await findingPrompts({
        corpus,
        findings: diagnostics.messagesByFile,
        // Only ever compared against the corpus's own paths and the findings' own rule ids.
        filePath: params.get("path") ?? "",
        ruleId: params.get("rule") ?? undefined,
        line: line === null ? undefined : Number(line),
      });
      sendJson(response, answer.body, answer.status);
    } else if (target === "/events") {
      openEventStream(request, response);
    } else if (target === "/favicon.ico") {
      await sendPackageAsset(request, response, "favicon.ico");
    } else if (target.startsWith("/assets/")) {
      await sendPackageAsset(
        request,
        response,
        target.slice("/assets/".length),
      );
    } else if (target === "/vendor/echarts/echarts.esm.min.mjs") {
      await sendScript(request, response, ECHARTS_SCRIPT);
    } else if (target.startsWith("/vendor/mermaid/")) {
      await sendMermaid(
        request,
        response,
        target.slice("/vendor/mermaid/".length),
      );
    } else if (target.startsWith("/doc/")) {
      await sendDocument(
        request,
        response,
        decodeRequestPath(target.slice("/doc/".length)),
        diffViewOf(params),
        baselineOf(params),
        params.get("blame") === "1",
      );
    } else if (target.startsWith("/file/")) {
      await sendLinkedFile(
        request,
        response,
        decodeRequestPath(target.slice("/file/".length)),
      );
    } else {
      sendNotFound(request, response, "There is no page at this address.");
    }
  }

  function redirectToIndex(response: ServerResponse): void {
    const index = ["README.md", "readme.md", "index.md"].find((name) =>
      corpus.documents.has(name),
    );
    const first = index ?? corpus.documents.keys().next().value;
    if (first === undefined) {
      sendHtml(
        response,
        200,
        page({
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

  async function sendDocument(
    request: IncomingMessage,
    response: ServerResponse,
    relPath: string | undefined,
    view: DiffView,
    baseline: Baseline,
    blame: boolean,
  ): Promise<void> {
    const document =
      relPath === undefined ? undefined : corpus.documents.get(relPath);
    if (relPath === undefined || document === undefined) {
      sendNotFound(
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
      blame && git !== undefined
        ? await blameOf(git, relPath, document.content)
        : undefined;
    const common = {
      displayPath: relPath,
      absolutePath: absolutePathOf(relPath),
      documentPath: relPath,
      backlinks: corpus.backlinks(relPath),
      neighborCount: documentNeighbors(corpus.graph, relPath).length,
      ...(git === undefined
        ? {}
        : {
            blameToggle: {
              on: annotate !== undefined,
              href: documentPageHref(relPath, view, baseline, !blame),
            },
          }),
    };
    const plain = (): Promise<RenderedDocument> =>
      annotate === undefined
        ? render(document)
        : renderDocument(document, resolversFor(document), undefined, annotate);
    const branchReview = await reviewOf(document);
    const reviewed = await bannerReviewOf(branchReview, baseline);
    // What the page marks: the branch's changes, or the changes since the reader's last review when
    // the page compares with that and the reviewed text is still kept.
    const review = reviewed?.since ?? branchReview;
    const banner = (shown: DiffView) =>
      branchReview === undefined
        ? undefined
        : renderChangeBanner(branchReview, shown, reviewed);
    const localGraphChanges = review !== undefined && view !== "off";
    let params: Omit<PageParams, "siteName" | "documentPaths" | "showChanges">;
    if (review !== undefined && view === "source") {
      // The diff takes the article's place. The outline is left out with the rendered text, since
      // none of its headings is on this page to jump to.
      const { title } = await plain();
      params = {
        ...common,
        localGraphChanges,
        title,
        changeBanner: banner(view),
        article: [
          h("div.change-source", renderDiff(review.diff, review.headText)),
        ],
      };
    } else if (
      review !== undefined &&
      view === "rendered" &&
      // On a document the branch added, every block would carry the same mark the line above it
      // already gives the whole page.
      review.status !== "A" &&
      review.diff.hunks.length > 0
    ) {
      const { rendered, changedSections } = await renderMarked(
        document,
        review,
        annotate,
      );
      params = {
        ...common,
        localGraphChanges,
        title: rendered.title,
        changeBanner: banner(view),
        article: [...rawHtml(rendered.html), renderHunkTemplate(review.diff)],
        headings: document.headings,
        changedSections,
        frontmatter: document.frontmatter,
        frontmatterChange: rendered.frontmatterChange,
      };
    } else {
      const { html, title } = await plain();
      params = {
        ...common,
        localGraphChanges,
        title,
        changeBanner: banner(view),
        article: rawHtml(html),
        headings: document.headings,
        frontmatter: document.frontmatter,
      };
    }
    sendHtml(
      response,
      200,
      page({
        ...params,
        // The "Viewed" checkbox above a changed document sends its mark with it, and so does each
        // section's in the outline.
        ...(reviewed === undefined || branchReview === undefined
          ? {}
          : {
              changeToken,
              sectionMarks: {
                path: branchReview.path,
                marks: reviewed.sections,
              },
            }),
      }),
      request.method === "HEAD",
    );
  }

  /**
   * What the line above a changed document says about the reader's review of it, and the review
   * since their last one when the page compares with that; `undefined` where marks are off or
   * cannot be read, which the Changes page explains.
   */
  async function bannerReviewOf(
    review: DocumentReview | undefined,
    baseline: Baseline,
  ): Promise<BannerReview | undefined> {
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
        ? await sinceReviews?.of(review, version)
        : undefined;
    return {
      mark,
      baseline,
      sections,
      ...(since === undefined ? {} : { since }),
    };
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

  // The margin notes of one document, or `undefined` when git cannot blame it or the file on disk is
  // no longer the text being rendered.
  async function blameOf(
    repository: GitRepository,
    relPath: string,
    content: string,
  ): Promise<LineAnnotator | undefined> {
    const onDisk = await readFile(
      path.join(corpus.rootDir, ...relPath.split("/")),
      "utf8",
    ).catch(() => undefined);
    if (onDisk !== content) {
      return undefined;
    }
    const lines = await repository.blame(relPath).catch(() => []);
    return lines.length === 0
      ? undefined
      : blameAnnotator(lines, showAbsolutePaths);
  }

  function resolversFor(document: ParsedDocument) {
    return {
      resolve: (fromPath: string, target: string, isImage: boolean) =>
        corpus.resolve(fromPath, target, isImage),
      resolveEmbedded: (target: string, isImage: boolean) =>
        corpus.resolveEmbedded(document, target, isImage),
    };
  }

  // The commits that last touched a document, for the line above its text: newest first, a few at
  // most, the author's name only on a loopback binding, as a person's name is kept to this machine.
  async function sendHistory(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
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
        ...(showAbsolutePaths ? { author: commit.author } : {}),
      })),
    });
  }

  async function sendLinkedFile(
    request: IncomingMessage,
    response: ServerResponse,
    relPath: string | undefined,
  ): Promise<void> {
    const absolutePath =
      relPath !== undefined && corpus.isLinkedFile(relPath)
        ? await corpus.resolveFile(relPath)
        : undefined;
    if (relPath === undefined || absolutePath === undefined) {
      sendNotFound(
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

    const { size } = await stat(absolutePath);
    let article: ElementContent[];
    if (size > MAX_SOURCE_BYTES) {
      article = [
        h("h1", relPath),
        h("p", "This file is too large to display."),
      ];
    } else {
      const bytes = await readFile(absolutePath);
      // A NUL byte in the first block is the same heuristic git uses to call a file binary.
      if (bytes.subarray(0, 8000).includes(0)) {
        article = [
          h("h1", relPath),
          h("p", "This is a binary file and cannot be displayed."),
        ];
      } else {
        const code = await highlight(
          bytes.toString("utf8"),
          languageForPath(relPath),
          {
            lineAnchors: true,
          },
        );
        article = [
          h("h1.source-title", relPath),
          h("div.source-view", [withCopyButton(code)]),
        ];
      }
    }
    sendHtml(
      response,
      200,
      page({
        title: relPath,
        article,
        displayPath: relPath,
        absolutePath: absolutePathOf(relPath),
      }),
      request.method === "HEAD",
    );
  }

  async function sendPackageAsset(
    request: IncomingMessage,
    response: ServerResponse,
    name: string,
  ): Promise<void> {
    const asset =
      name === "viewer.css"
        ? { file: STYLESHEET, type: "text/css; charset=utf-8" }
        : name === "favicon.ico"
          ? { file: FAVICON, type: "image/x-icon" }
          : CLIENT_SCRIPT_NAME.test(name)
            ? {
                file: path.join(CLIENT_DIR, name),
                type: "text/javascript; charset=utf-8",
              }
            : undefined;
    const body =
      asset === undefined
        ? undefined
        : await readFile(asset.file).catch(() => undefined);
    if (asset === undefined || body === undefined) {
      sendText(response, 404, "Not found.");
      return;
    }
    response.writeHead(200, { ...assetHeaders(), "Content-Type": asset.type });
    response.end(request.method === "HEAD" ? undefined : body);
  }

  function sendSearchPage(
    request: IncomingMessage,
    response: ServerResponse,
    query: string,
  ): void {
    const hits = search.search(corpus.documents, query);
    const article: ElementContent[] =
      query.trim().length === 0
        ? [h("h1", "Search"), h("p", "Type a word or phrase to search for.")]
        : [
            h("h1", `Search: ${query}`),
            hits.length === 0
              ? h("p", "No documents match.")
              : h(
                  "ol.search-page-results",
                  hits.map((hit) =>
                    h("li", [
                      h("a.search-hit-title", { href: hit.href }, [
                        ...markTerms(hit.title, hit.terms),
                      ]),
                      h("div.search-hit-path", hit.path),
                      h("p.search-hit-snippet", [
                        ...markTerms(hit.snippet, hit.terms),
                      ]),
                    ]),
                  ),
                ),
          ];
    sendHtml(
      response,
      200,
      page({ title: query ? `Search: ${query}` : "Search", article, query }),
      request.method === "HEAD",
    );
  }

  // The folder and focused document a graph request names, or `undefined` when either is not part of
  // the corpus. Both are only compared against the corpus's own paths, never joined onto a
  // filesystem path, so nothing a request writes here reaches the disk.
  function parseGraphRequest(
    params: URLSearchParams,
  ): { folder: string; focus: string | undefined } | undefined {
    const folder = params.get("folder") ?? "";
    // `focus=` with nothing after it, as a hand-edited address may carry, focuses nothing.
    const focus = params.get("focus") || undefined;
    if (
      (folder !== "" &&
        !graphFolders(corpus.documents.keys()).includes(folder)) ||
      (focus !== undefined && !corpus.documents.has(focus))
    ) {
      return undefined;
    }
    return { folder, focus };
  }

  /**
   * What the branch did, for the pages that show it beside everything else — the dashboard and the
   * graph. The work-tree review, as both show the files on disk; `undefined` outside a git work tree
   * or while there is nothing to compare.
   */
  async function workTreeChanges(): Promise<
    { review: Review; context: ReviewContext } | undefined
  > {
    if (changes === undefined) {
      return undefined;
    }
    const review = await changes.review(true);
    if ("available" in review) {
      return undefined;
    }
    const context = await contextOf(review);
    return context === undefined ? undefined : { review, context };
  }

  // `changes=1` marks the branch's changes on a graph view; without it, or without a branch to
  // compare, the view is the graph as it is.
  async function graphWithChanges(
    view: GraphView,
    params: URLSearchParams,
  ): Promise<GraphView> {
    if (params.get("changes") !== "1") {
      return view;
    }
    const branch = await workTreeChanges();
    return branch === undefined
      ? view
      : withChanges(
          view,
          corpus.graph,
          graphChanges(branch.review, branch.context),
        );
  }

  async function sendGraphPage(
    request: IncomingMessage,
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const graphRequest = parseGraphRequest(params);
    if (graphRequest === undefined) {
      sendNotFound(request, response, GRAPH_NOT_FOUND);
      return;
    }
    const view = await graphWithChanges(
      buildGraphView(
        corpus.graph,
        corpus.documents,
        graphRequest.folder,
        graphRequest.focus,
      ),
      params,
    );
    sendHtml(
      response,
      200,
      page({
        title: "Link graph",
        section: "graph",
        article: renderGraphArticle(
          view,
          graphFolders(corpus.documents.keys()),
          graphRequest.focus,
          changes === undefined
            ? undefined
            : { shown: params.get("changes") === "1" },
        ),
      }),
      request.method === "HEAD",
    );
  }

  async function sendChangesPage(
    request: IncomingMessage,
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    if (changes === undefined) {
      sendNotFound(request, response, NO_CHANGES);
      return;
    }
    const worktree = worktreeOf(params);
    const review = await changes.review(worktree);
    const marks = await marksOf(review);
    const baseline = baselineOf(params);
    sendHtml(
      response,
      200,
      page({
        title: "Changes",
        section: "changes",
        article: renderChangesArticle(
          review,
          worktree,
          await contextOf(review),
          marks === undefined || "available" in review
            ? undefined
            : {
                marks,
                baseline,
                since:
                  baseline === "review"
                    ? await sinceOf(review, marks)
                    : new Map(),
              },
        ),
        // The "Viewed" checkboxes send their mark with it.
        changeToken: marks === undefined ? undefined : changeToken,
      }),
      request.method === "HEAD",
    );
  }

  /**
   * The context of a review, or `undefined` when there is none to show. A failure to compute it is
   * reported here and leaves the page with its diffs, which do not depend on it.
   */
  async function contextOf(
    review: ReviewResult,
  ): Promise<ReviewContext | undefined> {
    if (changes === undefined || "available" in review) {
      return undefined;
    }
    try {
      return await changes.context(review);
    } catch (error) {
      process.stderr.write(
        `wastech-mdlint-viewer: could not compare the context: ${(error as Error).message}
`,
      );
      return undefined;
    }
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
      const marks = await marksOf(review);
      const since =
        entry === undefined
          ? undefined
          : (await sinceOf(review, marks)).get(relPath);
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

  async function dashboardSource(): Promise<DashboardSource> {
    const findings = diagnostics.messagesByFile;
    // The rules a reader can pick: the ones the config runs, plus any other id a finding carries,
    // such as the report about a malformed suppression comment.
    const ruleIds = new Set(
      corpus.configuration.rules
        .filter(({ severity }) => severity !== "off")
        .map(({ rule }) => rule.id),
    );
    for (const messages of findings?.values() ?? []) {
      for (const message of messages) {
        ruleIds.add(message.ruleId);
      }
    }
    const branch = await workTreeChanges();
    return {
      documents: corpus.documents,
      graph: corpus.graph,
      findings,
      ruleIds: [...ruleIds].sort(compareStrings),
      folders: graphFolders(corpus.documents.keys()),
      ...(branch === undefined
        ? {}
        : { changes: dashboardChanges(branch.review, branch.context) }),
    };
  }

  async function sendDashboardPage(
    request: IncomingMessage,
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const source = await dashboardSource();
    const parsed = parseDashboardQuery(params, source);
    sendHtml(
      response,
      parsed.ok ? 200 : 400,
      page({
        title: "Dashboard",
        section: "dashboard",
        article: renderDashboardArticle(
          parsed.ok
            ? {
                params,
                source,
                ok: true,
                query: parsed.query,
                result: buildDashboard(source, parsed.query),
              }
            : { params, source, ok: false, message: parsed.message },
        ),
      }),
      request.method === "HEAD",
    );
  }

  async function sendDashboardData(
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> {
    const source = await dashboardSource();
    const parsed = parseDashboardQuery(params, source, ["format"]);
    const format = params.get("format") ?? "";
    if (!parsed.ok || !["", "json", "csv"].includes(format)) {
      sendJson(
        response,
        {
          error: parsed.ok
            ? `Unknown format "${format}": use csv or json.`
            : parsed.message,
        },
        400,
      );
      return;
    }
    const result = buildDashboard(source, parsed.query);
    if (format === "csv") {
      response.writeHead(200, {
        ...pageHeaders(),
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="dashboard.csv"',
      });
      response.end(dashboardCsv(result));
      return;
    }
    sendJson(
      response,
      { query: parsed.query, ...result },
      200,
      format === "json"
        ? { "Content-Disposition": 'attachment; filename="dashboard.json"' }
        : {},
    );
  }

  async function handleChange(
    request: IncomingMessage,
    response: ServerResponse,
    target: string,
  ): Promise<void> {
    const problem = changeRequestProblem(
      request.headers as Parameters<typeof changeRequestProblem>[0],
      changeToken,
    );
    if (problem !== undefined) {
      request.resume();
      sendJson(
        response,
        { status: "refused", error: problem.message },
        problem.status,
      );
      return;
    }
    const body = await readBody(request, MAX_CHANGE_BODY_BYTES);
    if (body === undefined) {
      sendJson(
        response,
        {
          status: "refused",
          error:
            "The request body is too large to be a config change or a review mark.",
        },
        413,
      );
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      sendJson(
        response,
        { status: "refused", error: "The request body is not valid JSON." },
        400,
      );
      return;
    }
    if (target === "/api/config/open") {
      await openConfig(response, json);
      return;
    }
    if (target === "/api/review/section") {
      await changeSectionMark(response, json);
      return;
    }
    if (target === "/api/review/mark" || target === "/api/review/reset") {
      await changeMarks(response, target, json);
      return;
    }
    const parsed = parseChangeRequest(json);
    if (!parsed.ok) {
      sendJson(response, { status: "refused", error: parsed.message }, 400);
      return;
    }
    if (target === "/api/config/save") {
      const run = configWrites.then(() => saveChange(response, parsed.request));
      configWrites = run.catch(() => undefined);
      await run;
      return;
    }
    await previewChange(response, parsed.request);
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
      sendJson(
        response,
        { status: outcome.status, error: outcome.message },
        outcome.status === "failed"
          ? 500
          : outcome.status === "busy"
            ? 503
            : 409,
      );
      return;
    }
    // Every open page counts what is left, so each is told; nothing on disk the watcher sees changed.
    broadcast("review", {});
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
    if (
      entry === undefined ||
      section === undefined ||
      section.hash !== asked.hash
    ) {
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
      sendJson(
        response,
        { status: outcome.status, error: outcome.message },
        outcome.status === "failed"
          ? 500
          : outcome.status === "busy"
            ? 503
            : 409,
      );
      return;
    }
    broadcast("review", {});
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

  /** The marks of a review's documents, or `undefined` where review marks are off. */
  async function marksOf(
    review: ReviewResult,
  ): Promise<ReviewMarksView | undefined> {
    if (reviewStore === undefined || "available" in review) {
      return undefined;
    }
    return markReview(review, await reviewStore.read());
  }

  /**
   * Each changed document's review since the reader's last review of it, for a page that compares
   * with that: only documents changed since they were reviewed, and only those whose reviewed text
   * is still kept.
   */
  async function sinceOf(
    review: Review,
    marks: ReviewMarksView | undefined,
  ): Promise<Map<string, DocumentReview>> {
    const since = new Map<string, DocumentReview>();
    if (sinceReviews === undefined || marks?.ok !== true) {
      return since;
    }
    for (const entry of review.documents) {
      const version = marks.documents.get(entry.path)?.since;
      const rebased =
        version === undefined
          ? undefined
          : await sinceReviews.of(entry, version);
      if (rebased !== undefined) {
        since.set(entry.path, rebased);
      }
    }
    return since;
  }

  // Shows the config file in the file manager or opens it in its default application, on the
  // machine running the viewer. The file is always the one the corpus was loaded from; the request
  // only picks which of the two, so it can name no other file and pass no argument of its own.
  async function openConfig(
    response: ServerResponse,
    body: unknown,
  ): Promise<void> {
    const action = (body as { action?: unknown } | null)?.action;
    if (action !== "reveal" && action !== "open") {
      sendJson(
        response,
        {
          status: "refused",
          error: 'The action must be "reveal" or "open".',
        },
        400,
      );
      return;
    }
    if (openRefused !== undefined) {
      sendJson(response, { status: "refused", error: openRefused }, 403);
      return;
    }
    const file = await readConfigFile(corpus);
    if (file === undefined) {
      sendJson(
        response,
        {
          status: "refused",
          error: "This repository has no config file to open.",
        },
        409,
      );
      return;
    }
    const command = openCommand(process.platform, action, file.absolutePath);
    if (command === undefined) {
      sendJson(
        response,
        {
          status: "refused",
          error:
            "The config file's path cannot be passed to the system safely.",
        },
        409,
      );
      return;
    }
    try {
      await launch(command);
    } catch (error) {
      sendJson(
        response,
        {
          status: "failed",
          error: `Could not start ${command.command}: ${(error as Error).message}`,
        },
        500,
      );
      return;
    }
    sendJson(response, { status: "opened", action });
  }

  // The file a change applies to, or `undefined` after answering why there is none to apply it to.
  async function changeBase(
    response: ServerResponse,
    base: string,
  ): Promise<ConfigFile | undefined> {
    const file = await readConfigFile(corpus);
    if (file === undefined) {
      sendJson(
        response,
        {
          status: "refused",
          error: "This repository has no config file to change.",
        },
        409,
      );
      return undefined;
    }
    if (file.hash !== base) {
      sendJson(
        response,
        {
          status: "conflict",
          error:
            "The config changed on disk since this page read it. Reload the page to edit the new version.",
        },
        409,
      );
      return undefined;
    }
    return file;
  }

  async function previewChange(
    response: ServerResponse,
    change: ChangeRequest,
  ): Promise<void> {
    const file = await changeBase(response, change.base);
    if (file === undefined) {
      return;
    }
    const candidate = candidateText(file, change);
    if (!candidate.ok) {
      sendJson(response, { status: "invalid", errors: candidate.errors }, 422);
      return;
    }
    const validated = validateCandidate(corpus, file, candidate.text);
    if (!validated.ok) {
      sendJson(
        response,
        { status: "invalid", errors: validated.errors, text: candidate.text },
        422,
      );
      return;
    }
    sendJson(
      response,
      await previewCandidate({
        corpus,
        current: currentFindings(),
        candidate: validated.loaded,
        text: candidate.text,
      }),
    );
  }

  // What the config reports now: the background lint's result when it is in, else a lint run here.
  function currentFindings(): LintMessage[] {
    const byFile = diagnostics.messagesByFile;
    return byFile === undefined
      ? corpus.lint().messages
      : [...byFile.values()].flat();
  }

  async function saveChange(
    response: ServerResponse,
    change: ChangeRequest,
  ): Promise<void> {
    const blocked = await writeBlockedReason(corpus, allowConfigWrites);
    if (blocked !== undefined) {
      sendJson(response, { status: "refused", error: blocked }, 403);
      return;
    }
    if (change.text === undefined || change.edits !== undefined) {
      // A save writes exactly the text the reader previewed, never a result computed afresh here.
      sendJson(
        response,
        {
          status: "refused",
          error: "A save carries the previewed text and no edits.",
        },
        400,
      );
      return;
    }
    const file = await changeBase(response, change.base);
    if (file === undefined) {
      return;
    }
    const validated = validateCandidate(corpus, file, change.text);
    if (!validated.ok) {
      sendJson(response, { status: "invalid", errors: validated.errors }, 422);
      return;
    }
    const outcome = await saveCandidate({ file, text: change.text });
    if (outcome.status === "failed") {
      sendJson(response, { status: "failed", error: outcome.message }, 500);
      return;
    }
    if (outcome.status === "conflict") {
      sendJson(response, { status: "conflict", error: outcome.message }, 409);
      return;
    }
    // The watcher sees the config change and reloads the corpus as it does for any edit; without
    // one nothing else would, and every page would go on showing the old config's findings.
    if (!options.watch) {
      await corpus.reload();
      rendered = new WeakMap();
      changes?.invalidate();
      broadcast("change", { paths: [], structural: true });
      relint();
    }
    sendJson(response, outcome);
  }

  function sendDiagnostics(
    response: ServerResponse,
    params: URLSearchParams,
  ): void {
    if (!diagnostics.ready) {
      sendJson(response, { status: "pending" });
      return;
    }
    const relPath = params.get("path");
    if (relPath === null) {
      sendJson(response, { status: "ready", files: diagnostics.summary() });
      return;
    }
    const document = corpus.documents.get(relPath);
    sendJson(response, {
      status: "ready",
      findings: document === undefined ? [] : diagnostics.findings(document),
    });
  }

  async function sendMermaid(
    request: IncomingMessage,
    response: ServerResponse,
    encoded: string,
  ): Promise<void> {
    const relPath = decodeRequestPath(encoded);
    const allowed =
      relPath === MERMAID_ENTRY ||
      (relPath?.startsWith(MERMAID_CHUNKS) === true &&
        relPath.endsWith(".mjs"));
    await sendScript(
      request,
      response,
      allowed && relPath !== undefined
        ? path.join(MERMAID_DIST, ...relPath.split("/"))
        : undefined,
    );
  }

  // A script from an installed package; `file` is undefined when the request named nothing the
  // caller allows.
  async function sendScript(
    request: IncomingMessage,
    response: ServerResponse,
    file: string | undefined,
  ): Promise<void> {
    const body =
      file === undefined
        ? undefined
        : await readFile(file).catch(() => undefined);
    if (body === undefined) {
      sendText(response, 404, "Not found.");
      return;
    }
    response.writeHead(200, {
      ...assetHeaders(),
      "Content-Type": "text/javascript; charset=utf-8",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  }

  function sendNotFound(
    request: IncomingMessage,
    response: ServerResponse,
    message: string,
  ): void {
    sendHtml(
      response,
      404,
      page({
        title: "Not found",
        article: [h("h1", "Not found"), h("p", message)],
      }),
      request.method === "HEAD",
    );
  }

  function openEventStream(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    response.writeHead(200, {
      ...assetHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    // Reconnect quickly after a restart, so the page notices the new server within a second.
    response.write("retry: 1000\n\n");
    eventClients.add(response);
    request.on("close", () => eventClients.delete(response));
  }

  function broadcast(name: string, data: unknown): void {
    const message = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of eventClients) {
      client.write(message);
    }
  }

  // Runs on the event loop: `lintContext` is synchronous and takes a few hundred milliseconds on a
  // corpus of hundreds of documents, which is cheaper than handing the corpus to a worker and short
  // enough that the requests it holds up do not notice.
  function relint(): void {
    try {
      diagnostics.update(corpus.lint());
      broadcast("diagnostics", {});
    } catch (error) {
      // The previous results stay; the terminal says why they did not refresh.
      process.stderr.write(
        `wastech-mdlint-viewer: linting failed: ${(error as Error).message}\n`,
      );
    }
  }

  // Idle connections are closed by some proxies and by browsers after a while; a comment line every
  // so often keeps the stream open without the client seeing an event.
  const keepAlive = setInterval(() => {
    for (const client of eventClients) {
      client.write(": keep-alive\n\n");
    }
  }, 25_000);
  keepAlive.unref();

  // Changes are applied one batch at a time, in order: two overlapping updates could otherwise
  // finish out of order and leave the older corpus in place.
  let updates = Promise.resolve();
  const stopWatching = options.watch
    ? watchRepository(corpus.rootDir, (paths) => {
        updates = updates
          .then(async () => {
            const change = await corpus.applyChanges(paths);
            // Every reported path, even one that changed no document: a Markdown file outside the
            // corpus, or a document saved back to its committed text, changes the review all the same.
            changes?.invalidate();
            if (change.structural) {
              rendered = new WeakMap();
            }
            for (const changedPath of change.changed) {
              const document = corpus.documents.get(changedPath);
              if (document !== undefined) {
                rendered.delete(document);
              }
            }
            if (change.changed.length > 0 || change.structural) {
              // Every open page answers this event — a document page by reloading and waiting for
              // its review, every other page's script by asking for the changes — so the review
              // they will all join is started before they ask.
              if (changes !== undefined && eventClients.size > 0) {
                void changes.review(true).catch(() => undefined);
              }
              broadcast("change", {
                paths: change.changed,
                structural: change.structural,
              });
              relint();
            }
          })
          .catch((error: unknown) => {
            process.stderr.write(
              `wastech-mdlint-viewer: could not apply changes: ${(error as Error).message}\n`,
            );
          });
      })
    : () => {};

  // A commit, a checkout, a reset or a fetch moves what the review compares without touching the
  // work tree. The review is rebuilt as soon as git records the move, and open pages are told only
  // when it really is a different review: a ref of some other branch moving changes nothing they show.
  const stopWatchingRefs =
    options.watch && git !== undefined
      ? watchGitRefs(git, () => {
          void refreshAfterGitMove();
        })
      : () => {};

  async function refreshAfterGitMove(): Promise<void> {
    if (changes === undefined) {
      return;
    }
    const before = changes.cached(true);
    const after = await changes.review(true).catch(() => undefined);
    if (after !== undefined && after !== before) {
      broadcast("git", {});
    }
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      // Logged locally with the request path only; the response stays generic so an error message
      // carrying an absolute path never reaches the page.
      process.stderr.write(
        `wastech-mdlint-viewer: ${request.url ?? ""}: ${(error as Error).message}\n`,
      );
      if (!response.headersSent) {
        sendText(
          response,
          500,
          "The viewer could not build this page; see the terminal for details.",
        );
      } else {
        response.end();
      }
    });
  });

  bound.port = await listen(
    server,
    options.host,
    options.port,
    options.portExplicit,
  );
  // The first lint runs once the server is answering, so the address is printed without waiting for
  // it; pages opened before it finishes show their findings when the `diagnostics` event arrives.
  const initialLint = setImmediate(relint);

  return {
    url: `http://${displayHost(options.host)}:${bound.port}/`,
    documentCount: corpus.documents.size,
    notices,
    async close() {
      clearImmediate(initialLint);
      stopWatching();
      stopWatchingRefs();
      clearInterval(keepAlive);
      for (const client of eventClients) {
        client.end();
      }
      eventClients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

async function listen(
  server: Server,
  host: string,
  port: number,
  portExplicit: boolean,
): Promise<number> {
  for (let attempt = 0; ; attempt += 1) {
    const candidate = port === 0 ? 0 : port + attempt;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(candidate, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return (server.address() as AddressInfo).port;
    } catch (error) {
      const inUse = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (
        !inUse ||
        portExplicit ||
        port === 0 ||
        attempt + 1 >= PORT_ATTEMPTS
      ) {
        throw error;
      }
    }
  }
}

// The address to print. A wildcard bind is reachable at localhost too, and that is the address the
// Host check accepts by name.
function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return "localhost";
  }
  return host.includes(":") ? `[${host}]` : host;
}

function sendHtml(
  response: ServerResponse,
  status: number,
  html: string,
  headOnly = false,
): void {
  response.writeHead(status, {
    ...pageHeaders(),
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(headOnly ? undefined : html);
}

function sendJson(
  response: ServerResponse,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...pageHeaders(),
    ...headers,
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

// The server-rendered twin of the client's highlighting: matched words wrapped in <mark>, built as
// hast so the text around them is escaped.
function markTerms(text: string, terms: readonly string[]): ElementContent[] {
  const escaped = terms
    .filter((term) => term.length > 0)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) {
    return [{ type: "text", value: text }];
  }
  return text
    .split(new RegExp(`(${escaped.join("|")})`, "giu"))
    .map((part, index) =>
      index % 2 === 0 ? { type: "text", value: part } : h("mark", part),
    );
}

/**
 * The request body as text, or `undefined` once it passes `limit` bytes. The rest is drained rather
 * than kept, so the refusal can still be sent on the same connection.
 */
function readBody(
  request: IncomingMessage,
  limit: number,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    if (Number(request.headers["content-length"] ?? "0") > limit) {
      request.resume();
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) {
        chunks.push(chunk);
      }
    });
    request.on("end", () =>
      resolve(
        size > limit ? undefined : Buffer.concat(chunks).toString("utf8"),
      ),
    );
    request.on("error", reject);
  });
}

function sendText(
  response: ServerResponse,
  status: number,
  text: string,
): void {
  response.writeHead(status, {
    ...pageHeaders(),
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(text);
}
