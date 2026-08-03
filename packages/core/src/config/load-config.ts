import { readFile, access } from "node:fs/promises";
import path from "node:path";

import {
  type ParseError,
  parse as parseJsonc,
  printParseErrorCode,
} from "jsonc-parser";
import { z } from "zod";

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
import { lintConfigSchema, type LintConfig } from "./config-schema.js";
import { findConfig } from "./find-config.js";

// A resolved rule paired with its config severity override. Final severity resolution and `"off"`
// filtering happen in the orchestrator (P2.05), so an "off" rule is still resolved here (its options
// are validated even while disabled).
export type ConfiguredRule = { rule: Rule; severity?: SeverityOverride };

export type LoadedConfiguration = {
  config: LintConfig;
  configPath?: string;
  rules: ConfiguredRule[];
  settings: ResolvedSettings;
};

// Zero-config default (P2.04 journal): lint every Markdown file with no rules — a clean pass. `init`
// (P6) writes a real ruleset.
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

function formatRootIssue(issue: z.core.$ZodIssue): string {
  const location =
    issue.path.length === 0 ? "config" : `config.${issue.path.join(".")}`;
  return `- ${location}: ${issue.message}`;
}

function formatRuleResolutionError(
  index: number,
  error: RuleResolutionError,
): string[] {
  if (error.code === "UNKNOWN_RULE") {
    const suffix =
      error.suggestion === undefined
        ? ""
        : ` Did you mean "${error.suggestion}"?`;
    return [`- rules[${index}]: Unknown rule "${error.ruleName}".${suffix}`];
  }

  // Issue paths already carry their full location (e.g. ["options", "maxBytes"] or ["id"]).
  return (error.issues ?? [{ path: [], message: error.message }]).map(
    (issue) => {
      const location =
        issue.path.length === 0
          ? `rules[${index}]`
          : `rules[${index}].${issue.path.join(".")}`;
      return `- ${location}: ${issue.message}`;
    },
  );
}

/**
 * The user-visible form of a config path, for the three `ConfigError` messages below.
 *
 * Those messages are printed verbatim by the CLI (`program.ts`) and returned verbatim by MCP
 * (`tool-response.ts`), so an interpolated absolute path leaks the checkout location and breaks the
 * POSIX-relative-path invariant every other report in the product honors (P11.10, audit M-6).
 *
 * The anchor is `params.cwd` because that is the only one core has — deliberately *not* a repo root,
 * which core never computes. Hosts pass the directory being analyzed (for `lint`/`graph`/`slice`/
 * `impact` that is the `[path]` operand, not the repository root), so a root config reached from
 * `lint docs` renders as `../wastech-mdlint.config.json`: relative and pointing at the file actually
 * read, which is the contract, rather than repo-root-anchored.
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

function resolveRules(
  config: LintConfig,
  registry: RuleRegistry,
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
      `Invalid config:\n${errors.join("\n")}`,
      errors[0],
    );
  }

  return resolved;
}

/**
 * Load and fully validate the v2 config (P2.04).
 *
 * Two-stage validation: the root shape is checked by `lintConfigSchema` (C7 diagnostics for unknown
 * keys), then each `rules[]` entry is resolved through the registry, which validates its options and
 * surfaces path-prefixed / did-you-mean errors. Returns the validated config, the resolved rules
 * (with severity overrides), and the resolved settings.
 */
export async function loadConfiguration(params: {
  cwd: string;
  explicitConfigPath?: string;
  registry?: RuleRegistry;
}): Promise<LoadedConfiguration> {
  const registry = params.registry ?? ruleRegistry;
  const explicitConfigPath = params.explicitConfigPath
    ? path.resolve(params.explicitConfigPath)
    : undefined;

  if (
    explicitConfigPath !== undefined &&
    !(await fileExists(explicitConfigPath))
  ) {
    throw new ConfigError(
      "CONFIG_NOT_FOUND",
      `Config file not found: ${displayConfigPath(params.cwd, explicitConfigPath)}`,
      "Check that configPath/cwd points to an existing wastech-mdlint.config.json, or omit it to use the zero-config default.",
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
    const lines = parsed.error.issues.map(formatRootIssue);
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
    rules: resolveRules(config, registry),
    settings: (config.settings ?? {}) as ResolvedSettings,
  };
}
