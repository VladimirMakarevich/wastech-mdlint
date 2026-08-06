import { stat } from "node:fs/promises";
import path from "node:path";

import {
  loadConfiguration,
  loadContext,
  type GraphContext,
  type LoadedConfiguration,
} from "@wastech-mdlint/core";

import { ToolInputError } from "./tool-input-error.js";

// Shared config/context helper (P7.01, task step 2). Every file-based tool resolves configuration —
// and, where it needs the corpus graph, context — through these two functions so no tool module
// re-derives the core calls the CLI's commands.ts already uses. Core stays the sole pipeline owner
// (core-hosts-the-pipeline): this is a thin renaming/defaulting wrapper over loadConfiguration /
// loadContext, never a second implementation.

// The MCP tool inputs, before mapping onto core's parameter names. `configPath` becomes core's
// `explicitConfigPath`; `cwd` maps straight through.
export type ToolFileInput = { cwd?: string; configPath?: string };

/**
 * Resolve a tool's `cwd` and reject it if it is not a usable directory — the single entry point for
 * both jobs (P14.01).
 *
 * **The default.** `cwd ?? process.cwd()` is a deliberate departure from the CLI's layering, where
 * commander supplies the default; MCP tools have no argument-parsing layer. It lives here alone so
 * the two callers below and the two tool modules that need the value read it back rather than
 * recomputing it — four copies of the same line was how the guard below came to be missed at three
 * of them.
 *
 * **The guard.** Core deliberately does not do this: `loadDocuments` answers a root that does not
 * stat as a directory with a silent empty map, pinned as intentional by core's own test and relied on
 * by other callers. Left unguarded that reads to a client as `No problems found.` / an empty graph /
 * `No match for query` — a plausible answer to a different question, which is the CLI's own stated
 * rationale for its identical check ("indistinguishable from a clean repository").
 *
 * Runs on every call, including when `cwd` is omitted: one `stat` against a whole corpus walk is not
 * worth an `input.cwd !== undefined` branch, and a server whose own working directory has gone away
 * is a real failure worth naming.
 */
export async function resolveToolCwd(input: ToolFileInput): Promise<string> {
  const resolved = path.resolve(input.cwd ?? process.cwd());

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
    // misreported as bad input, so it rethrows and reaches `errorResult`'s sanitized INTERNAL_ERROR.
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
    explicitConfigPath: resolveConfigPath(cwd, input.configPath),
  });
  return { ...loaded, cwd };
}

// A relative `configPath` must be resolved against the tool's own `cwd`, not the server process
// cwd: `loadConfiguration` resolves `explicitConfigPath` against `process.cwd()`, which silently
// diverges from the tool `cwd` when the two differ (the CLI's `compile` handler guards the same
// sharp edge). An absolute path is left untouched.
function resolveConfigPath(
  cwd: string,
  configPath?: string,
): string | undefined {
  return configPath === undefined ? undefined : path.resolve(cwd, configPath);
}

// A flattened intersection rather than a nested { config, context }: the graph tools (P7.03) want
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
