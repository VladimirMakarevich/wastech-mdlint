import path from "node:path";

import {
  compareStrings,
  DEFAULT_EXCLUDE_GLOBS,
  DEFAULT_INCLUDE_GLOBS,
  MARKDOWN_GLOB_SUFFIX,
  matchesConfigGlob,
  type DetectedPackageManager,
  type DocCluster,
  type InferenceScope,
  type InferredRule,
  type ProjectSchemaReason,
  type RuleCategory,
  type RuleConfigEntry,
  type ScanPruning,
} from "@wastech-mdlint/core";

import type { ExistingConfigAction } from "./init-types.js";

// The draft `init` shows before anything is written: the `{ include, rules }` preview, the scope the
// fresh write will lint, and the pure formatters that render it. Pure throughout, so every line the
// user confirms is asserted directly rather than only through a full run.

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
  // known existing ids - the summary must say so rather than presenting the count as authoritative.
  existingConfigUnreadable: boolean;
  // Whether the scan found any cluster to offer at all. `clusters: []` is ambiguous on its own, and
  // the two readings need opposite `include` values: nothing detected means "fall back
  // to the tool default", while every offered cluster deselected means "lint none of these". A
  // required field so each call site has to state which case it is in.
  clustersWereOffered: boolean;
  // Only meaningful for `"merge"`: the existing config carries JSONC comments the rebuild will drop.
  existingConfigHasComments: boolean;
  // What the scan refused to walk, straight from `scanRepository`. Required for the same reason
  // `clustersWereOffered` is: the draft has to disclose it, and an optional field would let a
  // new call site drop the disclosure silently - which is the exact defect this closes.
  pruning: ScanPruning;
  // Which `$schema` the write will point at, and whether reaching it means creating a second file.
  // Required for the same reason `pruning` is: warn-before-confirming covers what a run *creates*,
  // not only what it replaces, and the schema file used to appear in the after-the-fact write
  // summary alone.
  schema: DraftSchemaPlan;
};

/**
 * What the draft says about `$schema` before the user confirms. `ref` is the value the config will
 * carry; `projectSchema` is present only when `init` must also generate a schema file beside the
 * config for that ref to resolve - the ordinary `npx` case, where nothing is installed to point at,
 * or a config whose custom rules the built-in schema cannot describe.
 *
 * Both fields come straight from `generateInitConfig`, so the draft and the write summary cannot
 * disagree about which file the config points at or about why it is there.
 */
export type DraftSchemaPlan = {
  ref: string;
  projectSchema?: { fileName: string; reason: ProjectSchemaReason };
};

export type ConfigPreview = {
  include: string[];
  rules: RuleConfigEntry[];
};

export const DRAFT_SUMMARY_HEADER = "wastech-mdlint init - draft configuration";

// One wording for comment loss, shared by the draft preview and the write summary so the warning the
// user agreed to and the one they are told about afterwards can never drift apart. Tense-neutral for
// that reason: the draft appends its own "back it up first" hint, which only makes sense beforehand.
export const COMMENT_LOSS_NOTE =
  "merge rebuilds the config from its parsed values, so the JSONC comments in the existing file " +
  "are not preserved.";

// The two rules the README leads with are the two `init` can never propose, and measuring the whole
// corpus rather than a sample does not change that: both require a budget, and a budget is a choice
// rather than a measurement - knowing how large every document is says nothing about how large one
// ought to be. That is a scope choice, and an unstated one is what turns into a finding a second
// time, so the draft says it out loud rather than leaving the user to notice the absence. Same
// disclosure discipline as the scan-exclusion block above it.
const NOT_INFERRED_NOTE = [
  "Not proposed by init:",
  "  SIZE-001 (byte / line / token budgets) and LLM-001 (eager-import token budget) are never " +
    "inferred - both need a budget only you can choose, and measuring your corpus cannot supply " +
    "one. Add them by hand: see docs/guide/rules/SIZE-001.md and " +
    "docs/guide/rules/LLM-001.md.",
];

/**
 * Groups inferred rules by category, preserving `inferRuleSet`'s own deterministic id order within
 * each group (a computed sequence, not an incidental one - re-sorting here would just be redundant).
 */
export function groupInferredRulesByCategory(
  rules: InferredRule[],
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
 * The `include` value a fresh write will use - the one place this three-valued rule is decided.
 *
 * Three values, because an empty selection and an empty scan need opposite files: a literal `[]` is
 * written only when clusters were offered and turned down (lints nothing, as asked), while a scan
 * that found none omits the key so the tool's own dot-matching default `include` applies. Inverting a
 * deliberate "none of these" into that default is the bug this shape exists to prevent. (The default
 * glob is not spelled here for the reason the comment on `formatScanExclusions` gives: it contains a
 * sequence that would close this block comment early.)
 *
 * It is one function because two callers need the same answer in different forms: the writer needs the
 * value, and the draft's scan-exclusion disclosure needs to know whether the key will be written at
 * all (`resolveIncludeToWrite(...) !== undefined`) - the case where the skipped hidden files end up
 * linted by the default rather than excluded. Derived twice, they could disagree, and the disclosure
 * would then claim the opposite of what was written.
 */
export function resolveIncludeToWrite(
  previewInclude: readonly string[],
  clustersWereOffered: boolean,
): string[] | undefined {
  if (previewInclude.length > 0) {
    return [...previewInclude];
  }
  return clustersWereOffered ? [] : undefined;
}

/**
 * The corpus a fresh write's config will lint, so inference can measure exactly it.
 *
 * Every value here has to be the one `generateInitConfig`'s fresh branch emits, not an approximation
 * of it: the counts inference writes into the rationale comments are a promise that running `lint`
 * against the file reproduces them, and a scope assembled from different defaults would break that
 * promise silently - the config would still be valid and the numbers beside each rule simply wrong.
 * That is why `include` comes from the same three-valued helper the writer uses rather than from the
 * cluster list directly, and why `respectGitignore` is pinned `true` here as it is there.
 */
export function freshInferenceScope(
  clusters: DocCluster[],
  clustersWereOffered: boolean,
): InferenceScope {
  const include = resolveIncludeToWrite(
    buildConfigPreview(clusters, []).include,
    clustersWereOffered,
  );
  return {
    ...(include === undefined ? {} : { include }),
    exclude: [...DEFAULT_EXCLUDE_GLOBS],
    respectGitignore: true,
  };
}

/**
 * Shapes the confirmed clusters/rules into the `{ include, rules }` slice of `LintConfig` the
 * writer later serializes. Structural-only - no `$schema` and no rationale comments here - and
 * validated against `lintConfigSchema` only in tests (a forward-compat smoke check, not a runtime
 * dependency on the schema). A proposal's `severity` *is* carried, because it decides whether the
 * entry runs; a preview that dropped it would show the user a rule the write then disables.
 */
export function buildConfigPreview(
  clusters: DocCluster[],
  rules: InferredRule[],
): ConfigPreview {
  const include = [
    ...new Set(clusters.map((cluster) => cluster.includeGlob)),
  ].sort(compareStrings);

  const ruleEntries: RuleConfigEntry[] = rules.map((rule) => ({
    rule: rule.rule,
    ...(rule.severity === undefined ? {} : { severity: rule.severity }),
    ...(rule.options === undefined ? {} : { options: rule.options }),
  }));

  return { include, rules: ruleEntries };
}

function formatExistingConfigLine(
  selections: ConfirmedInitSelections,
  configPath: string | undefined,
): string {
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
      if (selections.existingConfigUnreadable) {
        return (
          `${base} WARNING: the existing config could not be read, parsed, or validated, so this is ` +
          "the full inferred set, not a verified diff - check for duplicates before merging."
        );
      }
      // Surfaced here, before `confirmDraft`, and not only in the write summary: comment loss is the
      // one part of an "additive, existing-wins" merge that is genuinely destructive, so the user has
      // to see it while they can still decline.
      return selections.existingConfigHasComments
        ? `${base} WARNING: ${COMMENT_LOSS_NOTE} Back it up first if you need them.`
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

// How many entries one exclusion line names before it collapses into a `+N more` tail. A monorepo can
// prune dozens of `node_modules` copies, and a wall of paths is what makes a disclosure ignorable -
// a disclosure nobody reads. The input is sorted, so which entries survive the cap is stable.
const EXCLUSION_LIST_CAP = 5;

// One named thing on an exclusion line, with however many of it there are: Markdown files under a
// hidden directory, or pruned directories sharing a basename.
type CountedEntry = { name: string; count: number };

function sumCounts(entries: readonly CountedEntry[]): number {
  return entries.reduce((total, entry) => total + entry.count, 0);
}

// Renders `name (count)` pairs, and the elided tail carries the total it drops.
//
// Both halves exist so the line's leading total is arithmetic the reader can perform against the list
// beside it. Printing a count of directories next to a deduplicated list of names is what made
// `3 directories skipped by name - .git, node_modules` unreconcilable: two correct numbers, no stated
// relationship, and a reader left to guess whether the disclosure or their own arithmetic is wrong.
// The tail is the same failure at the cap - `+6 more` names says nothing about how many of the total
// those six account for.
function formatCountedList(entries: readonly CountedEntry[]): string {
  const render = (entry: CountedEntry): string =>
    `${entry.name} (${entry.count})`;

  if (entries.length <= EXCLUSION_LIST_CAP) {
    return entries.map(render).join(", ");
  }

  const shown = entries.slice(0, EXCLUSION_LIST_CAP).map(render).join(", ");
  const elided = entries.slice(EXCLUSION_LIST_CAP);
  return `${shown}, +${elided.length} more (${sumCounts(elided)})`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// Deduped, sorted basenames of a pruned set with their occurrence counts - `mobile/node_modules` and
// `node_modules` are one name to report, and the count is what keeps the line's own total derivable.
function prunedNameCounts(
  directories: readonly { path: string }[],
): CountedEntry[] {
  const counts = new Map<string, number>();
  for (const entry of directories) {
    const name = path.posix.basename(entry.path);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => compareStrings(left.name, right.name));
}

// Splits one pruned hidden directory's Markdown files by whether the drafted config will lint them.
//
// A hidden directory is skipped by the *scan*, which is a separate question from whether the config
// the scan led to selects its files - and the two answers routinely differ. Config globs are matched
// with dot-segments enabled, so a cluster proposed for an ancestor directory (`backend`) covers a
// dot-directory nested under it (`backend/.rules`) without ever naming it. A directory can therefore
// land on both sides at once, when the include reaches part of its tree and not the rest.
//
// Judged per file rather than per directory for that reason, and against the same patterns the write
// will emit, so the block cannot claim a file is out of the corpus that the config beside it pulls in.
function partitionHiddenFiles(
  files: readonly string[],
  include: readonly string[],
  exclude: readonly string[],
): { linted: string[]; notLinted: string[] } {
  const linted: string[] = [];
  const notLinted: string[] = [];

  for (const file of files) {
    const selected =
      matchesConfigGlob(file, [...include]) &&
      !matchesConfigGlob(file, [...exclude]);
    (selected ? linted : notLinted).push(file);
  }

  return { linted, notLinted };
}

/**
 * The scan-exclusion disclosure: what the scan refused to walk, why, and - for the one class where
 * the two can differ - whether the drafted config lints those files anyway. Pure and exported so the
 * wording is asserted directly, mirroring `formatDraftSummary`/`formatWriteSummary`.
 *
 * **One line per reason, never one total.** The classes are not one class: a pruned `node_modules` is
 * unsurprising, and a `.claude/skills/` dropped because its parent starts with a dot is the finding.
 * A single aggregate count is precisely what invites a user to skim past it.
 *
 * **Every count is derivable from the list printed beside it.** Each line states a total and then
 * names its parts with their own counts, so a reader can add them up rather than take the total on
 * faith; an elided tail carries the total it drops for the same reason.
 *
 * Only the hidden class names files, and the asymmetry is deliberate - it is the one class whose
 * contents are plausibly documentation the user wants linted, and it is also the only one cheap to
 * enumerate (`scanRepository` lists it while pruning; listing a dependency tree would mean walking the
 * tree that pruning exists to avoid). The other two say "contents not counted" out loud rather than
 * implying a zero.
 *
 * Returns `[]` when there is nothing to disclose, so the caller can omit the block entirely.
 *
 * `includeToWrite` is the exact value the write will put in the `include` key - the patterns, not a
 * flag - because the hidden class needs both of the questions it answers. *Which* patterns decides
 * per file whether a skipped file is nonetheless in the corpus, which is the difference between a
 * true sentence and a misleading one when a cluster glob covers a dot-directory nested under it.
 * *Whether* the key is written at all (`undefined`) decides the actionable half: with an include, a
 * file outside it needs a pattern added; with the key omitted - the scan found no cluster, which is
 * exactly the shape of a repo whose only Markdown *is* in dot-directories - the dot-matching default
 * is in force instead, and saying otherwise would contradict the `Include (…)` line above.
 *
 * (No default glob is spelled out in this block comment on purpose: a depth-agnostic prefix contains
 * `*` `*` `/`, which would close the comment early - the same reason `config/corpus-scope.ts` uses
 * `//` throughout.)
 */
export function formatScanExclusions(
  pruning: ScanPruning,
  includeToWrite: readonly string[] | undefined,
): string[] {
  // The scope the drafted config will actually lint by. `exclude` and `respectGitignore` are pinned
  // by the fresh write, and this is the same `exclude` it emits - the hidden files were already
  // walked under the scan's own noise and gitignore pruning, so applying it here is what keeps the
  // two definitions from drifting apart rather than a second filter.
  const include = includeToWrite ?? DEFAULT_INCLUDE_GLOBS;

  // Sorted here rather than trusted from the caller: `ScanPruning` is public core API and this
  // formatter is exported, so an unsorted record would otherwise render in input order and shift
  // which entries the cap keeps. Sorting belongs at the rendering site, not at the caller.
  const hidden = pruning.directories
    .filter((entry) => entry.reason === "hidden")
    .sort((left, right) => compareStrings(left.path, right.path));
  const noise = pruning.directories.filter((entry) => entry.reason === "noise");
  const gitignored = pruning.directories.filter(
    (entry) => entry.reason === "gitignored",
  );

  const notLinted: CountedEntry[] = [];
  const lintedAnyway: CountedEntry[] = [];
  for (const entry of hidden) {
    const split = partitionHiddenFiles(
      entry.markdownFiles ?? [],
      include,
      DEFAULT_EXCLUDE_GLOBS,
    );
    // A directory holding no Markdown at all contributes to neither, and is therefore never
    // disclosed: reporting an empty `.husky` would train the reader to skim the line that matters.
    if (split.notLinted.length > 0) {
      notLinted.push({ name: entry.path, count: split.notLinted.length });
    }
    if (split.linted.length > 0) {
      lintedAnyway.push({ name: entry.path, count: split.linted.length });
    }
  }

  const lines: string[] = [];

  const describeHidden = (entries: readonly CountedEntry[]): string =>
    `${pluralize(sumCounts(entries), "Markdown file", "Markdown files")} in ` +
    `${pluralize(entries.length, "directory", "directories")} whose name starts with a dot - ` +
    `${formatCountedList(entries)}.`;

  if (notLinted.length > 0) {
    // The suggested pattern splices MARKDOWN_GLOB_SUFFIX rather than a literal `.md` tail, because
    // the count beside it was produced with MARKDOWN_EXTENSIONS: a hardcoded tail would advertise a
    // pattern that lints fewer files than the number in the same sentence. The directory it names is
    // taken from this group, so the advice can never point at one an include already covers - which
    // is the whole reason the two groups are separate lines.
    const advice =
      includeToWrite === undefined
        ? `The scan never proposes a dot-directory as a doc cluster, and no include will be ` +
          `written either, so the dot-matching default is in force - it selects .md only, so these ` +
          `are not linted.`
        : `The scan never proposes a dot-directory as a doc cluster, and no include pattern above ` +
          `matches these; add a pattern such as "${notLinted[0]!.name}/**/${MARKDOWN_GLOB_SUFFIX}" ` +
          `to lint them.`;
    lines.push(
      `  hidden directories, not linted: ${describeHidden(notLinted)} ${advice}`,
    );
  }

  if (lintedAnyway.length > 0) {
    // Reported rather than dropped, because the surprise runs in this direction too: a finding in a
    // file the same screen has just listed under "Excluded from the scan" reads as a bug in the tool.
    // No advice here - there is nothing to add.
    const note =
      includeToWrite === undefined
        ? `The scan never proposes a dot-directory as a doc cluster, but no include will be ` +
          `written either, so the dot-matching default stays in force and these are linted.`
        : `The scan never proposed these as doc clusters, but an include pattern above matches ` +
          `them anyway, so they are in the corpus.`;
    lines.push(
      `  hidden directories, linted anyway: ${describeHidden(lintedAnyway)} ${note}`,
    );
  }

  if (noise.length > 0) {
    lines.push(
      `  build and dependency directories: ${pluralize(noise.length, "directory", "directories")} ` +
        `skipped by name, contents not counted - ${formatCountedList(prunedNameCounts(noise))}.`,
    );
  }

  if (gitignored.length > 0) {
    lines.push(
      `  gitignored directories: ${pluralize(gitignored.length, "directory", "directories")} ` +
        `skipped, contents not counted - ${formatCountedList(prunedNameCounts(gitignored))}.`,
    );
  }

  return lines.length === 0 ? [] : ["Excluded from the scan:", ...lines];
}

/**
 * Deterministic, human-readable preview of the confirmed draft: existing-config disposition,
 * package manager, include globs (from `buildConfigPreview`, so the printed list matches exactly
 * what the writer will serialize), the scan-exclusion disclosure, the `$schema` the write will point
 * at and any schema file it has to create for that, rules grouped by category with their per-rule
 * rationale, and the two rules inference will never reach (`NOT_INFERRED_NOTE`).
 *
 * `merge` is additive and existing-wins: it only ever appends new `rules[]`
 * entries and must never touch `include`/`exclude`/`settings`. So a merge preview omits the
 * `Include (...)` section entirely - showing clusters there would imply `include` is changing,
 * which the merge path is not allowed to write.
 */
export function formatDraftSummary(
  selections: ConfirmedInitSelections,
  configPath: string | undefined,
): string {
  const lines: string[] = [DRAFT_SUMMARY_HEADER, ""];

  lines.push(formatExistingConfigLine(selections, configPath));
  lines.push(
    `Package manager: ${selections.packageManager ?? "not detected"}.`,
  );
  lines.push("");

  if (selections.existingConfigAction === "merge") {
    lines.push(
      "Include / exclude / settings: left unchanged (merge only appends new rules[] entries).",
    );
  } else {
    const preview = buildConfigPreview(selections.clusters, selections.rules);
    lines.push(`Include (${preview.include.length}):`);
    if (preview.include.length === 0) {
      // The two empty cases produce different files, so they must not share a message: deselecting
      // every offered cluster writes a literal `"include": []` (lints nothing), while finding none
      // omits the key and leaves the tool's `**/*.md` default in force.
      lines.push(
        selections.clustersWereOffered
          ? '  (none selected - an empty "include" will be written, so no files will be linted)'
          : "  (none - no Markdown clusters detected; include will be omitted, so the default **/*.md applies)",
      );
    } else {
      for (const glob of preview.include) {
        lines.push(`  - ${glob}`);
      }
    }

    // Only on a fresh write, and only after the Include block it qualifies: `merge` has just said
    // scope is left unchanged, so disclosing what the scan skipped there would imply a decision the
    // merge path is not making. Under `--yes` this reaches stdout via `composeOutput`; interactively
    // `confirmDraft` shows it while the user can still decline, which is where the warn-before-
    // confirming discipline wants it.
    // Asks the writer's own decision function rather than re-deriving it, and hands over the value
    // itself: the disclosure judges each skipped file against the patterns the config will carry, so
    // a second derivation here could describe a boundary the written file does not have. The omitted
    // case (nothing selected *and* nothing offered) is carried by `undefined` rather than flattened,
    // because that is the one case where the hidden files end up linted by the default.
    const exclusions = formatScanExclusions(
      selections.pruning,
      resolveIncludeToWrite(preview.include, selections.clustersWereOffered),
    );
    if (exclusions.length > 0) {
      lines.push("", ...exclusions);
    }
  }

  // The same `Schema:` line the write summary carries, shown here as well rather than only there:
  // the `npx` path generates a schema.json beside the config, and a file the run *creates* in the
  // user's repository has to be on screen while declining is still possible - the write summary
  // alone puts it after the fact. Unconditional (including on `merge`, which always rewires
  // `$schema`) so the two summaries can never describe different files.
  lines.push("", `Schema: ${selections.schema.ref}`);
  const { projectSchema } = selections.schema;
  if (projectSchema !== undefined) {
    lines.push(
      `  init will also write ${projectSchema.fileName} beside the config ` +
        `(${describeProjectSchemaReason(projectSchema.reason)}), so that $schema resolves. ` +
        `A ${projectSchema.fileName} already at that path is reported and kept rather than ` +
        "replaced, unless it is init's own and you passed --on-existing overwrite.",
    );
  }
  lines.push("");

  const grouped = groupInferredRulesByCategory(selections.rules);
  const categories = (Object.keys(grouped) as RuleCategory[]).sort(
    compareStrings,
  );

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

  // Unconditional, including on `merge`: it states what `init` proposes, which is true whatever the
  // existing config already lists, so no branch needs to opt out of it.
  lines.push("", ...NOT_INFERRED_NOTE);

  return `${lines.join("\n")}\n`;
}

// The parenthetical every schema line carries. It replaces the previous hardcoded "custom rules
// present", which stopped being true once the `npx` fallback started generating the same file for a
// config with no custom rules at all.
export function describeProjectSchemaReason(
  reason: ProjectSchemaReason,
): string {
  return reason === "custom-rules"
    ? "custom rules present"
    : "no installed package schema to point at";
}
