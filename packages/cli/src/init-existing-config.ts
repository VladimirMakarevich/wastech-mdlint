import { readFile } from "node:fs/promises";
import path from "node:path";

import { type ParseError, parse as parseJsonc } from "jsonc-parser";

import {
  canonicalizeRuleId,
  containsJsoncComments,
  identifyExistingRule,
  loadConfiguration,
  type InferenceScope,
  type InferredRule,
  type LoadedConfiguration,
} from "@wastech-mdlint/core";

import type { ExistingConfigAction } from "./init-types.js";

// Everything `init` reads from a config that already exists: the parsed snapshot a merge diffs and
// rebuilds from, the loader's verdict on whether it is valid at all, and the scope a merge keeps.

/**
 * Canonical-id set difference: which inferred rules are not already present in an existing
 * config's `rules[]`. Preview-only — the actual additive/existing-wins merge write happens later.
 */
export function diffAgainstExistingRuleIds(
  existingIds: string[],
  rules: InferredRule[],
): { newRules: InferredRule[] } {
  const canonicalExisting = new Set(
    existingIds.map((id) => canonicalizeRuleId(id)),
  );
  const newRules = rules.filter(
    (rule) => !canonicalExisting.has(canonicalizeRuleId(rule.rule)),
  );
  return { newRules };
}

export type ParsedExistingConfig = {
  // The parsed JSONC root object, or undefined when the file could not be read or did not parse to
  // an object. `parsed` mirrors that: false ⇒ `raw` is undefined.
  raw: Record<string, unknown> | undefined;
  parsed: boolean;
  // Whether the file on disk carries JSONC comments. A `merge` rebuilds the config from `raw`, so
  // those comments do not survive it — this is what lets the summaries say so instead of
  // presenting an additive merge as entirely non-destructive. False for an unreadable file: there is
  // nothing known to lose, and that case already aborts the merge.
  hasComments: boolean;
};

/**
 * Shared JSONC read of an existing config's root object. Deliberately not a full `lintConfigSchema`
 * validation (that belongs to `loadConfiguration`) — a committed config that doesn't fully validate
 * must still be diffable for the merge preview, and a malformed file must degrade to `parsed: false`
 * (so callers can warn/abort) rather than crash `init`.
 */
async function parseExistingConfigFile(
  cwd: string,
  configPath: string,
): Promise<ParsedExistingConfig> {
  const absoluteConfigPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(cwd, configPath);

  try {
    const text = await readFile(absoluteConfigPath, "utf8");
    const errors: ParseError[] = [];
    const raw: unknown = parseJsonc(text, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    });

    if (errors.length > 0 || raw === null || typeof raw !== "object") {
      return { raw: undefined, parsed: false, hasComments: false };
    }
    return {
      raw: raw as Record<string, unknown>,
      parsed: true,
      hasComments: containsJsoncComments(text),
    };
  } catch {
    return { raw: undefined, parsed: false, hasComments: false };
  }
}

/**
 * Derives the canonicalized `rules[].rule` ids from an already-parsed config root, and whether the
 * config can be merged additively (`mergeable`). A present-but-non-array `rules` key cannot be
 * merged, so it degrades the same way an unparsable file does. Pure over one parsed snapshot, so the
 * diff preview and the write path can share a single read without re-parsing.
 */
export function extractExistingRuleIds(
  raw: Record<string, unknown> | undefined,
): {
  ruleIds: string[];
  mergeable: boolean;
} {
  if (raw === undefined) {
    return { ruleIds: [], mergeable: false };
  }

  const rulesField = raw.rules;
  if (rulesField === undefined) {
    // Successfully parsed, and the key is genuinely absent — zero existing ids is a known fact
    // here, not a degraded guess.
    return { ruleIds: [], mergeable: true };
  }
  if (!Array.isArray(rulesField)) {
    return { ruleIds: [], mergeable: false };
  }

  const ids: string[] = [];
  for (const entry of rulesField) {
    // `identifyExistingRule` (core) keys a built-in by its canonical `rule` and a custom rule by its
    // canonical `id` — never the literal `"custom"`. Any entry it can't identify (a bare string, a
    // non-string `rule`, or a `rule: "custom"` with a missing/non-string/non-schemaable `id`) makes
    // the whole config non-mergeable: appending inferred rules over an unidentifiable existing entry
    // could silently duplicate or shadow it, so the caller routes this to the not-written abort.
    const identity = identifyExistingRule(entry);
    if (identity.kind === "invalid") {
      return { ruleIds: [], mergeable: false };
    }
    ids.push(
      identity.kind === "custom" ? identity.rule.id : identity.canonicalId,
    );
  }
  return { ruleIds: ids, mergeable: true };
}

/**
 * The existing config's parsed root object for the merge *write* path (feeds `generateInitConfig`'s
 * `ExistingConfigDocument`). Only consulted once the diff has already confirmed the file is readable
 * and additively mergeable, so an undefined `raw` here is a guarded, unreachable case rather than a
 * silent fallback.
 */
export async function readExistingConfigDocument(
  cwd: string,
  configPath: string,
): Promise<ParsedExistingConfig> {
  return parseExistingConfigFile(cwd, configPath);
}

// The existing config as the lint pipeline itself resolves it (root schema + rule resolution),
// or `undefined` when it does not load at all. A `merge` gates on this so it never rewrites a config
// that preserves an already-invalid key/rule/options and then reports success (acceptance: init
// writes a valid config). Any thrown ConfigError (or other read failure) counts as "does not load".
//
// It returns the loaded configuration rather than a boolean because the merge scope is read off it:
// deriving `include`/`exclude`/`settings` from the raw parsed object instead would be a second
// implementation of defaulting rules that the loader already owns, free to disagree with the run.
async function loadExistingConfiguration(
  cwd: string,
  configPath: string,
): Promise<LoadedConfiguration | undefined> {
  try {
    return await loadConfiguration({ cwd, explicitConfigPath: configPath });
  } catch {
    return undefined;
  }
}

/**
 * What a `merge` knows about the config it is about to rebuild. Every other disposition gets the
 * empty baseline, which is what lets the caller treat "no merge" and "merge" through one shape.
 */
export type MergeBaseline = {
  // The single parsed snapshot of the existing config, read once and reused by the inference scope,
  // the rule diff, and the merge write — re-reading after confirmation could race with a concurrent
  // edit and (on a second-read failure) silently drop the very entries a merge must preserve.
  existingDocument: ParsedExistingConfig | undefined;
  existingRuleIds: string[];
  existingConfiguration: LoadedConfiguration | undefined;
  existingConfigUnreadable: boolean;
};

/**
 * Reads the merge baseline. Called before inference rather than after it, because a merge's
 * inference scope *is* this file's `include`/`exclude`/`settings`. Inferring first and filtering
 * afterwards was what let a merge append a rule whose only evidence sat in files the preserved
 * `include` never selects, and then write the measurement that justified it into the config as a
 * permanent comment.
 */
export async function readMergeBaseline(
  cwd: string,
  existingConfigPath: string | undefined,
  existingConfigAction: ExistingConfigAction | "none",
): Promise<MergeBaseline> {
  if (existingConfigPath === undefined || existingConfigAction !== "merge") {
    return {
      existingDocument: undefined,
      existingRuleIds: [],
      existingConfiguration: undefined,
      existingConfigUnreadable: false,
    };
  }

  const existingDocument = await readExistingConfigDocument(
    cwd,
    existingConfigPath,
  );
  const { ruleIds, mergeable } = extractExistingRuleIds(existingDocument.raw);
  // Additive merge preserves the existing content verbatim, so the written config is only valid if
  // the existing one already loads (append-only adds registry-valid inferred rules). Validate it
  // through the real loader — an unknown top-level key, unknown rule id, or invalid preserved
  // options must abort the merge, never be reported as a successful write of a config that
  // `loadConfiguration` would then reject.
  const existingConfiguration = await loadExistingConfiguration(
    cwd,
    existingConfigPath,
  );
  return {
    existingDocument,
    existingRuleIds: ruleIds,
    existingConfiguration,
    existingConfigUnreadable:
      !existingDocument.parsed ||
      !mergeable ||
      existingConfiguration === undefined,
  };
}

/**
 * The corpus a merge's config will lint. A merge keeps every existing scope key untouched, so the
 * loaded config's own values are the scope — taken from the loader's result rather than the raw
 * file, so its defaulting is not reimplemented here.
 */
export function mergeInferenceScope(
  configuration: LoadedConfiguration,
): InferenceScope {
  const { config } = configuration;
  return {
    ...(config.include === undefined ? {} : { include: config.include }),
    ...(config.exclude === undefined ? {} : { exclude: config.exclude }),
    ...(config.respectGitignore === undefined
      ? {}
      : { respectGitignore: config.respectGitignore }),
    settings: configuration.settings,
  };
}
