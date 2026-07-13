import path from "node:path";

import {
  loadConfiguration,
  loadContext,
  type GraphContext,
  type LoadedConfiguration
} from "@wastech-mdlint/core";

// Shared config/context helper (P7.01, task step 2). Every file-based tool resolves configuration —
// and, where it needs the corpus graph, context — through these two functions so no tool module
// re-derives the core calls the CLI's commands.ts already uses. Core stays the sole pipeline owner
// (core-hosts-the-pipeline): this is a thin renaming/defaulting wrapper over loadConfiguration /
// loadContext, never a second implementation.

// The MCP tool inputs, before mapping onto core's parameter names. `configPath` becomes core's
// `explicitConfigPath`; `cwd` maps straight through.
export type ToolFileInput = { cwd?: string; configPath?: string };

// The helper owns the `cwd ?? process.cwd()` default itself — a deliberate departure from the CLI's
// layering, where commander supplies the default. MCP tools have no argument-parsing layer, so
// centralizing the fallback here is the whole point of the shared helper (the alternative is every
// file-based tool module repeating the same line).
export async function resolveToolConfiguration(input: ToolFileInput): Promise<LoadedConfiguration> {
  const cwd = input.cwd ?? process.cwd();
  return loadConfiguration({ cwd, explicitConfigPath: resolveConfigPath(cwd, input.configPath) });
}

// A relative `configPath` must be resolved against the tool's own `cwd`, not the server process
// cwd: `loadConfiguration` resolves `explicitConfigPath` against `process.cwd()`, which silently
// diverges from the tool `cwd` when the two differ (the CLI's `compile` handler guards the same
// sharp edge). An absolute path is left untouched.
function resolveConfigPath(cwd: string, configPath?: string): string | undefined {
  return configPath === undefined ? undefined : path.resolve(cwd, configPath);
}

// A flattened intersection rather than a nested { config, context }: the graph tools (P7.03) want
// `graph`/`documents`/`settings` directly, with no extra destructuring step at each call site.
export type ResolvedToolContext = LoadedConfiguration & GraphContext;

export async function resolveToolContext(input: ToolFileInput): Promise<ResolvedToolContext> {
  const cwd = input.cwd ?? process.cwd();
  const loaded = await resolveToolConfiguration(input);
  const graphContext = await loadContext({
    cwd,
    config: loaded.config,
    settings: loaded.settings
  });

  // Neither function catches: errors now carry `code`/`hint` and propagate to the caller, which
  // recodes them per its own call-site semantics (see tool-response.ts and the per-tool modules).
  return { ...loaded, ...graphContext };
}
