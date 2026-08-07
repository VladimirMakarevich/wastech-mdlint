import path from "node:path";

import {
  normalizeRelativePath,
  type StructuredErrorInfo,
} from "@wastech-mdlint/core";

// Classify a raw Node errno into the shared `OPERATIONAL_ERROR` payload. The code lives
// in core's closed taxonomy; the mapping lives here because deciding that a throwable is an
// environment failure rather than an internal one is a host-boundary judgement — the same split
// `INVALID_INPUT`/`ToolInputError` already uses. Core's `isStructuredError` is deliberately NOT
// widened to duck-type errnos (its comment says why), so this is the only door such an error has.
//
// Deliberately a third host-local copy of the two-field errno guard rather than a promoted core
// export, matching the argument the CLI's copy already makes in place: core's feeds a structured
// `AtomicWriteResult.code`, the CLI's renders stderr, and this one produces a taxonomy payload.
// Three unrelated consumers of the same Node detail, six lines each.
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
 * The `OPERATIONAL_ERROR` payload for an errno that names a path inside `cwd`, or `undefined` for
 * anything the caller should keep treating as a sanitized `INTERNAL_ERROR`.
 *
 * **Both fields are required.** An errno with no `path` (`ENOSPC: no space left on device, write`)
 * has nothing to name, and its own message is the only diagnostic there is — but that message is
 * exactly the unvetted text `INTERNAL_ERROR` exists to withhold, so it falls through rather than
 * being surfaced. The CLI can afford the opposite choice because its output is a terminal, not a
 * machine contract.
 *
 * **Containment is stricter than the CLI's.** A `../` chain or (across Windows drives) an outright
 * absolute path is refused here instead of rendered, because "no payload names a host path *outside*
 * the analyzed directory" is the property MCP's sanitization exists for, and it outweighs naming a
 * file outside the analyzed root. That directory itself is the one absolute path any payload carries,
 * and only in the `INVALID_INPUT` message (`tool-context.ts`), where the value is the caller's
 * own `cwd` and is the broken thing being reported. The CLI keeps the `../` form on purpose (see
 * `operational-errors.ts`); the two hosts differ here by decision, which is why this is not that
 * function.
 *
 * **No `hint`.** An errno-specific remedy would be guesswork (`EACCES` on a config is a permissions
 * fix; `EISDIR` is a wrong-path fix), and the message already carries the whole actionable content.
 */
export function toOperationalErrorInfo(
  error: unknown,
  cwd: string,
): StructuredErrorInfo | undefined {
  const code = errnoCode(error);
  const failingPath = errnoPath(error);
  if (code === undefined || failingPath === undefined) {
    return undefined;
  }

  const relative = path.relative(cwd, failingPath);
  // Compared by first *segment* rather than by string prefix, so `..\out` and `../out` both match
  // while a sibling directory named `..foo` does not. `path.relative` answers an already-absolute
  // path when no relative form exists at all (two Windows drives), which the first test catches.
  if (path.isAbsolute(relative) || relative.split(path.sep)[0] === "..") {
    return undefined;
  }

  // Byte-identical to the CLI's stderr line (`formatOperationalError` behind its `Operational error:`
  // prefix), so "both hosts name the errno and the path" is literally true and a user comparing the
  // two surfaces sees one sentence. `""` — the failing path being `cwd` itself — renders as `.`.
  const rendered = normalizeRelativePath(relative);
  return {
    code: "OPERATIONAL_ERROR",
    message: `Operational error: ${code} on ${rendered === "" ? "." : rendered}`,
  };
}
