import { realpathSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";

import { CONFIG_FILE_NAME } from "@wastech-mdlint/core";

// Only these can change what the viewer shows: a Markdown file's text, or the config and
// `.gitignore` files that decide which Markdown files are in the corpus. Everything else is ignored
// at the event, so a build writing thousands of files into `dist/` never wakes the corpus.
export function isRelevantChange(relPath: string): boolean {
  const segments = relPath.split("/");
  if (segments.includes("node_modules") || segments.includes(".git")) {
    return false;
  }
  const name = segments[segments.length - 1] ?? "";
  return (
    /\.mdx?$/i.test(name) || name === CONFIG_FILE_NAME || name === ".gitignore"
  );
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
