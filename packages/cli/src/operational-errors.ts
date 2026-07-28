import path from "node:path";

import { normalizeRelativePath } from "@wastech-mdlint/core";

// Rendering for operational (exit 2) failures (P11.10, audit M-6). Pure formatters only, and
// deliberately no import from `commands.js`: that module imports *from* here for its write handlers,
// so a back-import would close a cycle.
//
// The shared constraint behind all three functions: a Node fs error's `message` embeds absolute,
// platform-native paths (and, for a `rename` through `writeFileAtomic`, the random temp file name
// too). Printing that verbatim leaks the checkout location into CLI stderr and breaks the
// relative-POSIX-path convention every other user-visible path in the product follows, so such a
// message is replaced by the errno `code` plus a path normalized here. Only *such* a message: an
// error that names no path has none to leak, and dropping its text costs the caller the diagnosis
// (see `formatOperationalError`).

/**
 * A host path rendered the way the rest of the product renders paths: relative to this run's `cwd`
 * and POSIX-separated, so the same failure reads identically on Windows, macOS, and Linux.
 *
 * `"."` is the answer when the two paths are the same directory — `path.relative` returns `""`
 * there, which would otherwise render as a blank in the middle of a sentence.
 *
 * Not every host path *has* a relative form: a target outside `cwd` renders with `../` segments, and
 * on Windows one on another drive (`C:\repo` vs `D:\out`) has none at all, so `path.relative` hands
 * back the absolute target. Both are passed through rather than papered over — the message must name
 * the path actually touched — which is why the docs promise relative-where-possible, not
 * relative-always (`docs/guide/cli.md` §Exit codes).
 */
export function toRepoRelativePosix(cwd: string, absolutePath: string): string {
  const relative = normalizeRelativePath(path.relative(cwd, absolutePath));
  return relative === "" ? "." : relative;
}

// Node's errno exceptions carry the failing syscall's code and, for single-path operations, the path
// it was given. Structural checks rather than a cast: the value reaching the CLI catch-all is
// `unknown`, and a non-errno `Error` must still fall through to its own message.
//
// Deliberately a CLI-local copy of the identical guard in core's `atomic-write.ts` rather than a
// shared export: core's feeds a structured `AtomicWriteResult.code` that hosts then render however
// they like, while this one exists only to render host stderr. Exporting core's would widen core's
// public API for six lines and couple two unrelated consumers of the same Node detail.
function errnoCode(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as unknown as { code: string }).code;
  }
  return undefined;
}

function errnoPath(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    typeof (error as { path?: unknown }).path === "string"
  ) {
    return (error as unknown as { path: string }).path;
  }
  return undefined;
}

/**
 * The catch-all renderer for a failure no command handler converted into a `CliUsageError`.
 *
 * Only an errno that names its own `path` gets rewritten, as its code plus a relative path: that is
 * precisely the message shape that embeds an absolute host path (see the module note). Everything
 * else keeps `error.message`, because for the backstop that message is the *only* diagnostic content
 * there is. Substituting a bare `code` for it would turn a Node programmer error into an
 * unactionable `Operational error: ERR_INVALID_ARG_TYPE`, and a path-less errno message
 * (`ENOSPC: no space left on device, write`) has no path to leak in the first place.
 */
export function formatOperationalError(error: unknown, cwd: string): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const failingPath = errnoPath(error);
  const code = errnoCode(error);
  if (failingPath === undefined || code === undefined) {
    return error.message;
  }

  return `${code} on ${toRepoRelativePosix(cwd, failingPath)}`;
}

/**
 * A failed product-file write, named by the path the caller already computed for its *success*
 * message rather than by the errno's own path — under `writeFileAtomic` the latter is the staged
 * temp file, which is meaningless to the user.
 */
export function formatWriteFailure(
  relativePath: string,
  error: unknown,
): string {
  const code = errnoCode(error);
  const reason = code === undefined ? "" : ` (${code})`;
  return `Could not write ${relativePath}${reason}.`;
}
