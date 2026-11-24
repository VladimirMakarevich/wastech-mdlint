import { realpathSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

// Which paths reach the corpus. Almost any can change what the viewer shows, and none can be judged
// by its name alone: a config passed with `--config` may be called anything; an image a document
// embeds is no Markdown file; and a folder moved, renamed or deleted arrives as one event for the
// folder, with nothing for the documents inside it. So the corpus decides, against core's scope.
// Only git's own database and installed dependencies are dropped here, unseen: neither is ever part
// of a corpus, and both churn by the thousand on an install or a checkout.
export function isRelevantChange(relPath: string): boolean {
  const segments = relPath.split("/");
  return !segments.includes("node_modules") && !segments.includes(".git");
}

/**
 * Whether a file git changed under its directory can move what a review compares: this work tree's
 * `HEAD` (a commit, a checkout, a reset), a ref (a branch moved, a fetch), or the packed refs a `gc`
 * or a fetch rewrites. Lock files are git's staging copies, renamed over the real file when done, and
 * the rename is what reports the change.
 */
export function isRefChange(relPath: string): boolean {
  if (relPath.endsWith(".lock")) {
    return false;
  }
  return (
    relPath === "HEAD" ||
    relPath === "packed-refs" ||
    relPath === "refs" ||
    relPath.startsWith("refs/")
  );
}

/**
 * Watch where git records what `HEAD` and the branches point at, and call `onMove` once per burst of
 * changes. Apart from the corpus watcher, which never looks inside `.git`: a commit, a `reset --soft`
 * or a fetch moves what a review compares without changing a single file of the work tree, and an
 * open Changes page should show that without waiting for the reader to reload it.
 *
 * `gitDir` holds this work tree's own `HEAD`; `commonDir` the refs every worktree of the clone shares.
 * They are the same directory in the main work tree. Only the top of each is watched, plus `refs/`
 * recursively, so the objects a commit or a fetch writes by the thousand never reach the callback.
 *
 * `onLost` is called when one of those watches could not start or has ended, after which a move
 * there would go unreported: the review is kept without asking git only while this watch holds.
 */
export function watchGitRefs(
  dirs: { gitDir: string; commonDir: string },
  handlers: { onMove: () => void; onLost: () => void },
  debounceMs = 150,
): () => void {
  let timer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = [];
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(handlers.onMove, debounceMs);
  };
  const watchDir = (
    dir: string,
    options: { recursive: boolean },
    toRelPath: (filename: string) => string,
  ) => {
    try {
      // The native realpath, for the reason `watchRepository` gives: libuv aborts the process when an
      // event's long path does not match a watched 8.3 short name.
      const watched = watch(
        realpathSync.native(dir),
        options,
        (_event, filename) => {
          if (filename !== null && isRefChange(toRelPath(filename))) {
            schedule();
          }
        },
      );
      watched.on("error", () => {
        // A ref folder git removed and recreated (a `pack-refs`) ends its watch. The review is then
        // checked against git on every request again, so a page is at worst stale until the next one.
        watched.close();
        handlers.onLost();
      });
      watchers.push(watched);
    } catch {
      // A folder that cannot be watched — gone, or not readable — reports nothing, so the review is
      // checked against git on every request.
      handlers.onLost();
    }
  };
  const posix = (filename: string) => filename.split(path.sep).join("/");
  watchDir(dirs.gitDir, { recursive: false }, posix);
  if (dirs.commonDir !== dirs.gitDir) {
    watchDir(dirs.commonDir, { recursive: false }, posix);
  }
  watchDir(
    path.join(dirs.commonDir, "refs"),
    { recursive: true },
    (filename) => `refs/${posix(filename)}`,
  );
  return () => {
    clearTimeout(timer);
    for (const watched of watchers) {
      watched.close();
    }
  };
}

/**
 * Watch the repository and report changed repo-relative POSIX paths in batches.
 *
 * Batched because one save is several events: editors write a temp file and rename it over the
 * original, and some platforms report both a `rename` and a `change`. Reading the file on the first
 * event can catch it half-written, or not there at all for an instant.
 *
 * Node's recursive `fs.watch` is used directly. On Windows and macOS it is one native subscription
 * for the whole tree; on Linux Node emulates it with one inotify watch per directory, which on a
 * repository with a large `node_modules` can exhaust the per-user watch limit — the known cost of
 * keeping this dependency-free.
 */
export function watchRepository(
  rootDir: string,
  onChange: (paths: string[]) => void,
  debounceMs = 120,
): () => void {
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher;
  try {
    // The native realpath, because on Windows it also expands 8.3 short names (`C:\Users\VLADIM~1`,
    // which is what `os.tmpdir()` and some shells hand out). libuv compares each event's long path
    // against the watched directory's path as given and aborts the whole process on a mismatch — a
    // C assertion no JavaScript handler can catch.
    const watchedDir = realpathSync.native(rootDir);
    watcher = watch(watchedDir, { recursive: true }, (_event, filename) => {
      // Some platforms omit the name for an event; there is nothing to map it to.
      if (filename === null) {
        return;
      }
      const relPath = filename.split(path.sep).join("/");
      if (!isRelevantChange(relPath)) {
        return;
      }
      pending.add(relPath);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const batch = [...pending];
        pending.clear();
        onChange(batch);
      }, debounceMs);
    });
  } catch (error) {
    process.stderr.write(
      `wastech-mdlint-viewer: watching for changes is unavailable (${(error as Error).message}); pages will not reload on their own.\n`,
    );
    return () => {};
  }
  watcher.on("error", (error) => {
    process.stderr.write(
      `wastech-mdlint-viewer: watching for changes stopped (${error.message}); pages will not reload on their own.\n`,
    );
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
