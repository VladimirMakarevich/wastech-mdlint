import { randomBytes } from "node:crypto";
import {
  chmod,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

// The single write path for every product file. A bare `writeFile` is
// truncate-then-write: a crash, an `ENOSPC`, or a permission failure partway through leaves the
// user's existing config / schema / Markdown truncated with no recovery route. Every write here
// lands in a temp file in the *target's own directory* first and is then `rename`d into place —
// atomic on a single filesystem, so an observer only ever sees the old bytes or the new ones.
//
// Boundaries this helper deliberately does not cross:
// - **No `fsync`.** Durability across a power loss would need an fsync of both the file and its
//   directory; the guarantee we owe is "a failed write never truncates an existing file", which
//   temp+rename already gives, and paying two fsyncs per document would tax `--fix` on a large
//   corpus for a property nothing in the product promises.
// - **No cross-filesystem fallback.** The temp always sits beside its target, so `rename` never
//   crosses a mount point and `EXDEV` is unreachable by construction (a shared temp dir would have
//   made it a real, and much harder, case).
// - **Directory creation is the caller's job**, matching the `writeFile` calls this replaces —
//   creating a missing parent here would silently widen what a "write" is allowed to do.

export type AtomicFileWrite = {
  // Absolute, platform-native path. Echoed back verbatim in the result so a host can map it to
  // whatever user-visible (repo-relative POSIX) form it already uses.
  path: string;
  content: string;
};

/**
 * Structured outcome of a multi-file atomic write. On failure the caller learns exactly which files
 * were committed and which were not, so it can print an honest partial-write summary instead of
 * leaving the user to guess at the state of their repository.
 *
 * `written`/`notWritten` keep the caller's commit order — it is a meaningful sequence (see
 * `writeFilesAtomic`), not an incidental one. A host that renders these sorts its own copy.
 */
export type AtomicWriteResult =
  | { ok: true; written: string[] }
  | {
      ok: false;
      written: string[];
      notWritten: string[];
      failedPath: string;
      // The errno (`EACCES`, `EISDIR`, `ENOSPC`, …) when the failure carries one. Reports should
      // prefer this over `error.message`: Node embeds two absolute, platform-native paths plus the
      // random temp name in a `rename` message, which is neither deterministic nor repo-relative.
      code?: string;
      error: unknown;
    };

// A temp file staged next to its target, awaiting the rename that commits it.
type StagedWrite = {
  // The path the rename commits to: the target's realpath when it already exists, so a symlinked
  // config is written *through* the link (what `writeFile` did for free) rather than replaced by a
  // regular file.
  target: string;
  tempPath: string;
  // The caller's original path string, for echoing back in the result.
  requestedPath: string;
};

function errnoCode(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as unknown as { code: string }).code;
  }
  return undefined;
}

async function stageWrite(write: AtomicFileWrite): Promise<StagedWrite> {
  const target = await realpath(write.path).catch(() =>
    path.resolve(write.path),
  );
  // Mode is read before the temp exists so a pre-existing `0600` config does not silently widen to
  // the default `0644` when the rename replaces it. Best effort: a target that does not exist yet
  // (or a host that rejects the chmod) simply keeps the default mode, which is what `writeFile`
  // would have produced anyway. Masked to the permission/setuid bits — POSIX leaves `chmod` with the
  // file-type bits of `st_mode` still set unspecified.
  const targetMode = await stat(target)
    .then((stats) => stats.mode & 0o7777)
    .catch(() => undefined);

  // Random suffix *after* the extension, and a leading dot: an orphaned temp left by a hard kill
  // must not match the `**/*.md` corpus glob (it would then be linted, and even fixed, as a
  // document), and `wx` makes a name collision an `EEXIST` failure rather than a shared temp two
  // concurrent runs could interleave in.
  const tempPath = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`,
  );
  await writeFile(tempPath, write.content, { encoding: "utf8", flag: "wx" });
  if (targetMode !== undefined) {
    await chmod(tempPath, targetMode).catch(() => undefined);
  }

  return { target, tempPath, requestedPath: write.path };
}

async function discardTemps(staged: readonly StagedWrite[]): Promise<void> {
  // A failed cleanup must not mask the write failure that triggered it: the temp is inert (hidden,
  // `.tmp`-suffixed, outside the corpus glob), so leaking one is strictly better than replacing the
  // reported error with an unlink error.
  await Promise.all(
    staged.map((entry) => unlink(entry.tempPath).catch(() => undefined)),
  );
}

/**
 * Write several files as close to atomically as a filesystem without transactions allows: every
 * temp file is staged *first*, and only then are they renamed into place in the caller's array
 * order, stopping at the first failure and discarding the temps that never committed.
 *
 * Two-phase staging is the point. An `ENOSPC` while staging the second file means the first one is
 * never renamed at all, so the common failure mode leaves the repository entirely untouched. Once
 * renaming starts a partial commit is unavoidable without a journal — hence the structured result:
 * order the writes so the most consistent prefix is the one that survives (`init` commits the
 * schema before the config, so a failure leaves the old config, and its old `$schema` pointer,
 * intact).
 */
export async function writeFilesAtomic(
  writes: readonly AtomicFileWrite[],
): Promise<AtomicWriteResult> {
  const staged: StagedWrite[] = [];

  for (const write of writes) {
    try {
      staged.push(await stageWrite(write));
    } catch (error) {
      await discardTemps(staged);
      return {
        ok: false,
        written: [],
        notWritten: writes.map((pending) => pending.path),
        failedPath: write.path,
        code: errnoCode(error),
        error,
      };
    }
  }

  const written: string[] = [];
  for (const [index, entry] of staged.entries()) {
    try {
      await rename(entry.tempPath, entry.target);
      written.push(entry.requestedPath);
    } catch (error) {
      // From `index` on: the failed rename left its own temp behind too.
      const remaining = staged.slice(index);
      await discardTemps(remaining);
      return {
        ok: false,
        written,
        notWritten: remaining.map((pending) => pending.requestedPath),
        failedPath: entry.requestedPath,
        code: errnoCode(error),
        error,
      };
    }
  }

  return { ok: true, written };
}

/**
 * Single-file atomic write for the call sites that have nothing partial to report — a failure is
 * simply thrown, preserving the original fs error (errno included) so the host maps it the same way
 * it mapped the bare `writeFile` this replaces.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
): Promise<void> {
  const result = await writeFilesAtomic([{ path: filePath, content }]);
  if (!result.ok) {
    throw result.error;
  }
}
