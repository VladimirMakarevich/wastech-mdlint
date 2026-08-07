import { readFile, access } from "node:fs/promises";
import path from "node:path";

import {
  type ParseError,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser";

import { normalizeRelativePath } from "../discovery/globs.js";
import { RuleResolutionError, type RuleRegistry } from "../engine/registry.js";
import {
  resolveCustomRule,
  type CustomRuleEntry,
} from "../engine/rules/custom.js";
import { ruleRegistry } from "../engine/rules/index.js";
import type {
  ResolvedSettings,
  Rule,
  SeverityOverride,
} from "../engine/types.js";
import { ConfigError } from "./config-error.js";
import { flattenConfigIssues, formatConfigIssue } from "./config-issues.js";
import { lintConfigSchema, type LintConfig } from "./config-schema.js";
import { findConfig } from "./find-config.js";

// A resolved rule paired with its config severity override. Final severity resolution and `"off"`
// filtering happen in the orchestrator, so an "off" rule is still resolved here (its options
// are validated even while disabled).
export type ConfiguredRule = { rule: Rule; severity?: SeverityOverride };

export type LoadedConfiguration = {
  config: LintConfig;
  configPath?: string;
  rules: ConfiguredRule[];
  settings: ResolvedSettings;
};

// Zero-config default: lint every Markdown file with no rules — a clean pass. `init`
// writes a real ruleset.
function defaultConfiguration(): LoadedConfiguration {
  return {
    config: { include: ["**/*.md"], rules: [] },
    rules: [],
    settings: {},
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Stage 2's issues, re-anchored onto the same absolute paths stage 1 uses so both stages render
// through `formatConfigIssue`. The rule-relative paths a `RuleResolutionError` carries
// (e.g. ["options", "maxBytes"] or ["id"]) become ["rules", index, …].
function formatRuleResolutionError(
  index: number,
  error: RuleResolutionError,
): string[] {
  if (error.code === "UNKNOWN_RULE") {
    const suffix =
      error.suggestion === undefined
        ? ""
        : ` Did you mean "${error.suggestion}"?`;
    return [
      formatConfigIssue({
        path: ["rules", index],
        message: `Unknown rule "${error.ruleName}".${suffix}`,
      }),
    ];
  }

  return (error.issues ?? [{ path: [], message: error.message }]).map((issue) =>
    formatConfigIssue({
      path: ["rules", index, ...issue.path],
      message: issue.message,
    }),
  );
}

/**
 * The user-visible form of a config path, for the three `ConfigError` messages below.
 *
 * Those messages are printed verbatim by the CLI (`program.ts`) and returned verbatim by MCP
 * (`tool-response.ts`), so an interpolated absolute path leaks the checkout location and breaks the
 * POSIX-relative-path invariant every other report in the product honors.
 *
 * The anchor is `params.cwd` because that is the only one core has — deliberately *not* a repo root,
 * which core never computes. Hosts pass the directory being analyzed (for `lint`/`graph`/`slice`/
 * `impact` that is the `[path]` operand, not the repository root), so a root config reached from
 * `lint docs` renders as `../wastech-mdlint.config.json`: relative and pointing at the file actually
 * read, which is the contract, rather than repo-root-anchored.
 *
 * An explicit config path is *resolved* against `params.cwd` too, so resolution and
 * rendering share one base. That is what makes `Config file not found:` name the path the
 * user actually typed: while the two disagreed, `lint proj --config cfg.json` reported
 * `../cfg.json` — a path nobody wrote, produced by relativizing a process-cwd lookup against the
 * lint root.
 */
function displayConfigPath(cwd: string, configPath: string): string {
  return normalizeRelativePath(path.relative(cwd, configPath));
}

function parseJsoncConfig(text: string, displayPath: string): unknown {
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map(
        (error) =>
          `${printParseErrorCode(error.error)} at offset ${error.offset}`,
      )
      .join("; ");
    throw new ConfigError(
      "CONFIG_INVALID",
      `Failed to parse JSONC config at ${displayPath}: ${details}`,
      details,
    );
  }

  return value;
}

// `displayPath` is threaded in rather than recomputed because every diagnostic must name the config
// file being read: an ancestor directory's config can govern a run, so "which file?" is a
// real question, and this stage used to answer it with a bare `Invalid config:`.
function resolveRules(
  config: LintConfig,
  registry: RuleRegistry,
  displayPath: string,
): ConfiguredRule[] {
  const entries = config.rules ?? [];
  const resolved: ConfiguredRule[] = [];
  const errors: string[] = [];

  entries.forEach((entry, index) => {
    try {
      const rule =
        entry.rule === "custom"
          ? resolveCustomRule(entry as CustomRuleEntry, registry)
          : registry.resolveRule(
              entry.rule,
              (entry as { options?: unknown }).options,
            );
      resolved.push({ rule, severity: entry.severity });
    } catch (error) {
      if (error instanceof RuleResolutionError) {
        errors.push(...formatRuleResolutionError(index, error));
        return;
      }
      throw error;
    }
  });

  if (errors.length > 0) {
    // hint = the first formatted issue (matches the task's "hint = failing path").
    throw new ConfigError(
      "CONFIG_INVALID",
      `Invalid config at ${displayPath}:\n${errors.join("\n")}`,
      errors[0],
    );
  }

  return resolved;
}

/**
 * Load and fully validate the v2 config.
 *
 * Two-stage validation: the root shape is checked by `lintConfigSchema` (diagnostics for unknown
 * keys), then each `rules[]` entry is resolved through the registry, which validates its options and
 * surfaces path-prefixed / did-you-mean errors. Returns the validated config, the resolved rules
 * (with severity overrides), and the resolved settings.
 *
 * **One base for `explicitConfigPath`: `params.cwd`** — the directory being analyzed,
 * which is `[path]` for `lint`/`graph`, the CLI's own cwd for `slice`/`impact`, `--cwd` for `compile`,
 * and the tool `cwd` for the five file-based MCP tools. It used to resolve against `process.cwd()`
 * instead, which silently diverged whenever a host analyzed a different directory than the shell was
 * standing in; `compile` and the MCP context helper each pre-resolved it locally to compensate, so
 * the same flag meant two things across the six call sites. Owning it here is what deletes both
 * workarounds: hosts now forward the caller's string untouched. Every host already passes an absolute
 * `cwd`, so nothing downstream of this line moves.
 */
export async function loadConfiguration(params: {
  cwd: string;
  explicitConfigPath?: string;
  registry?: RuleRegistry;
}): Promise<LoadedConfiguration> {
  const registry = params.registry ?? ruleRegistry;
  const explicitConfigPath = params.explicitConfigPath
    ? path.resolve(params.cwd, params.explicitConfigPath)
    : undefined;

  if (
    explicitConfigPath !== undefined &&
    !(await fileExists(explicitConfigPath))
  ) {
    throw new ConfigError(
      "CONFIG_NOT_FOUND",
      `Config file not found: ${displayConfigPath(params.cwd, explicitConfigPath)}`,
      // Names the base, because the message above names a *relative* path and a reader has no other
      // way to tell which directory it was looked for under.
      "Check that configPath/cwd points to an existing wastech-mdlint.config.json — a relative configPath is resolved against the directory being analyzed — or omit it to use the zero-config default.",
    );
  }

  const configPath = explicitConfigPath ?? (await findConfig(params.cwd));

  if (configPath === undefined) {
    return defaultConfiguration();
  }

  const displayPath = displayConfigPath(params.cwd, configPath);
  const text = await readFile(configPath, "utf8");
  const raw = parseJsoncConfig(text, displayPath);

  const parsed = lintConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = flattenConfigIssues(parsed.error.issues, raw).map(
      formatConfigIssue,
    );
    throw new ConfigError(
      "CONFIG_INVALID",
      `Invalid config at ${displayPath}:\n${lines.join("\n")}`,
      lines[0],
    );
  }

  const config = parsed.data;

  return {
    config,
    configPath,
    rules: resolveRules(config, registry, displayPath),
    settings: (config.settings ?? {}) as ResolvedSettings,
  };
}
