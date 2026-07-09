import { readFile } from "node:fs/promises";
import path from "node:path";

import { type ParseError, parse as parseJsonc } from "jsonc-parser";

import {
  canonicalizeRuleId,
  findConfig,
  inferRuleSet,
  normalizeRelativePath,
  ruleRegistry,
  scanRepository,
  type DetectedPackageManager,
  type DocCluster,
  type InferredRule,
  type RuleCategory,
  type RuleConfigEntry
} from "@wastech-mdlint/core";

// `init` (P6.03): the thin host boundary over P6.01/02's core scan + inference. This module owns
// orchestration and pure preview-building; it never touches process.stdin/stdout (that split lives
// in init-prompter.ts) and never writes a config file (that is P6.04's job — see the phase hand-off
// note in docs/mdlint_v2/P6-init/03-interactive-prompts.md).

export type ExistingConfigAction = "overwrite" | "merge" | "skip";

// The least-destructive choice (I1's "no implicit file-clobbering" spirit) — both `--yes`'s own
// fallback below and the interactive prompt's default (init-prompter.ts) resolve to this single
// constant, so pressing Enter through the interactive flow can never silently diverge from what
// non-interactive `--yes` does.
export const DEFAULT_EXISTING_CONFIG_ACTION: ExistingConfigAction = "skip";

// One method per real decision point (mirrors CliIo's stdout/stderr/cwd seam), so a fake prompter
// can drive every branch of runInitCommand in tests without a TTY.
export type InitPrompter = {
  // `configPath` is already a repository-relative POSIX path (normalized by the caller) — public
  // output never surfaces an absolute, platform-native filesystem path.
  resolveExistingConfigAction(configPath: string): Promise<ExistingConfigAction>;
  choosePackageManager(): Promise<DetectedPackageManager>;
  selectClusters(clusters: DocCluster[]): Promise<DocCluster[]>;
  selectCategories(categories: RuleCategory[]): Promise<RuleCategory[]>;
  // Must display `summary` to the user before asking for confirmation — it is the only place the
  // draft is shown on an interactive run. `runInitCommand` trusts that display already happened
  // and does not re-emit `summary` itself once this resolves, so a caller must not skip it.
  confirmDraft(summary: string): Promise<boolean>;
};

export type InitCommandOptions = {
  cwd: string;
  yes: boolean;
  onExisting?: ExistingConfigAction;
  isTty: boolean;
};

// The confirmed draft handed to formatDraftSummary. `"none"` distinguishes "no config existed" from
// an existing config the user chose to leave alone via `"skip"` (which returns before this is built).
export type ConfirmedInitSelections = {
  existingConfigAction: ExistingConfigAction | "none";
  packageManager: DetectedPackageManager;
  clusters: DocCluster[];
  rules: InferredRule[];
  newRuleIds: string[];
  // Only meaningful when `existingConfigAction === "merge"`: true when the existing config could
  // not be read/parsed, so `newRuleIds` is the *full* inferred set rather than a real diff against
  // known existing ids — the summary must say so rather than presenting the count as authoritative.
  existingConfigUnreadable: boolean;
};

export type ConfigPreview = {
  include: string[];
  rules: RuleConfigEntry[];
};

export type RunInitCommandResult = {
  output: string;
  wasConfirmed: boolean;
};

const DRAFT_SUMMARY_HEADER = "wastech-mdlint init — draft configuration";

/**
 * Groups inferred rules by category, preserving `inferRuleSet`'s own deterministic id order within
 * each group (a computed sequence, not an incidental one — re-sorting here would just be redundant).
 */
export function groupInferredRulesByCategory(
  rules: InferredRule[]
): Partial<Record<RuleCategory, InferredRule[]>> {
  const grouped: Partial<Record<RuleCategory, InferredRule[]>> = {};

  for (const rule of rules) {
    const existing = grouped[rule.category];
    if (existing === undefined) {
      grouped[rule.category] = [rule];
    } else {
      existing.push(rule);
    }
  }

  return grouped;
}

/**
 * Canonical-id set difference (C3): which inferred rules are not already present in an existing
 * config's `rules[]`. Preview-only — the actual additive/existing-wins merge write is P6.04's job.
 */
export function diffAgainstExistingRuleIds(
  existingIds: string[],
  rules: InferredRule[]
): { newRules: InferredRule[] } {
  const canonicalExisting = new Set(existingIds.map((id) => canonicalizeRuleId(id)));
  const newRules = rules.filter((rule) => !canonicalExisting.has(canonicalizeRuleId(rule.rule)));
  return { newRules };
}

export type ExistingRuleIdsResult = {
  ruleIds: string[];
  // false when the file could not be read, its JSONC could not be parsed (or its root isn't an
  // object), or a present `rules` key isn't an array — distinct from a validly-parsed config that
  // simply has no `rules` key at all. The caller must not present a diff computed against an
  // unparsed/malformed `[]` as if it were an authoritative merge.
  parsed: boolean;
};

/**
 * Raw JSONC read of an existing config's `rules[].rule` ids, canonicalized. Deliberately not a full
 * `lintConfigSchema` validation (that belongs to `loadConfiguration`) — a committed config that
 * doesn't fully validate must still be diffable for the merge preview, and a malformed file must
 * degrade to an empty id set (with `parsed: false`, so the caller can warn) rather than crash `init`.
 */
export async function readExistingRuleIds(cwd: string, configPath: string): Promise<ExistingRuleIdsResult> {
  const absoluteConfigPath = path.isAbsolute(configPath) ? configPath : path.resolve(cwd, configPath);

  try {
    const text = await readFile(absoluteConfigPath, "utf8");
    const errors: ParseError[] = [];
    const raw = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });

    if (errors.length > 0 || raw === null || typeof raw !== "object") {
      return { ruleIds: [], parsed: false };
    }

    const rulesField = (raw as { rules?: unknown }).rules;
    if (rulesField === undefined) {
      // Successfully parsed, and the key is genuinely absent — zero existing ids is a known
      // fact here, not a degraded guess.
      return { ruleIds: [], parsed: true };
    }
    if (!Array.isArray(rulesField)) {
      // `rules` is present but structurally invalid (e.g. `{}` or a string) — this config cannot
      // be merged additively, so it degrades the same way an unparsable file does.
      return { ruleIds: [], parsed: false };
    }

    const ids: string[] = [];
    for (const entry of rulesField) {
      const ruleId = entry !== null && typeof entry === "object" ? (entry as { rule?: unknown }).rule : undefined;
      if (typeof ruleId === "string") {
        ids.push(canonicalizeRuleId(ruleId));
      }
    }
    return { ruleIds: ids, parsed: true };
  } catch {
    return { ruleIds: [], parsed: false };
  }
}

/**
 * Shapes the confirmed clusters/rules into the `{ include, rules }` slice of `LintConfig` that
 * P6.04 will eventually serialize. Structural-only — no `$schema`/comments/severity here, and
 * validated against `lintConfigSchema` only in tests (a forward-compat smoke check, not a runtime
 * dependency on the schema).
 */
export function buildConfigPreview(clusters: DocCluster[], rules: InferredRule[]): ConfigPreview {
  const include = [...new Set(clusters.map((cluster) => cluster.includeGlob))].sort((left, right) =>
    left.localeCompare(right)
  );

  const ruleEntries: RuleConfigEntry[] = rules.map((rule) => ({
    rule: rule.rule,
    ...(rule.options === undefined ? {} : { options: rule.options })
  }));

  return { include, rules: ruleEntries };
}

function formatExistingConfigLine(selections: ConfirmedInitSelections, configPath: string | undefined): string {
  if (selections.existingConfigAction === "none" || configPath === undefined) {
    return "Existing config: none found.";
  }

  switch (selections.existingConfigAction) {
    case "overwrite":
      return `Existing config found at ${configPath}: will be overwritten with the confirmed draft below.`;
    case "merge": {
      const base =
        `Existing config found at ${configPath}: existing rules[] entries are left untouched ` +
        `(severity/options preserved); ${selections.newRuleIds.length} new rule(s) would be appended.`;
      return selections.existingConfigUnreadable
        ? `${base} WARNING: the existing config could not be read or parsed, so this is the full ` +
            "inferred set, not a verified diff — check for duplicates before merging."
        : base;
    }
    case "skip":
      // Unreachable via runInitCommand (skip returns before a ConfirmedInitSelections is built),
      // but kept for exhaustiveness since the type still permits it.
      return `Existing config found at ${configPath}: left untouched (skip).`;
    default: {
      const exhaustiveCheck: never = selections.existingConfigAction;
      return exhaustiveCheck;
    }
  }
}

/**
 * Deterministic, human-readable preview of the confirmed draft: existing-config disposition,
 * package manager, include globs (from `buildConfigPreview`, so the printed list matches exactly
 * what P6.04 would serialize), and rules grouped by category with their per-rule rationale.
 *
 * `merge` is additive/existing-wins (P6.03's locked contract): it only ever appends new `rules[]`
 * entries and must never touch `include`/`exclude`/`settings`. So a merge preview omits the
 * `Include (...)` section entirely — showing clusters there would imply `include` is changing,
 * which the merge path is not allowed to write.
 */
export function formatDraftSummary(selections: ConfirmedInitSelections, configPath: string | undefined): string {
  const lines: string[] = [DRAFT_SUMMARY_HEADER, ""];

  lines.push(formatExistingConfigLine(selections, configPath));
  lines.push(`Package manager: ${selections.packageManager ?? "not detected"}.`);
  lines.push("");

  if (selections.existingConfigAction === "merge") {
    lines.push("Include / exclude / settings: left unchanged (merge only appends new rules[] entries).");
  } else {
    const preview = buildConfigPreview(selections.clusters, selections.rules);
    lines.push(`Include (${preview.include.length}):`);
    if (preview.include.length === 0) {
      lines.push("  (none — no Markdown clusters detected)");
    } else {
      for (const glob of preview.include) {
        lines.push(`  - ${glob}`);
      }
    }
  }
  lines.push("");

  const grouped = groupInferredRulesByCategory(selections.rules);
  const categories = (Object.keys(grouped) as RuleCategory[]).sort((left, right) => left.localeCompare(right));

  lines.push(`Rules (${selections.rules.length}):`);
  if (categories.length === 0) {
    lines.push("  (none inferred)");
  } else {
    for (const category of categories) {
      lines.push(`  ${category}:`);
      for (const rule of grouped[category] ?? []) {
        lines.push(`    - ${rule.rule}: ${rule.rationale}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Orchestrates the init flow end to end: resolve existing-config disposition, scan, confirm
 * clusters/package-manager, re-run inference against the confirmed cluster subset (so global gates
 * and the cycle heuristic reflect what the user actually kept), confirm categories, diff against an
 * existing config when merging, and confirm the draft. Never writes a file — the return value is
 * only ever a preview string (P6.04's hand-off owns serialization + write).
 */
export async function runInitCommand(
  options: InitCommandOptions,
  prompter: InitPrompter
): Promise<RunInitCommandResult> {
  const existingConfigPath = await findConfig(options.cwd);
  // `findConfig` walks up to an ancestor directory when `options.cwd` is a subdirectory of a repo
  // that already has a config — the config being merged/overwritten governs from *its own*
  // directory, so the whole flow re-roots there too. Scanning/inferring against `options.cwd`
  // instead would produce include globs/rule scopes relative to the wrong root and could miss a
  // lockfile that only lives at the real root. A no-op when the config is already at `options.cwd`.
  const cwd = existingConfigPath === undefined ? options.cwd : path.dirname(existingConfigPath);
  // Repository-relative POSIX path (public-output invariant) — computed up front so both the
  // existing-config prompt and the printed summary use it instead of the raw absolute path.
  const relativeConfigPath =
    existingConfigPath === undefined ? undefined : normalizeRelativePath(path.relative(cwd, existingConfigPath));

  let existingConfigAction: ExistingConfigAction | "none" = "none";

  if (existingConfigPath !== undefined && relativeConfigPath !== undefined) {
    existingConfigAction = options.yes
      ? options.onExisting ?? DEFAULT_EXISTING_CONFIG_ACTION
      : await prompter.resolveExistingConfigAction(relativeConfigPath);

    if (existingConfigAction === "skip") {
      return {
        output: `${DRAFT_SUMMARY_HEADER}\n\nskipped — existing config left untouched.\n`,
        wasConfirmed: false
      };
    }
  }

  const scanResult = await scanRepository({ cwd });

  const confirmedClusters = options.yes
    ? scanResult.clusters
    : scanResult.clusters.length > 0
      ? await prompter.selectClusters(scanResult.clusters)
      : [];

  // Only prompted when detection found no lockfile and we're not skipping prompts (I2's
  // "guessing with no evidence is a UX call for init, not core's job") — informational in P6.03,
  // carried through for P6.04's optional CI-workflow offer (I6).
  const packageManager =
    scanResult.packageManager === undefined && !options.yes
      ? await prompter.choosePackageManager()
      : scanResult.packageManager;

  // Re-run inference against the confirmed cluster subset, not a post-hoc filter of one
  // full-corpus run, so global gate sums / the cross-cluster cycle heuristic / SEC-001's `files`
  // scoping stay correct for exactly what the user kept.
  const inference = await inferRuleSet({ cwd, clusters: confirmedClusters, registry: ruleRegistry });

  const groupedByCategory = groupInferredRulesByCategory(inference.rules);
  // Only categories with >=1 inferred rule are offered — the other built-ins have a required
  // option with no safe way to derive it from sampled files (see rule-inference.ts's own note on
  // the 7 gated ids), so a category with nothing to add would be a dead, confusing checkbox entry.
  const categoriesWithRules = (Object.keys(groupedByCategory) as RuleCategory[]).sort((left, right) =>
    left.localeCompare(right)
  );

  const selectedCategories = options.yes
    ? categoriesWithRules
    : categoriesWithRules.length > 0
      ? await prompter.selectCategories(categoriesWithRules)
      : [];

  const selectedCategorySet = new Set(selectedCategories);
  let selectedRules = inference.rules.filter((rule) => selectedCategorySet.has(rule.category));
  let existingConfigUnreadable = false;

  if (existingConfigPath !== undefined && existingConfigAction === "merge") {
    const existingRuleIds = await readExistingRuleIds(cwd, existingConfigPath);
    existingConfigUnreadable = !existingRuleIds.parsed;
    selectedRules = diffAgainstExistingRuleIds(existingRuleIds.ruleIds, selectedRules).newRules;
  }

  const selections: ConfirmedInitSelections = {
    existingConfigAction,
    packageManager,
    clusters: confirmedClusters,
    rules: selectedRules,
    newRuleIds: selectedRules.map((rule) => rule.rule),
    existingConfigUnreadable
  };

  const summary = formatDraftSummary(selections, relativeConfigPath);

  // `--yes` never prompts, so `summary` has not been shown to anyone yet — it must be the
  // returned output. Interactively, `confirmDraft` owns displaying `summary` (see its contract
  // above) before asking, so echoing it again here would print the draft twice.
  if (options.yes) {
    return { output: summary, wasConfirmed: true };
  }

  const confirmed = await prompter.confirmDraft(summary);
  if (!confirmed) {
    return { output: "Aborted: configuration not confirmed.\n", wasConfirmed: false };
  }

  return { output: "", wasConfirmed: true };
}
