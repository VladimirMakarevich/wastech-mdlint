import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { sendEcharts, sendMermaid, sendPackageAsset } from "./asset-routes.js";
import { ChangeTracker, diffViewOf } from "./changes.js";
import { changesRoutes } from "./changes-routes.js";
import { configRoutes } from "./config-routes.js";
import { Corpus } from "./corpus.js";
import { corpusRoutes } from "./corpus-routes.js";
import { Diagnostics } from "./diagnostics.js";
import { documentRoutes } from "./document-routes.js";
import { EventHub } from "./event-hub.js";
import { readBody, sendJson, sendText } from "./http-send.js";
import { launchDetached, openRefusal, type Launcher } from "./open-file.js";
import { RenderCache } from "./render-cache.js";
import { decodeRequestPath } from "./request-path.js";
import { baselineOf, SinceReview } from "./review-state.js";
import { ReviewStore } from "./review-store.js";
import { DocumentSearch } from "./search.js";
import {
  changeRequestProblem,
  exposesAbsolutePaths,
  isAllowedHostHeader,
  isForeignRequest,
  isLoopbackHost,
} from "./security.js";
import { defaultStateDir } from "./state-dir.js";
import { viewerContext } from "./viewer-context.js";
import { watchGitRefs, watchRepository } from "./watch.js";

// Starting the viewer, and the one place every request passes through: the checks that apply to all
// of them, then the route that answers. What each route does lives with its group — a document's
// page, the Changes page and review marks, the config page, the corpus-wide pages, the shipped
// assets — over one shared `ViewerContext`, so every route reads the same corpus and review.

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

export async function startViewer(
  options: ViewerOptions,
): Promise<RunningViewer> {
  const corpus = await Corpus.load({
    cwd: options.cwd,
    configPath: options.configPath,
  });
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
  const events = new EventHub();
  const ctx = viewerContext({
    corpus,
    changes,
    git,
    reviewStore,
    sinceReviews:
      reviewStore === undefined ? undefined : new SinceReview(reviewStore),
    search: new DocumentSearch(),
    diagnostics: new Diagnostics(),
    renders: new RenderCache(corpus),
    events,
    allowConfigWrites: options.allowConfigWrites === true,
    showAbsolutePaths: exposesAbsolutePaths(options.host),
    watch: options.watch,
    launch: options.launch ?? launchDetached,
    openRefused: openRefusal(options.host),
    changeToken: randomBytes(32).toString("hex"),
  });
  const documents = documentRoutes(ctx);
  const review = changesRoutes(ctx);
  const config = configRoutes(ctx);
  const pages = corpusRoutes(ctx);
  const bound = { host: options.host, port: options.port };

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
      documents.redirectToIndex(response);
    } else if (target === "/search") {
      pages.sendSearchPage(request, response, params.get("q") ?? "");
    } else if (target === "/api/search") {
      pages.sendSearchData(response, params.get("q") ?? "");
    } else if (target === "/graph") {
      await pages.sendGraphPage(request, response, params);
    } else if (target === "/api/graph") {
      await pages.sendGraphData(response, params);
    } else if (target === "/api/neighbors") {
      await pages.sendNeighbors(response, params);
    } else if (target === "/changes") {
      await review.sendChangesPage(request, response, params);
    } else if (target === "/api/changes") {
      await review.sendChangesData(response, params);
    } else if (target === "/api/history") {
      await documents.sendHistory(response, params);
    } else if (target === "/api/changes/diff") {
      await review.sendChangeDiff(response, params);
    } else if (target === "/dashboard") {
      await pages.sendDashboardPage(request, response, params);
    } else if (target === "/api/dashboard") {
      await pages.sendDashboardData(response, params);
    } else if (target === "/config") {
      await config.sendConfigPage(request, response);
    } else if (target === "/api/config") {
      await config.sendConfigData(response);
    } else if (target === "/api/diagnostics") {
      pages.sendDiagnostics(response, params);
    } else if (target === "/api/prompts") {
      await pages.sendPrompts(response, params);
    } else if (target === "/events") {
      events.open(request, response);
    } else if (target === "/favicon.ico") {
      await sendPackageAsset(request, response, "favicon.ico");
    } else if (target.startsWith("/assets/")) {
      await sendPackageAsset(
        request,
        response,
        target.slice("/assets/".length),
      );
    } else if (target === "/vendor/echarts/echarts.esm.min.mjs") {
      await sendEcharts(request, response);
    } else if (target.startsWith("/vendor/mermaid/")) {
      await sendMermaid(
        request,
        response,
        target.slice("/vendor/mermaid/".length),
      );
    } else if (target.startsWith("/doc/")) {
      await documents.sendDocument(
        request,
        response,
        decodeRequestPath(target.slice("/doc/".length)),
        diffViewOf(params),
        baselineOf(params),
        params.get("blame") === "1",
      );
    } else if (target.startsWith("/file/")) {
      await documents.sendLinkedFile(
        request,
        response,
        decodeRequestPath(target.slice("/file/".length)),
      );
    } else {
      ctx.sendNotFound(request, response, "There is no page at this address.");
    }
  }

  // A request with a body: refused before its body is read unless it came from a page this server
  // rendered, then parsed once here, so every route that takes a body is guarded the same way.
  async function handleChange(
    request: IncomingMessage,
    response: ServerResponse,
    target: string,
  ): Promise<void> {
    const problem = changeRequestProblem(
      request.headers as Parameters<typeof changeRequestProblem>[0],
      ctx.changeToken,
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
      await config.openConfig(response, json);
    } else if (target === "/api/review/section") {
      await review.changeSectionMark(response, json);
    } else if (
      target === "/api/review/mark" ||
      target === "/api/review/reset"
    ) {
      await review.changeMarks(response, target, json);
    } else {
      await config.changeConfig(response, target, json);
    }
  }

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
              ctx.renders.clear();
            }
            for (const changedPath of change.changed) {
              const document = corpus.documents.get(changedPath);
              if (document !== undefined) {
                ctx.renders.forget(document);
              }
            }
            if (change.changed.length > 0 || change.structural) {
              // Every open page answers this event — a document page by reloading and waiting for
              // its review, every other page's script by asking for the changes — so the review
              // they will all join is started before they ask.
              if (changes !== undefined && events.size > 0) {
                void changes.review(true).catch(() => undefined);
              }
              events.broadcast("change", {
                paths: change.changed,
                structural: change.structural,
              });
              ctx.relint();
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
      events.broadcast("git", {});
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
  const initialLint = setImmediate(() => ctx.relint());

  return {
    url: `http://${displayHost(options.host)}:${bound.port}/`,
    documentCount: corpus.documents.size,
    notices,
    async close() {
      clearImmediate(initialLint);
      stopWatching();
      stopWatchingRefs();
      events.close();
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
