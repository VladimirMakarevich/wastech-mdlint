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
