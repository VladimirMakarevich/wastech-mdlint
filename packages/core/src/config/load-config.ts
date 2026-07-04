import { readFile, access } from "node:fs/promises";
import path from "node:path";

import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";

import { RuleResolutionError, type RuleRegistry } from "../engine/registry.js";
import { resolveCustomRule, type CustomRuleEntry } from "../engine/rules/custom.js";
import { ruleRegistry } from "../engine/rules/index.js";
import type { ResolvedSettings, Rule, SeverityOverride } from "../engine/types.js";
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
    settings: {}
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
  const location = issue.path.length === 0 ? "config" : `config.${issue.path.join(".")}`;
  return `- ${location}: ${issue.message}`;
}

function formatRuleResolutionError(index: number, error: RuleResolutionError): string[] {
  if (error.code === "UNKNOWN_RULE") {
    const suffix = error.suggestion === undefined ? "" : ` Did you mean "${error.suggestion}"?`;
    return [`- rules[${index}]: Unknown rule "${error.ruleName}".${suffix}`];
  }

  // Issue paths already carry their full location (e.g. ["options", "maxBytes"] or ["id"]).
  return (error.issues ?? [{ path: [], message: error.message }]).map((issue) => {
    const location = issue.path.length === 0 ? `rules[${index}]` : `rules[${index}].${issue.path.join(".")}`;
    return `- ${location}: ${issue.message}`;
  });
}

function parseJsoncConfig(text: string, configPath: string): unknown {
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join("; ");
    throw new ConfigError(`Failed to parse JSONC config at ${configPath}: ${details}`);
  }

  return value;
}

function resolveRules(config: LintConfig, registry: RuleRegistry): ConfiguredRule[] {
  const entries = config.rules ?? [];
  const resolved: ConfiguredRule[] = [];
  const errors: string[] = [];

  entries.forEach((entry, index) => {
    try {
      const rule =
        entry.rule === "custom"
          ? resolveCustomRule(entry as CustomRuleEntry, registry)
          : registry.resolveRule(entry.rule, (entry as { options?: unknown }).options);
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
    throw new ConfigError(`Invalid config:\n${errors.join("\n")}`);
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

  if (explicitConfigPath !== undefined && !(await fileExists(explicitConfigPath))) {
    throw new ConfigError(`Config file not found: ${explicitConfigPath}`);
  }

  const configPath = explicitConfigPath ?? (await findConfig(params.cwd));

  if (configPath === undefined) {
    return defaultConfiguration();
  }

  const text = await readFile(configPath, "utf8");
  const raw = parseJsoncConfig(text, configPath);

  const parsed = lintConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(formatRootIssue);
    throw new ConfigError(`Invalid config at ${configPath}:\n${lines.join("\n")}`);
  }

  const config = parsed.data;

  return {
    config,
    configPath,
    rules: resolveRules(config, registry),
    settings: (config.settings ?? {}) as ResolvedSettings
  };
}
