import { Worker } from "node:worker_threads";

import type { LintMessage, ParsedDocument } from "@wastech-mdlint/core";

// Lints a candidate config off the server's thread, and gives up on it after a time limit.
//
// The config page previews a change while the reader types, so a custom rule's pattern is linted
// half-written. A pattern that backtracks catastrophically never returns, and JavaScript cannot
// interrupt a running regular expression: on the server's own thread it froze every page, the
// live-reload stream, and Ctrl+C, whose handler is JavaScript too. On a worker thread the server
// stays free, and terminating the thread is the one way to stop the match.

/** What the worker is asked: one preview's lint. */
export type CandidateLintJob = {
  rootDir: string;
  configPath: string;
  // The candidate's text, already validated by the server.
  text: string;
  // Whether the candidate selects the same documents as the loaded config, so the worker lints the
  // documents the server sent rather than discovering and parsing its scope again.
  sameScope: boolean;
  // Sent only when the corpus has replaced its documents since the last job.
  documents?: ReadonlyMap<string, ParsedDocument>;
};

export type CandidateLintAnswer =
  | { ok: true; messages: LintMessage[]; documentCount: number }
  | { ok: false; reason: "timeout" | "failed" | "abandoned"; message: string };

// Long enough for a rules-only change over a few thousand documents, or a new scope's discovery and
// parse, and short enough that a reader whose half-typed pattern runs away is told so promptly.
export const CANDIDATE_LINT_TIMEOUT_MS = 15_000;

// The built worker module beside this one's built form. Spelled through `dist` so it resolves from
// the source tree too, where the test suite imports this file: there is no runnable `.js` under
// `src`, and a worker thread loads its module with Node's own loader, not the test runner's.
const WORKER_URL = new URL("../dist/candidate-lint-worker.js", import.meta.url);

export class CandidateLinter {
  private worker: Worker | undefined;
  // The document map the current worker holds, by identity: the corpus replaces the map whenever a
  // document changes, so a different object is exactly "send them again".
  private sent: ReadonlyMap<string, ParsedDocument> | undefined;
  // One job at a time: the worker answers in order, and a job that times out must take only its own
  // worker down.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly timeoutMs = CANDIDATE_LINT_TIMEOUT_MS,
    private readonly workerUrl: URL = WORKER_URL,
  ) {}

  /**
   * Lints `job` once the jobs before it are done. A job whose `signal` has aborted by then - the
   * page asked for a newer preview and dropped this request - is not run: the editor aborts the
   * older preview on every change, and running each in turn would put the newest one behind them
   * all, up to the time limit apiece when the reader is typing into a pattern that runs away.
   */
  lint(
    job: Omit<CandidateLintJob, "documents"> & {
      documents: ReadonlyMap<string, ParsedDocument>;
    },
    signal?: AbortSignal,
  ): Promise<CandidateLintAnswer> {
    const run = this.queue.then(() =>
      signal?.aborted === true
        ? {
            ok: false as const,
            reason: "abandoned" as const,
            message: "The preview was no longer wanted.",
          }
        : this.run(job),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Stops the worker, if one is running; the next job starts a new one. */
  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    this.sent = undefined;
    await worker?.terminate();
  }

  private run(
    job: Omit<CandidateLintJob, "documents"> & {
      documents: ReadonlyMap<string, ParsedDocument>;
    },
  ): Promise<CandidateLintAnswer> {
    if (this.worker === undefined) {
      // Without the parent's Node flags, which a worker inherits by default: a flag that only means
      // something for the main entry (`--input-type`, a test runner's loader hooks) makes the
      // worker's own module fail to start.
      this.worker = new Worker(this.workerUrl, { execArgv: [] });
      // Never what keeps the viewer's process alive: a missed `close` must not stop it exiting.
      this.worker.unref();
      this.sent = undefined;
    }
    const worker = this.worker;
    const documentsSent = this.sent === job.documents;
    const message: CandidateLintJob = {
      rootDir: job.rootDir,
      configPath: job.configPath,
      text: job.text,
      sameScope: job.sameScope,
      ...(documentsSent ? {} : { documents: job.documents }),
    };

    return new Promise<CandidateLintAnswer>((resolve) => {
      const settle = (answer: CandidateLintAnswer, stop: boolean) => {
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
        if (stop && this.worker === worker) {
          this.worker = undefined;
          this.sent = undefined;
          void worker.terminate();
        }
        resolve(answer);
      };
      const onMessage = (answer: CandidateLintAnswer) => {
        settle(answer, false);
      };
      const onError = (error: Error) => {
        settle({ ok: false, reason: "failed", message: error.message }, true);
      };
      const onExit = () => {
        settle(
          {
            ok: false,
            reason: "failed",
            message: "The preview's lint stopped before it answered.",
          },
          true,
        );
      };
      const timer = setTimeout(() => {
        settle(
          {
            ok: false,
            reason: "timeout",
            message: `The preview's lint did not finish within ${String(this.timeoutMs / 1000)} seconds and was stopped. A custom rule's pattern that backtracks without end, such as (a+)+$, does this.`,
          },
          true,
        );
      }, this.timeoutMs);
      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.on("exit", onExit);
      try {
        worker.postMessage(message);
      } catch (error) {
        // Nothing reached the worker, so what it holds is unknown: it is stopped like a failed one,
        // rather than left with a timer that would later stop it under another job.
        settle(
          { ok: false, reason: "failed", message: (error as Error).message },
          true,
        );
        return;
      }
      // Only once the worker has them: a later job then sends nothing it already holds.
      this.sent = job.documents;
    });
  }
}
