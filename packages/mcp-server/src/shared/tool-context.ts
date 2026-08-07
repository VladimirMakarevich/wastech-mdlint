import { stat } from "node:fs/promises";
import path from "node:path";

import {
  loadConfiguration,
  loadContext,
  type GraphContext,
  type LoadedConfiguration,
} from "@wastech-mdlint/core";

import { ToolInputError } from "./tool-input-error.js";

// Shared config/context helper. Every file-based tool resolves configuration —
// and, where it needs the corpus graph, context — through these two functions so no tool module
// re-derives the core calls the CLI's commands.ts already uses. Core stays the sole pipeline owner
// (core-hosts-the-pipeline): this is a thin renaming/defaulting wrapper over loadConfiguration /
// loadContext, never a second implementation.

// The MCP tool inputs, before mapping onto core's parameter names. `configPath` becomes core's
// `explicitConfigPath` — forwarded verbatim, since core resolves a relative one against the `cwd`
// validated below, the same base the CLI's handlers get; `cwd` maps straight through.
export type ToolFileInput = { cwd?: string; configPath?: string };

/**
 * The resolved `cwd` a call will use, computed without touching the filesystem.
 *
 * `cwd ?? process.cwd()` is a deliberate departure from the CLI's layering, where commander supplies
 * the default; MCP tools have no argument-parsing layer. It lives here alone so the callers below and
 * the tool modules that need the value read it back rather than recomputing it — four copies of the
 * same line was how `resolveToolCwd`'s guard came to be missed at three of them.
 *
 * Split out of `resolveToolCwd` so a tool's `catch` block can name the base its failure happened
 * under — `errorResult` renders an errno's path relative to it — even when the failure is the
 * `stat` inside `resolveToolCwd` itself, and so the requirement that `cwd ?? process.cwd()`
 * appears in exactly one place — keeps holding. Deliberately not async and deliberately not
 * validating: a `catch` handler cannot afford a second throw.
 */
export function toolCwdBase(input: ToolFileInput): string {
  return path.resolve(input.cwd ?? process.cwd());
}

/**
 * Resolve a tool's `cwd` and reject it if it is not a usable directory.
 *
 * Core deliberately does not do this: `loadDocuments` answers a root that does not stat as a
 * directory with a silent empty map, pinned as intentional by core's own test and relied on by other
 * callers. Left unguarded that reads to a client as `No problems found.` / an empty graph / `No match
 * for query` — a plausible answer to a different question, which is the CLI's own stated rationale
 * for its identical check ("indistinguishable from a clean repository").
 *
 * Runs on every call, including when `cwd` is omitted: one `stat` against a whole corpus walk is not
 * worth an `input.cwd !== undefined` branch, and a server whose own working directory has gone away
 * is a real failure worth naming.
 */
export async function resolveToolCwd(input: ToolFileInput): Promise<string> {
  const resolved = toolCwdBase(input);

  // Always present: the stdio error contract carries `hint` as the actionable half of `{ code,
  // message, hint }`, and there is exactly one useful remedy here.
  const hint =
    'Pass an absolute path to an existing directory, or omit "cwd" to analyze the server\'s working directory.';

  // The message names the RESOLVED absolute path, unlike the CLI's repo-relative rendering. The CLI
  // has a known-good cwd to anchor against; here the cwd *is* the anchor and it is the broken thing,
  // so a relative form would have nothing to mean. The value is derived from caller input and is
  // exactly what was stat'ed, so it exposes no unrelated host state.
  const stats = await stat(resolved).catch((error: unknown) => {
    // Mirrors the CLI's `resolveDirectoryArgument`: only these two errnos mean "no usable directory
    // here". Anything else (EACCES, ELOOP, …) is a *different* operational failure and must not be
    // misreported as bad input, so it rethrows — and it reaches `errorResult`'s errno
    // classifier, which answers `OPERATIONAL_ERROR` naming the errno (or a sanitized INTERNAL_ERROR
    // when the errno names no path) instead of the flat INTERNAL_ERROR it used to get.
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      throw new ToolInputError(`cwd does not exist: ${resolved}`, hint);
    }
    if (code === "ENOTDIR") {
      throw new ToolInputError(`cwd is not a directory: ${resolved}`, hint);
    }
    throw error;
  });

  if (!stats.isDirectory()) {
    throw new ToolInputError(`cwd is not a directory: ${resolved}`, hint);
  }

  return resolved;
}

// The resolved, validated `cwd` travels with the loaded configuration so callers that need it (the
// `lintFiles` and `compileContext` calls) read it back instead of recomputing the default. Neither
// `LoadedConfiguration` nor `GraphContext` carries a `cwd` key, so this widening collides with
// nothing.
export type ResolvedToolConfiguration = LoadedConfiguration & { cwd: string };

export async function resolveToolConfiguration(
  input: ToolFileInput,
): Promise<ResolvedToolConfiguration> {
  // Before `loadConfiguration`, not after: a bad `cwd` is the more fundamental of the two failures,
  // and checking it second would report `CONFIG_NOT_FOUND` for a `configPath` under a root that does
  // not exist — naming the wrong cause.
  const cwd = await resolveToolCwd(input);
  const loaded = await loadConfiguration({
    cwd,
    explicitConfigPath: input.configPath,
  });
  return { ...loaded, cwd };
}

// A flattened intersection rather than a nested { config, context }: the graph tools want
// `graph`/`documents`/`settings` directly, with no extra destructuring step at each call site.
export type ResolvedToolContext = ResolvedToolConfiguration & GraphContext;

export async function resolveToolContext(
  input: ToolFileInput,
): Promise<ResolvedToolContext> {
  const loaded = await resolveToolConfiguration(input);
  const graphContext = await loadContext({
    cwd: loaded.cwd,
    config: loaded.config,
    settings: loaded.settings,
  });

  // Neither function catches: errors now carry `code`/`hint` and propagate to the caller, which
  // recodes them per its own call-site semantics (see tool-response.ts and the per-tool modules).
  return { ...loaded, ...graphContext };
}
