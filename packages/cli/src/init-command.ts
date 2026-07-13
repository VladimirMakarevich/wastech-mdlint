import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { type ParseError, parse as parseJsonc } from "jsonc-parser";

import {
  buildCiWorkflowYaml,
  canonicalizeRuleId,
  CONFIG_FILE_NAME,
  findConfig,
  generateInitConfig,
  identifyExistingRule,
  inferRuleSet,
  loadConfiguration,
  normalizeRelativePath,
  PACKAGE_SCHEMA_SEGMENTS,
  resolvePackageSchemaRef,
  ruleRegistry,
  scanRepository,
  type DetectedPackageManager,
  type DocCluster,
  type ExistingConfigDocument,
  type GeneratedInitConfig,
  type InferredRule,
  type InitConfigAction,
  type RuleCategory,
  type RuleConfigEntry
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
  resolveExistingConfigAction(configPath: string): Promise<ExistingConfigAction>;
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
  // Whether the user actually confirmed the draft (via `--yes` or `confirmDraft`) — distinct from
  // whether anything was *written*: the unreadable-merge abort still sets this `true` because the
  // draft was confirmed, even though the write itself was then withheld for an unrelated safety reason.
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

export type ParsedExistingConfig = {
  // The parsed JSONC root object, or undefined when the file could not be read or did not parse to
  // an object. `parsed` mirrors that: false ⇒ `raw` is undefined.
  raw: Record<string, unknown> | undefined;
  parsed: boolean;
};

/**
 * Shared JSONC read of an existing config's root object. Deliberately not a full `lintConfigSchema`
 * validation (that belongs to `loadConfiguration`) — a committed config that doesn't fully validate
 * must still be diffable for the merge preview, and a malformed file must degrade to `parsed: false`
 * (so callers can warn/abort) rather than crash `init`. Both `readExistingRuleIds` (diff preview)
 * and `readExistingConfigDocument` (write path) are thin wrappers over this one read.
 */
async function parseExistingConfigFile(cwd: string, configPath: string): Promise<ParsedExistingConfig> {
  const absoluteConfigPath = path.isAbsolute(configPath) ? configPath : path.resolve(cwd, configPath);

  try {
    const text = await readFile(absoluteConfigPath, "utf8");
    const errors: ParseError[] = [];
    const raw = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });

    if (errors.length > 0 || raw === null || typeof raw !== "object") {
      return { raw: undefined, parsed: false };
    }
    return { raw: raw as Record<string, unknown>, parsed: true };
  } catch {
    return { raw: undefined, parsed: false };
  }
}

/**
 * Derives the canonicalized `rules[].rule` ids from an already-parsed config root, and whether the
 * config can be merged additively (`mergeable`). A present-but-non-array `rules` key cannot be
 * merged, so it degrades the same way an unparsable file does. Pure over one parsed snapshot, so the
 * diff preview and the write path can share a single read without re-parsing.
 */
function extractExistingRuleIds(raw: Record<string, unknown> | undefined): { ruleIds: string[]; mergeable: boolean } {
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
    ids.push(identity.kind === "custom" ? identity.rule.id : identity.canonicalId);
  }
  return { ruleIds: ids, mergeable: true };
}

/**
 * The existing config's canonicalized `rules[].rule` ids for the merge diff preview. `parsed` is
 * false when the file is unreadable/unparsable *or* has a present-but-non-array `rules` key — either
 * case cannot be merged additively, so the caller must not present the diff as authoritative.
 */
export async function readExistingRuleIds(cwd: string, configPath: string): Promise<ExistingRuleIdsResult> {
  const { raw, parsed } = await parseExistingConfigFile(cwd, configPath);
  if (!parsed) {
    return { ruleIds: [], parsed: false };
  }
  const { ruleIds, mergeable } = extractExistingRuleIds(raw);
  return { ruleIds, parsed: mergeable };
}

/**
 * The existing config's parsed root object for the merge *write* path (feeds `generateInitConfig`'s
 * `ExistingConfigDocument`). Only consulted once the diff has already confirmed the file is readable
 * and additively mergeable, so an undefined `raw` here is a guarded, unreachable case rather than a
 * silent fallback.
 */
export async function readExistingConfigDocument(cwd: string, configPath: string): Promise<ParsedExistingConfig> {
  return parseExistingConfigFile(cwd, configPath);
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
        ? `${base} WARNING: the existing config could not be read, parsed, or validated, so this is ` +
            "the full inferred set, not a verified diff — check for duplicates before merging."
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

// The workflow file location, as path segments joined via path.join for a Windows-correct write. Its
// user-visible form is derived as a project-relative POSIX path at the write site (toRepoRelative).
const CI_WORKFLOW_PATH_SEGMENTS = [".github", "workflows", "wastech-mdlint.yml"] as const;

// Fallback project-root markers, used only when there is no `.git` above the write dir. A valid
// non-git project still has `package.json`/`node_modules` at its root.
const PROJECT_ROOT_MARKERS = ["package.json", "node_modules"] as const;

// Walk up from `startDir` to the first ancestor for which `matches` holds; undefined at the FS root
// or once the walk reaches `boundary` (checked, but never crossed — see findRepositoryRoot/
// findInstalledSchemaDir for why the caller always passes the user's home directory here).
async function findAncestor(
  startDir: string,
  matches: (directory: string) => Promise<boolean>,
  boundary: string
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
async function findRepositoryRoot(startDir: string): Promise<string | undefined> {
  const homeDir = os.homedir();
  const gitRoot = await findAncestor(startDir, (directory) => fileExists(path.join(directory, ".git")), homeDir);
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
    homeDir
  );
}

/**
 * Walk up from `startDir` for the directory whose `node_modules/@wastech-mdlint/cli/schema.json`
 * actually exists on disk — the real installed schema, wherever the package manager hoisted it.
 * Returns that directory, or undefined when the package is not installed (a common case in tests /
 * before `npm install`) or the walk reaches the user's home directory (same unrelated-ancestor
 * concern as `findRepositoryRoot`), so the caller can fall back to the project root.
 */
async function findInstalledSchemaDir(startDir: string): Promise<string | undefined> {
  return findAncestor(
    startDir,
    (directory) => fileExists(path.join(directory, ...PACKAGE_SCHEMA_SEGMENTS)),
    os.homedir()
  );
}

/**
 * Offer — and, if accepted, write — the opt-in CI workflow (I6, deliverable 3). Only called from the
 * confirmed config-write branch of `runInitCommand` — `skip` returns earlier and never reaches this,
 * so `--with-ci-workflow` has no effect when the existing config is left untouched (skip is a strict
 * no-write outcome). Never overwrites an existing workflow. Anchors at the project root (where GitHub
 * loads workflows) and points the workflow at `configAbsPath` relative to that root. Returns the
 * project-relative POSIX path written, or undefined when nothing was written.
 */
async function offerCiWorkflow(params: {
  repoRoot: string;
  configAbsPath: string;
  yes: boolean;
  withCiWorkflow: boolean | undefined;
  prompter: InitPrompter;
}): Promise<string | undefined> {
  const { repoRoot, configAbsPath, yes, withCiWorkflow, prompter } = params;

  // Under `--yes` the flag fully decides (mirroring `--on-existing`), so do no filesystem work when
  // it is off; an interactive run always prompts.
  if (yes && withCiWorkflow !== true) {
    return undefined;
  }

  // Omit the `--config` argument when the config sits at the project root — the CLI's walk-up finds
  // it there; otherwise pass its project-root-relative POSIX path.
  const configFromRoot = normalizeRelativePath(path.relative(repoRoot, configAbsPath));
  // A line terminator in the path can't be represented safely in the workflow's shell command, and
  // stripping it would mis-target the config — so decline this opt-in feature rather than emit a
  // broken/mis-pointing workflow (an extreme but legal path edge; the config itself is still written).
  if (/[\r\n]/.test(configFromRoot)) {
    return undefined;
  }

  const ciWorkflowPath = path.join(repoRoot, ...CI_WORKFLOW_PATH_SEGMENTS);
  if (await fileExists(ciWorkflowPath)) {
    return undefined;
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

  const configArg = configFromRoot === CONFIG_FILE_NAME ? undefined : configFromRoot;
  await mkdir(path.dirname(ciWorkflowPath), { recursive: true });
  await writeFile(ciWorkflowPath, buildCiWorkflowYaml(configArg), "utf8");
  return normalizeRelativePath(path.relative(repoRoot, ciWorkflowPath));
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
  schemaPath?: string;
  ciWorkflowPath?: string;
}): string {
  const { action, result, configPath, schemaPath, ciWorkflowPath } = params;
  const lines: string[] = [];

  if (action === "merge") {
    lines.push(
      `Merged ${configPath}: ${result.addedRuleCount} new rule(s) appended (${result.totalRuleCount} total).`
    );
  } else {
    lines.push(`Wrote ${configPath} with ${result.totalRuleCount} rule(s).`);
  }

  lines.push(`Schema: ${result.schemaRef}`);
  if (schemaPath !== undefined) {
    lines.push(`Wrote project-local schema ${schemaPath} (custom rules present).`);
  }
  if (ciWorkflowPath !== undefined) {
    lines.push(`Wrote CI workflow ${ciWorkflowPath}.`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * The "nothing written" outcome for the one abort case: a `merge` whose existing config could not be
 * read/parsed/validated. The deliverable requires never modifying or dropping an existing entry and
 * writing only a valid config — both unprovable when the existing config can't be parsed or would be
 * rejected by the loader — so the safe answer is to write nothing.
 * `configPath` is a repository-relative POSIX path.
 */
export function formatNotWrittenSummary(configPath: string | undefined): string {
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
      // `skip` must never touch the filesystem (plan invariant): no config, schema, or CI workflow
      // write — the CI-workflow offer belongs only to the confirmed config-write branch below.
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
  // The single parsed snapshot of the existing config, read once and reused by both the diff below
  // and the merge write later — re-reading after confirmation could race with a concurrent edit and
  // (on a second-read failure) silently drop the very entries a merge must preserve.
  let existingDocument: ParsedExistingConfig | undefined;

  if (existingConfigPath !== undefined && existingConfigAction === "merge") {
    existingDocument = await readExistingConfigDocument(cwd, existingConfigPath);
    const { ruleIds, mergeable } = extractExistingRuleIds(existingDocument.raw);
    // Additive merge preserves the existing content verbatim, so the written config is only valid if
    // the existing one already loads (append-only adds registry-valid inferred rules). Validate it
    // through the real loader — an unknown top-level key, unknown rule id, or invalid preserved
    // options must abort the merge, never be reported as a successful write of a config that
    // `loadConfiguration` would then reject.
    existingConfigUnreadable =
      !existingDocument.parsed || !mergeable || !(await existingConfigLoads(cwd, existingConfigPath));
    selectedRules = diffAgainstExistingRuleIds(ruleIds, selectedRules).newRules;
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

  // `--yes` never prompts, so `summary` has not been shown to anyone yet and must be prepended to
  // whatever the write step produces. Interactively, `confirmDraft` owns displaying `summary` (see
  // its contract above), so the write step's output is returned on its own to avoid a double print.
  const confirmed = options.yes ? true : await prompter.confirmDraft(summary);
  if (!confirmed) {
    return { output: "Aborted: configuration not confirmed.\n", wasConfirmed: false };
  }

  const composeOutput = (suffix: string): string => (options.yes ? `${summary}\n${suffix}` : suffix);

  // The repository root anchors every user-visible path so a subdirectory run reports where files
  // actually landed (e.g. `docs/wastech-mdlint.config.json`). findRepositoryRoot prefers the `.git`
  // root (a nested workspace package must still anchor at the real repo root, not `packages/foo`)
  // and only falls back to a nearer `package.json`/`node_modules` outside a git repo. It walks *up*
  // from the write dir, so the root is always an ancestor and reported paths never contain a "..".
  // Falls back to `cwd` outside any recognizable project (best effort — no parent anchor to report).
  const repoRoot = (await findRepositoryRoot(cwd)) ?? cwd;
  const toRepoRelative = (absolutePath: string): string => normalizeRelativePath(path.relative(repoRoot, absolutePath));

  // A merge that cannot read/parse the existing config aborts: the deliverable's "never modify or
  // drop an existing entry" is unprovable when the entries can't be parsed, so writing nothing is
  // the only safe outcome (no config, no schema, no CI workflow touch the disk here).
  if (existingConfigAction === "merge" && existingConfigUnreadable) {
    const notWrittenPath =
      existingConfigPath === undefined ? relativeConfigPath : toRepoRelative(existingConfigPath);
    return {
      output: composeOutput(formatNotWrittenSummary(notWrittenPath)),
      // The user did confirm the draft above (`confirmed === true`) — only the write itself was
      // withheld, for a reason unrelated to their choice. See the type's own comment.
      wasConfirmed: true
    };
  }

  const action: InitConfigAction = existingConfigAction === "merge" ? "merge" : "fresh";

  // Reuse the snapshot read above. The unreadable-merge abort has already returned, so on a merge
  // that reaches here `existingDocument.raw` is guaranteed defined (parsed + additively mergeable) —
  // no second read, no window for a fresh-overwrite that drops the existing keys.
  const existing: ExistingConfigDocument | undefined =
    action === "merge" && existingDocument?.raw !== undefined ? { raw: existingDocument.raw } : undefined;

  const configPath = path.join(cwd, CONFIG_FILE_NAME);

  // `include` is only meaningful for a fresh write; generateInitConfig ignores it under "merge". The
  // package `$schema` ref is computed relative to the config's own directory (not a fixed literal),
  // anchored on the *actual* installed schema when present (or the project root otherwise), so a
  // subdirectory config wires `../node_modules/...` instead of a dead path nested under it.
  const schemaAnchor = (await findInstalledSchemaDir(cwd)) ?? repoRoot;
  const preview = buildConfigPreview(confirmedClusters, selectedRules);
  const result = generateInitConfig({
    action,
    existing,
    include: preview.include,
    newRules: selectedRules,
    packageSchemaRef: resolvePackageSchemaRef(cwd, schemaAnchor)
  });

  await writeFile(configPath, result.configText, "utf8");
  let schemaRelativePath: string | undefined;
  if (result.projectSchema !== undefined) {
    const schemaPath = path.join(cwd, result.projectSchema.fileName);
    await writeFile(schemaPath, result.projectSchema.text, "utf8");
    schemaRelativePath = toRepoRelative(schemaPath);
  }

  const ciWorkflowRelativePath = await offerCiWorkflow({
    repoRoot,
    configAbsPath: configPath,
    yes: options.yes,
    withCiWorkflow: options.withCiWorkflow,
    prompter
  });

  return {
    output: composeOutput(
      formatWriteSummary({
        action,
        result,
        configPath: toRepoRelative(configPath),
        schemaPath: schemaRelativePath,
        ciWorkflowPath: ciWorkflowRelativePath
      })
    ),
    wasConfirmed: true
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
async function existingConfigLoads(cwd: string, configPath: string): Promise<boolean> {
  try {
    await loadConfiguration({ cwd, explicitConfigPath: configPath });
    return true;
  } catch {
    return false;
  }
}
