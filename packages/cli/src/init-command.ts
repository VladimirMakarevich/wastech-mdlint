import { mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { type ParseError, parse as parseJsonc } from "jsonc-parser";

import {
  buildCiWorkflowYaml,
  canonicalizeRuleId,
  compareStrings,
  CONFIG_FILE_NAME,
  containsJsoncComments,
  findConfig,
  generateInitConfig,
  identifyExistingRule,
  inferRuleSet,
  loadConfiguration,
  MARKDOWN_GLOB_SUFFIX,
  normalizeRelativePath,
  PACKAGE_SCHEMA_SEGMENTS,
  resolvePackageSchemaRef,
  ruleRegistry,
  scanRepository,
  writeFilesAtomic,
  type AtomicFileWrite,
  type DetectedPackageManager,
  type DocCluster,
  type ExistingConfigDocument,
  type GeneratedInitConfig,
  type InferredRule,
  type InitConfigAction,
  type ProjectSchemaReason,
  type RuleCategory,
  type RuleConfigEntry,
  type ScanPruning,
} from "@wastech-mdlint/core";

// `init` (P6.03/P6.04): the thin host boundary over P6.01/02's core scan + inference. This module
// owns orchestration and pure preview-building; it never touches process.stdin/stdout (that split
// lives in init-prompter.ts). P6.04 makes it write the confirmed config: core generates the bytes
// (generateInitConfig), this host performs the actual filesystem writes.

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
  resolveExistingConfigAction(
    configPath: string,
  ): Promise<ExistingConfigAction>;
  choosePackageManager(): Promise<DetectedPackageManager>;
  selectClusters(clusters: DocCluster[]): Promise<DocCluster[]>;
  selectCategories(categories: RuleCategory[]): Promise<RuleCategory[]>;
  // Must display `summary` to the user before asking for confirmation — it is the only place the
  // draft is shown on an interactive run. `runInitCommand` trusts that display already happened
  // and does not re-emit `summary` itself once this resolves, so a caller must not skip it.
  confirmDraft(summary: string): Promise<boolean>;
  // The opt-in CI-workflow offer (I6): "ask first, don't write silently", so its prompt defaults to
  // no. Only consulted on an interactive run when no workflow file already exists.
  confirmCiWorkflow(): Promise<boolean>;
};

export type InitCommandOptions = {
  cwd: string;
  yes: boolean;
  onExisting?: ExistingConfigAction;
  isTty: boolean;
  // Pre-answers the CI-workflow prompt under `--yes` only (mirrors `--on-existing`): interactive
  // runs always prompt regardless of this flag.
  withCiWorkflow?: boolean;
  // True only when the CLI's `[path]` argument was actually typed by the user (program.ts is the
  // one layer that can tell "typed, and happens to equal cwd" apart from "omitted"). A required
  // field, not optional, so every call site is forced to decide it explicitly (H-3, P11.04): an
  // explicit target directory must not be silently re-rooted onto a config found at a strict
  // ancestor — see the re-rooting comment in `runInitCommand` below.
  pathWasExplicit: boolean;
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
  // Whether the scan found any cluster to offer at all. `clusters: []` is ambiguous on its own, and
  // the two readings need opposite `include` values (audit L-9): nothing detected means "fall back
  // to the tool default", while every offered cluster deselected means "lint none of these". A
  // required field so each call site has to state which case it is in.
  clustersWereOffered: boolean;
  // Only meaningful for `"merge"`: the existing config carries JSONC comments the rebuild will drop.
  existingConfigHasComments: boolean;
  // What the scan refused to walk, straight from `scanRepository`. Required for the same reason
  // `clustersWereOffered` is: the draft has to disclose it (W-14), and an optional field would let a
  // new call site drop the disclosure silently — which is the exact defect this closes.
  pruning: ScanPruning;
};

export type ConfigPreview = {
  include: string[];
  rules: RuleConfigEntry[];
};

/**
 * Every way `runInitCommand` can end, named — because four of the six write nothing and the host has
 * to sort them into two exit codes that mean opposite things (P14.02, W-13). A boolean could not:
 * the previous `writeFailed` flag collapsed "the user asked for no write" and "the file we were told
 * to merge into is invalid" into one `false`, so a CI merge step that refused to write reported
 * success. Which bucket a new outcome belongs in is a decision, so it is spelled out here and
 * switched exhaustively at the boundary rather than inferred from a flag.
 *
 * Deliberate no-write (exit `0`): `skipped`, `declined`. Operational failure (exit `2`):
 * `invalid-existing-config`, `write-failed`, `ci-workflow-write-failed`.
 */
export type InitOutcome =
  | "written"
  | "skipped"
  | "declined"
  | "invalid-existing-config"
  | "write-failed"
  | "ci-workflow-write-failed";

export type RunInitCommandResult = {
  output: string;
  outcome: InitOutcome;
};

const DRAFT_SUMMARY_HEADER = "wastech-mdlint init — draft configuration";

// One wording for comment loss, shared by the draft preview and the write summary so the warning the
// user agreed to and the one they are told about afterwards can never drift apart. Tense-neutral for
// that reason: the draft appends its own "back it up first" hint, which only makes sense beforehand.
const COMMENT_LOSS_NOTE =
  "merge rebuilds the config from its parsed values, so the JSONC comments in the existing file " +
  "are not preserved.";

/**
 * Groups inferred rules by category, preserving `inferRuleSet`'s own deterministic id order within
 * each group (a computed sequence, not an incidental one — re-sorting here would just be redundant).
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
 * Canonical-id set difference (C3): which inferred rules are not already present in an existing
 * config's `rules[]`. Preview-only — the actual additive/existing-wins merge write is P6.04's job.
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
  // those comments do not survive it (audit L-8) — this is what lets the summaries say so instead of
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
    const raw = parseJsonc(text, errors, {
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

/**
 * Shapes the confirmed clusters/rules into the `{ include, rules }` slice of `LintConfig` that
 * P6.04 will eventually serialize. Structural-only — no `$schema`/comments/severity here, and
 * validated against `lintConfigSchema` only in tests (a forward-compat smoke check, not a runtime
 * dependency on the schema).
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
          "the full inferred set, not a verified diff — check for duplicates before merging."
        );
      }
      // Surfaced here, before `confirmDraft`, and not only in the write summary: comment loss is the
      // one part of an "additive, existing-wins" merge that is genuinely destructive, so the user has
      // to see it while they can still decline (audit L-8).
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

// How many directories one exclusion line names before it collapses into `+N more`. A monorepo can
// prune dozens of `node_modules` copies, and a wall of paths is what makes a disclosure ignorable —
// the failure mode W-14 is about. The input is sorted, so which entries survive the cap is stable.
const EXCLUSION_LIST_CAP = 5;

function formatCappedList(items: string[]): string {
  if (items.length <= EXCLUSION_LIST_CAP) {
    return items.join(", ");
  }
  const shown = items.slice(0, EXCLUSION_LIST_CAP).join(", ");
  return `${shown}, +${items.length - EXCLUSION_LIST_CAP} more`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// Deduped, sorted basenames of a pruned set — `mobile/node_modules` and `node_modules` are one fact
// to report, not two.
function prunedBaseNames(directories: readonly { path: string }[]): string[] {
  return [
    ...new Set(directories.map((entry) => path.posix.basename(entry.path))),
  ].sort(compareStrings);
}

/**
 * The scan-exclusion disclosure (P14.03 / W-14): what the scan refused to walk, and why. Pure and
 * exported so the wording is asserted directly, mirroring `formatDraftSummary`/`formatWriteSummary`.
 *
 * **One line per reason, never one total.** The three classes are not one class: a pruned
 * `node_modules` is unsurprising, and a `.claude/skills/` dropped because its parent starts with a
 * dot is the finding. A single aggregate count is precisely what invites a user to skim past it.
 *
 * Only the hidden class carries a file count, and the asymmetry is deliberate — it is the one class
 * whose contents are plausibly documentation the user wants linted, and it is also the only one
 * cheap to size (`scanRepository` counts it while pruning; counting a dependency tree would mean
 * walking the tree that pruning exists to avoid). The other two say "contents not counted" out loud
 * rather than implying a zero.
 *
 * Returns `[]` when there is nothing to disclose, so the caller can omit the block entirely.
 *
 * `includeWillBeWritten` decides the hidden line's actionable half, and it has to be passed in
 * because the two answers are opposites: with an `include` written, a dot-directory is outside the
 * corpus and the user needs a pattern to add. With the key omitted — the scan found no cluster at
 * all, which is exactly the shape of a repo whose only Markdown *is* in dot-directories — the
 * dot-matching default `include` is in force and those files are already linted. Claiming otherwise
 * in that branch would contradict the `Include (…)` line printed two lines above it.
 *
 * (No default glob is spelled out in this block comment on purpose: a depth-agnostic prefix contains
 * `*` `*` `/`, which would close the comment early — the same reason `config/corpus-scope.ts` uses
 * `//` throughout.)
 */
export function formatScanExclusions(
  pruning: ScanPruning,
  includeWillBeWritten: boolean,
): string[] {
  // Sorted here rather than trusted from the caller: `ScanPruning` is public core API and this
  // formatter is exported, so an unsorted record would otherwise render in input order and shift
  // which entries the cap keeps (.agents/rules/coding-style.md — sort at the rendering site).
  const hidden = pruning.directories
    .filter(
      (entry) =>
        entry.reason === "hidden" && (entry.markdownFileCount ?? 0) > 0,
    )
    .sort((left, right) => compareStrings(left.path, right.path));
  const noise = pruning.directories.filter((entry) => entry.reason === "noise");
  const gitignored = pruning.directories.filter(
    (entry) => entry.reason === "gitignored",
  );

  const lines: string[] = [];

  if (hidden.length > 0) {
    const total = hidden.reduce(
      (sum, entry) => sum + (entry.markdownFileCount ?? 0),
      0,
    );
    const named = formatCappedList(
      hidden.map((entry) => `${entry.path} (${entry.markdownFileCount})`),
    );
    // The suggested pattern splices MARKDOWN_GLOB_SUFFIX rather than a literal `*.md`, because the
    // count beside it was produced with MARKDOWN_EXTENSIONS: a hardcoded `.md` tail would advertise
    // a pattern that lints fewer files than the number in the same sentence (P13.05 / W-09).
    const advice = includeWillBeWritten
      ? `The scan never proposes a dot-directory as a doc cluster, so no include pattern above ` +
        `names one; add a pattern such as "${hidden[0]!.path}/**/${MARKDOWN_GLOB_SUFFIX}" to lint it.`
      : `The scan never proposes a dot-directory as a doc cluster, but no include will be written ` +
        `either, so the dot-matching **/*.md default stays in force and the .md files among these ` +
        `are linted.`;
    lines.push(
      `  hidden directories: ${pluralize(total, "Markdown file", "Markdown files")} in ` +
        `${pluralize(hidden.length, "directory", "directories")} whose name starts with a dot — ` +
        `${named}. ${advice}`,
    );
  }

  if (noise.length > 0) {
    lines.push(
      `  build and dependency directories: ${pluralize(noise.length, "directory", "directories")} ` +
        `skipped by name, contents not counted — ${formatCappedList(prunedBaseNames(noise))}.`,
    );
  }

  if (gitignored.length > 0) {
    lines.push(
      `  gitignored directories: ${pluralize(gitignored.length, "directory", "directories")} ` +
        `skipped, contents not counted — ${formatCappedList(prunedBaseNames(gitignored))}.`,
    );
  }

  return lines.length === 0 ? [] : ["Excluded from the scan:", ...lines];
}

/**
 * Deterministic, human-readable preview of the confirmed draft: existing-config disposition,
 * package manager, include globs (from `buildConfigPreview`, so the printed list matches exactly
 * what P6.04 would serialize), the scan-exclusion disclosure, and rules grouped by category with
 * their per-rule rationale.
 *
 * `merge` is additive/existing-wins (P6.03's locked contract): it only ever appends new `rules[]`
 * entries and must never touch `include`/`exclude`/`settings`. So a merge preview omits the
 * `Include (...)` section entirely — showing clusters there would imply `include` is changing,
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
      // omits the key and leaves the tool's `**/*.md` default in force (audit L-9).
      lines.push(
        selections.clustersWereOffered
          ? '  (none selected — an empty "include" will be written, so no files will be linted)'
          : "  (none — no Markdown clusters detected; include will be omitted, so the default **/*.md applies)",
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
    // Same three-valued `include` decision `runInitCommand` makes before writing: the key is omitted
    // only when nothing was selected *and* nothing was offered, and that is the one case where the
    // hidden files end up linted by the default rather than skipped.
    const exclusions = formatScanExclusions(
      selections.pruning,
      preview.include.length > 0 || selections.clustersWereOffered,
    );
    if (exclusions.length > 0) {
      lines.push("", ...exclusions);
    }
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

  return `${lines.join("\n")}\n`;
}

// The workflow file location, as path segments joined via path.join for a Windows-correct write. Its
// user-visible form is derived as a project-relative POSIX path at the write site (toRepoRelative).
const CI_WORKFLOW_PATH_SEGMENTS = [
  ".github",
  "workflows",
  "wastech-mdlint.yml",
] as const;

// Fallback project-root markers, used only when there is no `.git` above the write dir. A valid
// non-git project still has `package.json`/`node_modules` at its root.
const PROJECT_ROOT_MARKERS = ["package.json", "node_modules"] as const;

// Walk up from `startDir` to the first ancestor for which `matches` holds; undefined at the FS root
// or once the walk reaches `boundary` (checked, but never crossed — see findRepositoryRoot/
// findInstalledSchemaDir for why the caller always passes the user's home directory here).
async function findAncestor(
  startDir: string,
  matches: (directory: string) => Promise<boolean>,
  boundary: string,
): Promise<string | undefined> {
  let directory = path.resolve(startDir);
  const resolvedBoundary = path.resolve(boundary);

  for (;;) {
    if (directory === resolvedBoundary) {
      return undefined;
    }
    if (await matches(directory)) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

/**
 * Resolve the root that anchors the CI workflow and user-visible relative paths. The repository root
 * (`.git`) wins whenever one exists — GitHub loads workflows only from the *repo* root, so a nested
 * workspace-package run (`packages/foo`) must anchor at the repo root, never at `packages/foo`. Only
 * when there is no git root above the write dir does it fall back to the nearest `package.json`/
 * `node_modules` (a valid non-git project). Undefined outside any recognizable project.
 *
 * The walk stops at (and never accepts) the user's home directory: `init` bootstraps a *new* project,
 * so its target commonly has no `.git`/`package.json` of its own yet, and a great many developer
 * machines have an unrelated `.git` at `$HOME` (a dotfiles repo). Without this bound, running `init`
 * anywhere under such a home directory would silently anchor the CI-workflow write — a real file on
 * disk — at `$HOME` instead of the target project. Capping at `$HOME` trades away the rare legitimate
 * case of a project rooted exactly at `$HOME` for never writing outside the user's intended target.
 */
async function findRepositoryRoot(
  startDir: string,
): Promise<string | undefined> {
  const homeDir = os.homedir();
  const gitRoot = await findAncestor(
    startDir,
    (directory) => fileExists(path.join(directory, ".git")),
    homeDir,
  );
  if (gitRoot !== undefined) {
    return gitRoot;
  }
  return findAncestor(
    startDir,
    async (directory) => {
      for (const marker of PROJECT_ROOT_MARKERS) {
        if (await fileExists(path.join(directory, marker))) {
          return true;
        }
      }
      return false;
    },
    homeDir,
  );
}

/**
 * Walk up from `startDir` for the directory whose `node_modules/@wastech-mdlint/cli/schema.json`
 * actually exists on disk — the real installed schema, wherever the package manager hoisted it.
 * Returns that directory, or undefined when the package is not installed (the ordinary `npx` case,
 * and a common one in tests / before `npm install`) or the walk reaches the user's home directory
 * (same unrelated-ancestor concern as `findRepositoryRoot`). `undefined` means "no package schema
 * ref": the caller generates a project-local `./schema.json` rather than anchoring on a project
 * root whose `node_modules/@wastech-mdlint/cli/schema.json` does not exist (audit L-10).
 */
async function findInstalledSchemaDir(
  startDir: string,
): Promise<string | undefined> {
  return findAncestor(
    startDir,
    (directory) => fileExists(path.join(directory, ...PACKAGE_SCHEMA_SEGMENTS)),
    os.homedir(),
  );
}

/**
 * Outcome of the opt-in CI-workflow write. `path` is a repository-relative POSIX path. `"failed"`
 * exists because this write happens *after* the config and schema are already committed: dropping the
 * whole summary on its failure would leave an already-mutated repo looking untouched, so the failure
 * becomes a summary line (plus a non-zero exit) instead of a thrown error.
 *
 * `"kept"` and `"unsafe-config-path"` are the two cases where the offer is withheld by the tool
 * rather than declined by the user (audit L-11): both used to return `undefined`, which the summary
 * renders as no line at all, so a run that quietly skipped the workflow looked identical to one that
 * was never eligible for it. Neither is a failure — nothing was attempted and nothing is broken — so
 * they report without affecting the exit code. A user saying "no" stays `undefined`: they already
 * know what they chose.
 */
export type CiWorkflowOutcome =
  | { kind: "written"; path: string }
  | { kind: "failed"; path: string; code?: string }
  | { kind: "kept"; path: string }
  | { kind: "unsafe-config-path"; path: string };

/**
 * Offer — and, if accepted, write — the opt-in CI workflow (I6, deliverable 3). Only called from the
 * confirmed config-write branch of `runInitCommand` — `skip` returns earlier and never reaches this,
 * so `--with-ci-workflow` has no effect when the existing config is left untouched (skip is a strict
 * no-write outcome). Never overwrites an existing workflow. Anchors at the project root (where GitHub
 * loads workflows) and points the workflow at `configAbsPath` relative to that root. Returns the
 * write outcome, or undefined when the offer was declined/withheld and nothing was attempted.
 */
async function offerCiWorkflow(params: {
  repoRoot: string;
  configAbsPath: string;
  yes: boolean;
  withCiWorkflow: boolean | undefined;
  prompter: InitPrompter;
}): Promise<CiWorkflowOutcome | undefined> {
  const { repoRoot, configAbsPath, yes, withCiWorkflow, prompter } = params;

  // Under `--yes` the flag fully decides (mirroring `--on-existing`), so do no filesystem work when
  // it is off; an interactive run always prompts.
  if (yes && withCiWorkflow !== true) {
    return undefined;
  }

  // Omit the `--config` argument when the config sits at the project root — the CLI's walk-up finds
  // it there; otherwise pass its project-root-relative POSIX path.
  const configFromRoot = normalizeRelativePath(
    path.relative(repoRoot, configAbsPath),
  );
  // Resolved before the guards below so both of them can name the workflow they declined to write.
  const ciWorkflowPath = path.join(repoRoot, ...CI_WORKFLOW_PATH_SEGMENTS);
  const relativeWorkflowPath = normalizeRelativePath(
    path.relative(repoRoot, ciWorkflowPath),
  );

  // A line terminator in the path can't be represented safely in the workflow's shell command, and
  // stripping it would mis-target the config — so decline this opt-in feature rather than emit a
  // broken/mis-pointing workflow (an extreme but legal path edge; the config itself is still written).
  if (/[\r\n]/.test(configFromRoot)) {
    return { kind: "unsafe-config-path", path: relativeWorkflowPath };
  }

  if (await fileExists(ciWorkflowPath)) {
    return { kind: "kept", path: relativeWorkflowPath };
  }

  // This prompt runs AFTER the config/schema are already on disk. A Ctrl+C here must not unwind the
  // whole command (that would exit without the write summary and make an already-mutated repo look
  // untouched) — treat cancellation as "no workflow" and let the write summary print. Matched on
  // `.name` (not `instanceof`), the version-stable @inquirer convention used in program.ts.
  let wantsCi: boolean;
  if (yes) {
    wantsCi = true;
  } else {
    try {
      wantsCi = await prompter.confirmCiWorkflow();
    } catch (error) {
      if (error instanceof Error && error.name === "ExitPromptError") {
        return undefined;
      }
      throw error;
    }
  }
  if (!wantsCi) {
    return undefined;
  }

  const configArg =
    configFromRoot === CONFIG_FILE_NAME ? undefined : configFromRoot;
  try {
    // The atomic helper deliberately leaves directory creation to its caller, and `.github/workflows`
    // routinely does not exist yet — a failure here is reported the same way a failed write is, just
    // without an errno to attribute it to.
    await mkdir(path.dirname(ciWorkflowPath), { recursive: true });
  } catch {
    return { kind: "failed", path: relativeWorkflowPath };
  }
  const written = await writeFilesAtomic([
    { path: ciWorkflowPath, content: buildCiWorkflowYaml(configArg) },
  ]);
  return written.ok
    ? { kind: "written", path: relativeWorkflowPath }
    : { kind: "failed", path: relativeWorkflowPath, code: written.code };
}

/**
 * Outcome of the project-local `schema.json` write, decided by `resolveSchemaWriteOutcome` before
 * any filesystem write happens. `path` is a repository-relative POSIX path; `reason` is carried
 * straight through from `generateInitConfig` so the summary never guesses why the file exists.
 */
export type SchemaWriteOutcome = {
  kind: "written" | "unchanged" | "kept" | "overwritten" | "unreadable";
  path: string;
  reason: ProjectSchemaReason;
};

/**
 * Guards the project-local `schema.json` write with the same `--on-existing` signal that already
 * governs the config write (H-4: this write previously had no guard at all, unlike the sibling
 * CI-workflow write). Byte-compares an existing file against the freshly generated text first:
 * identical bytes mean there is nothing to preserve, so a repeat `init` run reports "unchanged"
 * (no write) instead of the "kept" warning — that warning is reserved for a real divergence worth
 * flagging. Only once the bytes actually differ does `"overwrite"` bypass the guard; `"merge"` and
 * `"none"` both leave a differing file untouched. Pure so the decision itself — not just its
 * string rendering — is directly testable.
 *
 * `existingSchemaUnreadable` takes precedence over every other check and is a required field (P11.09):
 * the read that produces `existingSchemaText` degrades *any* failure to `undefined`, which used to be
 * harmless because the write would then fail identically. Atomic writes changed that — `rename` needs
 * write permission on the *directory*, not on the target — so without this signal a present-but-
 * unreadable `schema.json` would be silently replaced, exactly the implicit file-clobbering (I1) the
 * guard exists to prevent.
 *
 * `reason` narrows the one destructive outcome. `--on-existing overwrite` is a disposition for the
 * *config* — the user never named `schema.json` — so it may only reach a pre-existing schema whose
 * contents this config actually determines, i.e. `"custom-rules"`. Under `"no-installed-package"`
 * the file is generated purely as a resolvable target for `$schema`, and `schema.json` is a common
 * name for something else entirely (an OpenAPI document, a product schema), so a differing file
 * there degrades to `"kept"`: nothing the user asked for depends on replacing it.
 */
export function resolveSchemaWriteOutcome(params: {
  existingConfigAction: ExistingConfigAction | "none";
  existingSchemaText: string | undefined;
  existingSchemaUnreadable: boolean;
  generatedSchemaText: string;
  reason: ProjectSchemaReason;
}): { shouldWrite: boolean; kind: SchemaWriteOutcome["kind"] } {
  const {
    existingConfigAction,
    existingSchemaText,
    existingSchemaUnreadable,
    generatedSchemaText,
    reason,
  } = params;
  if (existingSchemaUnreadable) {
    return { shouldWrite: false, kind: "unreadable" };
  }
  if (existingSchemaText === undefined) {
    return { shouldWrite: true, kind: "written" };
  }
  if (existingSchemaText === generatedSchemaText) {
    return { shouldWrite: false, kind: "unchanged" };
  }
  if (existingConfigAction === "overwrite" && reason === "custom-rules") {
    return { shouldWrite: true, kind: "overwritten" };
  }
  return { shouldWrite: false, kind: "kept" };
}

// The parenthetical every schema line carries. It replaces the previous hardcoded "custom rules
// present", which stopped being true once the `npx` fallback started generating the same file for a
// config with no custom rules at all (audit L-10).
function describeProjectSchemaReason(reason: ProjectSchemaReason): string {
  return reason === "custom-rules"
    ? "custom rules present"
    : "no installed package schema to point at";
}

// What to do about an existing `schema.json` init refused to replace. The advice cannot be one
// sentence for both reasons, because the two describe different files. Under `custom-rules` the file
// init would generate is the one this config needs, so the fix is to get out of its way. Under
// `no-installed-package` init only wanted the *name*: the file already there is almost certainly an
// unrelated schema, and the config's `$schema` is now pointed at it — which is the honest thing to
// say, rather than inviting a regeneration over a document init has no claim on.
function describeKeptSchemaAdvice(reason: ProjectSchemaReason): string {
  return reason === "custom-rules"
    ? "The config's $schema still points at it, so it may not validate the current rules until " +
        "they match. Remove or rename it and re-run init with --on-existing merge to regenerate it."
    : "The config's $schema points at it even though init did not generate it, so this config is " +
        "validated against whatever that file describes. Repoint $schema by hand, or move that " +
        "file aside and re-run init to generate one.";
}

function formatSchemaWriteLine(schema: SchemaWriteOutcome): string {
  const why = describeProjectSchemaReason(schema.reason);

  switch (schema.kind) {
    case "written":
      return `Wrote project-local schema ${schema.path} (${why}).`;
    case "unchanged":
      return `Project-local schema ${schema.path} is already up to date (${why}).`;
    case "kept":
      return (
        `Kept existing schema.json at ${schema.path} (${why}) — its contents ` +
        "differ from what init would generate, so it was left in place. " +
        describeKeptSchemaAdvice(schema.reason)
      );
    case "overwritten":
      return `Overwrote schema.json at ${schema.path} (${why}), per --on-existing overwrite.`;
    case "unreadable":
      return (
        `Kept existing schema.json at ${schema.path} (${why}) — it exists but could ` +
        "not be read, so init cannot tell whether it matches and will not replace a file it is " +
        "unable to inspect (check its permissions). " +
        describeKeptSchemaAdvice(schema.reason)
      );
    default: {
      const exhaustiveCheck: never = schema.kind;
      return exhaustiveCheck;
    }
  }
}

function formatCiWorkflowLine(ciWorkflow: CiWorkflowOutcome): string {
  switch (ciWorkflow.kind) {
    case "written":
      return `Wrote CI workflow ${ciWorkflow.path}.`;
    case "failed": {
      const reason =
        ciWorkflow.code === undefined ? "" : ` (${ciWorkflow.code})`;
      return (
        `Could not write the CI workflow ${ciWorkflow.path}${reason} — the config above was still ` +
        "written, and no partial workflow file was left behind. Re-run init to retry it, or add " +
        "the workflow by hand."
      );
    }
    case "kept":
      return (
        `Kept the existing CI workflow ${ciWorkflow.path} — init never overwrites it. Check that ` +
        "it still points at the config written above."
      );
    case "unsafe-config-path":
      return (
        `Skipped the CI workflow ${ciWorkflow.path} — the config path contains a line terminator, ` +
        "which cannot be embedded safely in the workflow's shell command. The config above was " +
        "still written; add the workflow by hand, or rename the directory."
      );
    default: {
      const exhaustiveCheck: never = ciWorkflow;
      return exhaustiveCheck;
    }
  }
}

/**
 * Deterministic write-outcome summary: how the config was written (fresh/merge), rule counts, which
 * `$schema` it points at, and where the config / project schema / CI workflow landed. Every path is
 * a repository-relative POSIX path (so a subdirectory run reports `docs/wastech-mdlint.config.json`,
 * not a bare filename). Pure and exported so it can be asserted directly, mirroring `formatDraftSummary`.
 */
export function formatWriteSummary(params: {
  action: InitConfigAction;
  result: GeneratedInitConfig;
  configPath: string;
  // Whether the write just dropped JSONC comments the previous file carried (audit L-8). Required,
  // not optional, so a new call site cannot silently omit the one destructive part of a merge.
  commentsDropped: boolean;
  schema?: SchemaWriteOutcome;
  ciWorkflow?: CiWorkflowOutcome;
}): string {
  const { action, result, configPath, commentsDropped, schema, ciWorkflow } =
    params;
  const lines: string[] = [];

  if (action === "merge") {
    lines.push(
      `Merged ${configPath}: ${result.addedRuleCount} new rule(s) appended (${result.totalRuleCount} total).`,
    );
  } else {
    lines.push(`Wrote ${configPath} with ${result.totalRuleCount} rule(s).`);
  }

  if (commentsDropped) {
    lines.push(`Note: ${COMMENT_LOSS_NOTE}`);
  }
  // A config that lints nothing is a legitimate outcome of deselecting every cluster, but a silent
  // one would look exactly like a broken install the first time `lint` reports zero files.
  if (result.wroteEmptyInclude) {
    lines.push(
      'Note: "include" was written as an empty list, because no doc cluster was selected — ' +
        "no files will be linted until you add a pattern to it.",
    );
  }

  lines.push(`Schema: ${result.schemaRef}`);
  if (schema !== undefined) {
    lines.push(formatSchemaWriteLine(schema));
  }
  if (ciWorkflow !== undefined) {
    lines.push(formatCiWorkflowLine(ciWorkflow));
  }

  return `${lines.join("\n")}\n`;
}

/**
 * The partial-write summary (P11.09, audit M-5): a write that failed must still tell the user what
 * landed and what did not, on stdout, instead of leaving them to guess from a bare stderr errno.
 * `written`/`notWritten`/`failedPath` are repository-relative POSIX paths; the two lists are sorted
 * here (their order is incidental once the commit sequence has already happened) so the output is
 * deterministic.
 *
 * Only the errno `code` is rendered, never the raw fs message: Node's `rename` error embeds two
 * absolute, platform-native paths plus the random temp file name.
 */
export function formatWriteFailureSummary(params: {
  written: string[];
  notWritten: string[];
  failedPath: string;
  code?: string;
}): string {
  const reason = params.code === undefined ? "" : ` (${params.code})`;
  const lines: string[] = [
    `Write failed: could not replace ${params.failedPath}${reason}.`,
  ];

  const written = [...params.written].sort(compareStrings);
  lines.push(
    written.length === 0
      ? "Written: nothing."
      : `Written: ${written.join(", ")}.`,
  );

  // Always non-empty in practice (it holds at least the file that failed), but guarded so this pure
  // formatter never renders a dangling "Not written: ." line.
  const notWritten = [...params.notWritten].sort(compareStrings);
  if (notWritten.length > 0) {
    lines.push(
      `Not written: ${notWritten.join(", ")}. Every file listed as not written is ` +
        "byte-unchanged on disk: init stages each file next to its target and renames it into " +
        "place, so a failed write never truncates or partially replaces an existing file.",
    );
  }

  lines.push("Fix the cause and re-run init.");
  return `${lines.join("\n")}\n`;
}

/**
 * The "nothing written" outcome for the one abort case: a `merge` whose existing config could not be
 * read/parsed/validated. The deliverable requires never modifying or dropping an existing entry and
 * writing only a valid config — both unprovable when the existing config can't be parsed or would be
 * rejected by the loader — so the safe answer is to write nothing.
 * `configPath` is a normalized POSIX path, relative to the same directory the draft summary's
 * existing-config line already used (the original target directory, not necessarily the repo root).
 */
export function formatNotWrittenSummary(
  configPath: string | undefined,
): string {
  const location = configPath ?? CONFIG_FILE_NAME;
  return (
    `Not written: the existing config at ${location} could not be read, parsed, or validated, so a ` +
    "merge cannot guarantee a valid config with its existing entries preserved. Fix or remove it, " +
    "then re-run init.\n"
  );
}

/**
 * Orchestrates the init flow end to end: resolve existing-config disposition, scan, confirm
 * clusters/package-manager, re-run inference against the confirmed cluster subset (so global gates
 * and the cycle heuristic reflect what the user actually kept), confirm categories, diff against an
 * existing config when merging, and confirm the draft. On confirmation, writes the config (and an
 * optional project-local schema + CI workflow); a `merge` whose existing config is unreadable aborts
 * the write entirely rather than risk dropping an entry it cannot even parse.
 *
 * When no `[path]` was explicitly typed, a config found at a strict ancestor of `options.cwd`
 * governs the whole run (scan/inference/write all re-root to that ancestor's directory). When
 * `options.pathWasExplicit` is true, only a config found exactly at `options.cwd` counts as
 * existing — an ancestor's config is left untouched and reported as "none found" for this target
 * (H-3, P11.04).
 */
export async function runInitCommand(
  options: InitCommandOptions,
  prompter: InitPrompter,
): Promise<RunInitCommandResult> {
  const discoveredConfigPath = await findConfig(options.cwd);
  const targetDir = path.resolve(options.cwd);

  // An explicit `[path]` names the exact directory init must operate on — a config found at a
  // strict ancestor of that directory does not govern it, and must not be silently re-rooted onto
  // (H-3). Only a config found exactly at the target counts as this run's existing config in that
  // case. A bare/default invocation (no `[path]` typed) keeps the original re-root behavior below.
  const existingConfigPath =
    options.pathWasExplicit &&
    discoveredConfigPath !== undefined &&
    path.dirname(discoveredConfigPath) !== targetDir
      ? undefined
      : discoveredConfigPath;

  // `findConfig` walks up to an ancestor directory when the target is a subdirectory of a repo that
  // already has a config — the config being merged/overwritten governs from *its own* directory, so
  // the whole flow re-roots there too. Scanning/inferring against the original target instead would
  // produce include globs/rule scopes relative to the wrong root and could miss a lockfile that only
  // lives at the real root. A no-op when the config is already at the target directory.
  const cwd =
    existingConfigPath === undefined
      ? options.cwd
      : path.dirname(existingConfigPath);
  // Relative to the ORIGINAL target directory, not `cwd` above — so a config found at an ancestor
  // renders honestly as `../…` instead of the bare filename the previous re-pointed computation
  // produced (H-3). Repository-relative POSIX path (public-output invariant), computed up front so
  // both the existing-config prompt and the printed summary use it instead of the raw absolute path.
  const relativeConfigPath =
    existingConfigPath === undefined
      ? undefined
      : normalizeRelativePath(path.relative(targetDir, existingConfigPath));

  let existingConfigAction: ExistingConfigAction | "none" = "none";

  if (existingConfigPath !== undefined && relativeConfigPath !== undefined) {
    existingConfigAction = options.yes
      ? (options.onExisting ?? DEFAULT_EXISTING_CONFIG_ACTION)
      : await prompter.resolveExistingConfigAction(relativeConfigPath);

    if (existingConfigAction === "skip") {
      // `skip` must never touch the filesystem (plan invariant): no config, schema, or CI workflow
      // write — the CI-workflow offer belongs only to the confirmed config-write branch below.
      return {
        output: `${DRAFT_SUMMARY_HEADER}\n\nskipped — existing config left untouched.\n`,
        outcome: "skipped",
      };
    }
  }

  const scanResult = await scanRepository({ cwd });

  // Separates "the user turned every cluster down" from "the scan found nothing to turn down" — the
  // two need opposite `include` values further down (audit L-9), and `confirmedClusters` alone
  // cannot tell them apart once both have collapsed to an empty array.
  const clustersWereOffered = scanResult.clusters.length > 0;

  const confirmedClusters = options.yes
    ? scanResult.clusters
    : clustersWereOffered
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
  const inference = await inferRuleSet({
    cwd,
    clusters: confirmedClusters,
    registry: ruleRegistry,
  });

  const groupedByCategory = groupInferredRulesByCategory(inference.rules);
  // Only categories with >=1 inferred rule are offered — the other built-ins have a required
  // option with no safe way to derive it from sampled files (see rule-inference.ts's own note on
  // the 7 gated ids), so a category with nothing to add would be a dead, confusing checkbox entry.
  const categoriesWithRules = (
    Object.keys(groupedByCategory) as RuleCategory[]
  ).sort(compareStrings);

  const selectedCategories = options.yes
    ? categoriesWithRules
    : categoriesWithRules.length > 0
      ? await prompter.selectCategories(categoriesWithRules)
      : [];

  const selectedCategorySet = new Set(selectedCategories);
  let selectedRules = inference.rules.filter((rule) =>
    selectedCategorySet.has(rule.category),
  );
  let existingConfigUnreadable = false;
  // The single parsed snapshot of the existing config, read once and reused by both the diff below
  // and the merge write later — re-reading after confirmation could race with a concurrent edit and
  // (on a second-read failure) silently drop the very entries a merge must preserve.
  let existingDocument: ParsedExistingConfig | undefined;

  if (existingConfigPath !== undefined && existingConfigAction === "merge") {
    existingDocument = await readExistingConfigDocument(
      cwd,
      existingConfigPath,
    );
    const { ruleIds, mergeable } = extractExistingRuleIds(existingDocument.raw);
    // Additive merge preserves the existing content verbatim, so the written config is only valid if
    // the existing one already loads (append-only adds registry-valid inferred rules). Validate it
    // through the real loader — an unknown top-level key, unknown rule id, or invalid preserved
    // options must abort the merge, never be reported as a successful write of a config that
    // `loadConfiguration` would then reject.
    existingConfigUnreadable =
      !existingDocument.parsed ||
      !mergeable ||
      !(await existingConfigLoads(cwd, existingConfigPath));
    selectedRules = diffAgainstExistingRuleIds(ruleIds, selectedRules).newRules;
  }

  // Only a merge rebuilds an existing file, so only a merge can lose its comments; an `overwrite`
  // discards the whole file by explicit request and needs no separate warning.
  const existingConfigHasComments =
    existingConfigAction === "merge" && existingDocument?.hasComments === true;

  const selections: ConfirmedInitSelections = {
    existingConfigAction,
    packageManager,
    clusters: confirmedClusters,
    rules: selectedRules,
    newRuleIds: selectedRules.map((rule) => rule.rule),
    existingConfigUnreadable,
    clustersWereOffered,
    existingConfigHasComments,
    pruning: scanResult.pruned,
  };

  const summary = formatDraftSummary(selections, relativeConfigPath);

  // `--yes` never prompts, so `summary` has not been shown to anyone yet and must be prepended to
  // whatever the write step produces. Interactively, `confirmDraft` owns displaying `summary` (see
  // its contract above), so the write step's output is returned on its own to avoid a double print.
  const confirmed = options.yes ? true : await prompter.confirmDraft(summary);
  if (!confirmed) {
    return {
      output: "Aborted: configuration not confirmed.\n",
      outcome: "declined",
    };
  }

  const composeOutput = (suffix: string): string =>
    options.yes ? `${summary}\n${suffix}` : suffix;

  // The repository root anchors every user-visible path so a subdirectory run reports where files
  // actually landed (e.g. `docs/wastech-mdlint.config.json`). findRepositoryRoot prefers the `.git`
  // root (a nested workspace package must still anchor at the real repo root, not `packages/foo`)
  // and only falls back to a nearer `package.json`/`node_modules` outside a git repo. It walks *up*
  // from the write dir, so the root is always an ancestor and reported paths never contain a "..".
  // Falls back to `cwd` outside any recognizable project (best effort — no parent anchor to report).
  const repoRoot = (await findRepositoryRoot(cwd)) ?? cwd;
  const toRepoRelative = (absolutePath: string): string =>
    normalizeRelativePath(path.relative(repoRoot, absolutePath));

  // A merge that cannot read/parse the existing config aborts: the deliverable's "never modify or
  // drop an existing entry" is unprovable when the entries can't be parsed, so writing nothing is
  // the only safe outcome (no config, no schema, no CI workflow touch the disk here).
  if (existingConfigAction === "merge" && existingConfigUnreadable) {
    // `relativeConfigPath` (not `toRepoRelative(existingConfigPath)`) so this message names the same
    // path the draft summary above already showed — target-directory-relative, can read `../…` — and
    // never mismatches it for the same file (H-3: the two used different bases before this fix).
    return {
      output: composeOutput(formatNotWrittenSummary(relativeConfigPath)),
      // An operational failure, not a deliberate no-write: the user confirmed the draft and asked for
      // a merge, and it is the *state of their file* that made it impossible. Exiting 0 here made a
      // CI merge step that produced nothing report success (P14.02, W-13) — `--on-existing skip`
      // above is the outcome that legitimately writes nothing.
      outcome: "invalid-existing-config",
    };
  }

  const action: InitConfigAction =
    existingConfigAction === "merge" ? "merge" : "fresh";

  // Reuse the snapshot read above. The unreadable-merge abort has already returned, so on a merge
  // that reaches here `existingDocument.raw` is guaranteed defined (parsed + additively mergeable) —
  // no second read, no window for a fresh-overwrite that drops the existing keys.
  const existing: ExistingConfigDocument | undefined =
    action === "merge" && existingDocument?.raw !== undefined
      ? { raw: existingDocument.raw }
      : undefined;

  const configPath = path.join(cwd, CONFIG_FILE_NAME);

  // The package `$schema` ref is computed relative to the config's own directory (not a fixed
  // literal), anchored on the *actual* installed schema, so a subdirectory config wires
  // `../node_modules/...` instead of a dead path nested under it. When nothing is installed — the
  // ordinary `npx` case — there is no anchor and no ref: the previous project-root fallback emitted
  // `./node_modules/@wastech-mdlint/cli/schema.json` for a file that does not exist (audit L-10).
  // `undefined` tells `generateInitConfig` to generate and point at a project-local `./schema.json`.
  const schemaAnchor = await findInstalledSchemaDir(cwd);
  const preview = buildConfigPreview(confirmedClusters, selectedRules);
  // `include` is only meaningful for a fresh write; generateInitConfig ignores it under "merge".
  // Three-valued (audit L-9): an empty selection is written as a literal `[]` only when clusters
  // were actually offered and turned down. When the scan found none, the key is omitted so the
  // tool's own `**/*.md` default applies, which is what a repo with no recognizable doc cluster
  // wants — inverting a deliberate "none of these" into that same default is the bug.
  const include =
    preview.include.length > 0
      ? preview.include
      : clustersWereOffered
        ? []
        : undefined;
  const result = generateInitConfig({
    action,
    existing,
    include,
    newRules: selectedRules,
    packageSchemaRef:
      schemaAnchor === undefined
        ? undefined
        : resolvePackageSchemaRef(cwd, schemaAnchor),
  });

  // Staged as one batch and committed schema-first, config-last (P11.09, audit M-5). The order is
  // load-bearing: the config is what points at the schema, so if the schema rename fails the old
  // config — and its old, still-accurate `$schema` — survives untouched. The previous config-first
  // order produced exactly the audit's repro (a rewritten config pointing at a stale schema).
  // `writeFilesAtomic` stages every temp before renaming any of them, so the common failure (no space,
  // no permission on the directory) leaves the repository entirely untouched.
  const writes: AtomicFileWrite[] = [];
  let schemaOutcome: SchemaWriteOutcome | undefined;
  if (result.projectSchema !== undefined) {
    const schemaPath = path.join(cwd, result.projectSchema.fileName);
    const schemaRelativePath = toRepoRelative(schemaPath);
    // A full read (not just fileExists) so an identical repeat run can report "unchanged" rather
    // than the "kept" warning — any read failure (missing file, permission error) degrades to
    // undefined, the same "treat it as absent" behavior fileExists uses elsewhere in this file.
    const existingSchemaText = await readFile(schemaPath, "utf8").catch(
      () => undefined,
    );
    const decision = resolveSchemaWriteOutcome({
      existingConfigAction,
      existingSchemaText,
      // Separates "absent" from "present but unreadable", which the read above collapses into one
      // `undefined`. Under the old truncate-and-write that conflation was harmless (an unreadable
      // file usually failed the write too); a temp+rename commit only needs write permission on the
      // directory, so without this the guard would happily replace a file it could not even read.
      existingSchemaUnreadable:
        existingSchemaText === undefined && (await fileExists(schemaPath)),
      generatedSchemaText: result.projectSchema.text,
      // Gates the one destructive outcome: only a schema whose *contents* this config determines
      // (custom rules) may be replaced under `--on-existing overwrite`. The `npx` fallback merely
      // needs some resolvable target, so it must never clobber a `schema.json` that was already
      // there for unrelated reasons.
      reason: result.projectSchema.reason,
    });
    if (decision.shouldWrite) {
      writes.push({ path: schemaPath, content: result.projectSchema.text });
    }
    schemaOutcome = {
      kind: decision.kind,
      path: schemaRelativePath,
      reason: result.projectSchema.reason,
    };
  }
  writes.push({ path: configPath, content: result.configText });

  const writeResult = await writeFilesAtomic(writes);
  if (!writeResult.ok) {
    // Return the failure summary on stdout rather than throwing: the audit's complaint was an *empty*
    // stdout on a failed write, leaving the user unable to tell what state their repo was in. The
    // CI-workflow offer is deliberately skipped — prompting to add a workflow for a config that was
    // never written would be nonsense.
    return {
      output: composeOutput(
        formatWriteFailureSummary({
          written: writeResult.written.map(toRepoRelative),
          notWritten: writeResult.notWritten.map(toRepoRelative),
          failedPath: toRepoRelative(writeResult.failedPath),
          code: writeResult.code,
        }),
      ),
      outcome: "write-failed",
    };
  }

  const ciWorkflow = await offerCiWorkflow({
    repoRoot,
    configAbsPath: configPath,
    yes: options.yes,
    withCiWorkflow: options.withCiWorkflow,
    prompter,
  });

  return {
    output: composeOutput(
      formatWriteSummary({
        action,
        result,
        configPath: toRepoRelative(configPath),
        commentsDropped: existingConfigHasComments,
        schema: schemaOutcome,
        ciWorkflow,
      }),
    ),
    // The config and schema landed; only the opt-in workflow the user asked for did not. Still a
    // failed write, so the exit code has to say so — the summary above names which file it was.
    outcome:
      ciWorkflow?.kind === "failed" ? "ci-workflow-write-failed" : "written",
  };
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

// True when the existing config fully loads (root schema + rule resolution) — the same validation
// `loadConfiguration` runs at lint time. A `merge` gates on this so it never rewrites a config that
// preserves an already-invalid key/rule/options and then reports success (acceptance: init writes a
// valid config). Any thrown ConfigError (or other read failure) counts as "does not load".
async function existingConfigLoads(
  cwd: string,
  configPath: string,
): Promise<boolean> {
  try {
    await loadConfiguration({ cwd, explicitConfigPath: configPath });
    return true;
  } catch {
    return false;
  }
}
