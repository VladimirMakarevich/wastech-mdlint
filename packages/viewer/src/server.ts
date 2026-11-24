import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import type { GitRepository } from "@wastech-mdlint/core";

import { ChangeTracker } from "./changes.js";
import { Corpus } from "./corpus.js";
import { Diagnostics } from "./diagnostics.js";
import { EventHub } from "./event-hub.js";
import { sendText } from "./http-send.js";
import { launchDetached, openRefusal, type Launcher } from "./open-file.js";
import { RenderCache } from "./render-cache.js";
import { SinceReview } from "./review-state.js";
import { ReviewStore } from "./review-store.js";
import { type BoundAddress, ViewerRouter } from "./router.js";
import { DocumentSearch } from "./search.js";
import {
  changeTokenFor,
  exposesAbsolutePaths,
  isLoopbackHost,
} from "./security.js";
import { defaultStateDir } from "./state-dir.js";
import { type ViewerContext, viewerContext } from "./viewer-context.js";
import { watchGitRefs, watchRepository } from "./watch.js";

// Starting the viewer: loading the corpus and its review, building the state every route shares,
// keeping it current as the repository changes, and listening. Every request goes to the router.

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
    watched: options.watch,
  });
  if (changes !== undefined) {
    // Computed once now: a `--base` that names nothing is reported where it was typed, and the first
    // visit to the Changes section finds the review ready.
    const first = await changes.review(true);
    if ("available" in first) {
      notices.push(`changes: ${first.message} ${first.hint}`);
    }
  }
  const ctx = createContext(options, corpus, changes);
  const bound: BoundAddress = { host: options.host, port: options.port };
  const router = new ViewerRouter(ctx, bound);
  const stopWatching = options.watch ? watchCorpus(ctx) : () => {};
  const stopWatchingRefs = options.watch ? watchRefs(ctx) : () => {};

  const server = createServer((request, response) => {
    router.handle(request, response).catch((error: unknown) => {
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
  const initialLint = setImmediate(() => {
    ctx.relint();
    if (options.watch && changes !== undefined) {
      changes.warm();
    }
  });

  return {
    url: `http://${displayHost(options.host)}:${bound.port}/`,
    documentCount: corpus.documents.size,
    notices,
    async close() {
      clearImmediate(initialLint);
      stopWatching();
      stopWatchingRefs();
      ctx.events.close();
      await changes?.idle();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}

// The state every route shares, built once for the whole run.
function createContext(
  options: ViewerOptions,
  corpus: Corpus,
  changes: ChangeTracker | undefined,
): ViewerContext {
  const git = changes?.git;
  const reviewStore = openReviewStore(options, git);
  return viewerContext({
    corpus,
    changes,
    git,
    reviewStore,
    sinceReviews:
      reviewStore === undefined ? undefined : new SinceReview(reviewStore),
    search: new DocumentSearch(),
    diagnostics: new Diagnostics(),
    renders: new RenderCache(corpus),
    events: new EventHub(),
    allowConfigWrites: options.allowConfigWrites === true,
    showAbsolutePaths: exposesAbsolutePaths(options.host),
    watch: options.watch,
    launch: options.launch ?? launchDetached,
    openRefused: openRefusal(options.host),
    changeToken: changeTokenFor(options.host),
  });
}

// Review marks, for a reader on this machine only: from another one, anyone who reached the port
// could record a review in this user's name and read which documents they have reviewed. Nothing
// is created here; the clone's folder appears with the first mark.
function openReviewStore(
  options: ViewerOptions,
  git: GitRepository | undefined,
): ReviewStore | undefined {
  if (git === undefined || !isLoopbackHost(options.host)) {
    return undefined;
  }
  return new ReviewStore({
    // A relative `--state-dir` is taken from where the viewer was started, as a shell user
    // expects, and fixed now, so it means the same folder for as long as the viewer runs.
    stateDir:
      options.stateDir === undefined
        ? defaultStateDir(process.platform, process.env, os.homedir())
        : path.resolve(options.stateDir),
    commonDir: git.commonDir,
    keyOf: (relPath) => git.topLevelPath(relPath),
  });
}

// Watches the work tree and applies what changed to the corpus. Changes are applied one batch at a
// time, in order: two overlapping updates could otherwise finish out of order and leave the older
// corpus in place.
function watchCorpus(ctx: ViewerContext): () => void {
  let updates = Promise.resolve();
  return watchRepository(ctx.corpus.rootDir, (paths) => {
    updates = updates
      .then(() => applyChanges(ctx, paths))
      .catch((error: unknown) => {
        process.stderr.write(
          `wastech-mdlint-viewer: could not apply changes: ${(error as Error).message}\n`,
        );
      });
  });
}

async function applyChanges(
  ctx: ViewerContext,
  paths: readonly string[],
): Promise<void> {
  const { corpus, changes, events } = ctx;
  const change = await corpus.applyChanges(paths);
  // Every reported path, even one that changed no document: a Markdown file outside the corpus, or a
  // document saved back to its committed text, changes the review all the same.
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
  if (change.changed.length === 0 && !change.structural) {
    return;
  }
  // Every open page answers this event — a document page by reloading and waiting for its review,
  // every other page's script by asking for the changes — so the review they will all join is
  // started before they ask, and its context after it.
  if (changes !== undefined && events.size > 0) {
    changes.warm();
  }
  events.broadcast("change", {
    paths: change.changed,
    structural: change.structural,
  });
  ctx.relint();
}

// A commit, a checkout, a reset or a fetch moves what the review compares without touching the work
// tree. The review is rebuilt as soon as git records the move, and open pages are told only when it
// really is a different review: a ref of some other branch moving changes nothing they show.
function watchRefs(ctx: ViewerContext): () => void {
  const { git, changes } = ctx;
  if (git === undefined || changes === undefined) {
    return () => {};
  }
  return watchGitRefs(git, {
    onMove: () => {
      void refreshAfterGitMove(ctx, changes);
    },
    onLost: () => {
      changes.watchLost();
    },
  });
}

async function refreshAfterGitMove(
  ctx: ViewerContext,
  changes: ChangeTracker,
): Promise<void> {
  if (await changes.gitMoved().catch(() => false)) {
    ctx.events.broadcast("git", {});
    changes.warm();
  }
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
