import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildAgentRuleMarkdown,
  buildCiWorkflowYaml,
  CONFIG_FILE_NAME,
  normalizeRelativePath,
  PACKAGE_SCHEMA_SEGMENTS,
  writeFilesAtomic,
  type DetectedPackageManager,
} from "@wastech-mdlint/core";

import type {
  InitCommandOptions,
  InitOutcome,
  InitPrompter,
} from "./init-types.js";

// The files `init` writes beyond the config: locating the project root they anchor at, offering the
// CI workflow and the agent rule, and folding their outcomes into the run's own.

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
// or once the walk reaches `boundary` (checked, but never crossed - see findRepositoryRoot/
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
 * (`.git`) wins whenever one exists - GitHub loads workflows only from the *repo* root, so a nested
 * workspace-package run (`packages/foo`) must anchor at the repo root, never at `packages/foo`. Only
 * when there is no git root above the write dir does it fall back to the nearest `package.json`/
 * `node_modules` (a valid non-git project). Undefined outside any recognizable project.
 *
 * The walk stops at (and never accepts) the user's home directory: `init` bootstraps a *new* project,
 * so its target commonly has no `.git`/`package.json` of its own yet, and a great many developer
 * machines have an unrelated `.git` at `$HOME` (a dotfiles repo). Without this bound, running `init`
 * anywhere under such a home directory would silently anchor the CI-workflow write - a real file on
 * disk - at `$HOME` instead of the target project. Capping at `$HOME` trades away the rare legitimate
 * case of a project rooted exactly at `$HOME` for never writing outside the user's intended target.
 */
export async function findRepositoryRoot(
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
 * actually exists on disk - the real installed schema, wherever the package manager hoisted it.
 * Returns that directory, or undefined when the package is not installed (the ordinary `npx` case,
 * and a common one in tests / before `npm install`) or the walk reaches the user's home directory
 * (same unrelated-ancestor concern as `findRepositoryRoot`). `undefined` means "no package schema
 * ref": the caller generates a project-local `./schema.json` rather than anchoring on a project
 * root whose `node_modules/@wastech-mdlint/cli/schema.json` does not exist.
 */
export async function findInstalledSchemaDir(
  startDir: string,
): Promise<string | undefined> {
  return findAncestor(
    startDir,
    (directory) => fileExists(path.join(directory, ...PACKAGE_SCHEMA_SEGMENTS)),
    os.homedir(),
  );
}

/**
 * Asks one opt-in question. These prompts run after the config/schema are already on disk (or after
 * a skip, when the CI workflow may already have been written before the agent-rule prompt), so a
 * Ctrl+C here must not unwind the whole command - that would exit without the summary and make an
 * already-mutated repo look untouched. Cancellation is therefore read as "no" and the summary
 * still prints. Matched on `.name` (not `instanceof`), the version-stable @inquirer convention used
 * in program.ts.
 */
async function askOptIn(ask: () => Promise<boolean>): Promise<boolean> {
  try {
    return await ask();
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      return false;
    }
    throw error;
  }
}

/**
 * Writes one opt-in file whose parent directory routinely does not exist yet (`.github/workflows`,
 * `.agents/rules`). The atomic helper deliberately leaves directory creation to its caller, so a
 * failure to create it is reported the same way a failed write is - just without an errno to
 * attribute it to, since the directory, not the file, is what could not be made.
 */
async function writeOptInFile(
  absolutePath: string,
  content: string,
): Promise<{ ok: true } | { ok: false; code?: string }> {
  try {
    await mkdir(path.dirname(absolutePath), { recursive: true });
  } catch {
    return { ok: false };
  }
  const written = await writeFilesAtomic([{ path: absolutePath, content }]);
  return written.ok ? { ok: true } : { ok: false, code: written.code };
}

/**
 * Outcome of the opt-in CI-workflow write. `path` is a repository-relative POSIX path. `"failed"`
 * exists because this write happens *after* the config and schema are already committed: dropping the
 * whole summary on its failure would leave an already-mutated repo looking untouched, so the failure
 * becomes a summary line (plus a non-zero exit) instead of a thrown error.
 *
 * `"kept"` and `"unsafe-config-path"` are the two cases where the offer is withheld by the tool
 * rather than declined by the user: both used to return `undefined`, which the summary
 * renders as no line at all, so a run that quietly skipped the workflow looked identical to one that
 * was never eligible for it. Neither is a failure - nothing was attempted and nothing is broken - so
 * they report without affecting the exit code. A user saying "no" stays `undefined`: they already
 * know what they chose.
 */
export type CiWorkflowOutcome =
  | { kind: "written"; path: string }
  | { kind: "failed"; path: string; code?: string }
  | { kind: "kept"; path: string }
  | { kind: "unsafe-config-path"; path: string };

/**
 * Offer - and, if accepted, write - the opt-in CI workflow. Reached through `offerOptInFiles` after
 * either a confirmed config write or a `skip` of an existing config: the workflow depends only on
 * where the config lives, not on whether this run wrote it, so skipping the config must not also
 * silently skip the workflow `--with-ci-workflow` asked for. Never overwrites an existing workflow. Anchors at the project root (where GitHub
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

  // Omit the `--config` argument when the config sits at the project root - the CLI's walk-up finds
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
  // stripping it would mis-target the config - so decline this opt-in feature rather than emit a
  // broken/mis-pointing workflow (an extreme but legal path edge; the config itself is unaffected).
  if (/[\r\n]/.test(configFromRoot)) {
    return { kind: "unsafe-config-path", path: relativeWorkflowPath };
  }

  if (await fileExists(ciWorkflowPath)) {
    return { kind: "kept", path: relativeWorkflowPath };
  }

  const wantsCi = yes || (await askOptIn(() => prompter.confirmCiWorkflow()));
  if (!wantsCi) {
    return undefined;
  }

  const configArg =
    configFromRoot === CONFIG_FILE_NAME ? undefined : configFromRoot;
  const written = await writeOptInFile(
    ciWorkflowPath,
    buildCiWorkflowYaml(configArg),
  );
  return written.ok
    ? { kind: "written", path: relativeWorkflowPath }
    : { kind: "failed", path: relativeWorkflowPath, code: written.code };
}

// Where the agent rule lands, as path segments joined via path.join for a Windows-correct write.
// `.agents/rules/` is the host-neutral home for agent-operation guidance - it belongs to no single
// agent product - and the file is named after this tool rather than after its topic, so it cannot
// collide with a `markdown.md` or `docs.md` rule the repository already keeps for its own reasons.
const AGENT_RULE_PATH_SEGMENTS = [
  ".agents",
  "rules",
  "wastech-mdlint.md",
] as const;

/**
 * Outcome of the opt-in agent-rule write. The four kinds mean what they mean for the CI workflow
 * (`CiWorkflowOutcome`), for the same reasons: `"failed"` is reported rather than thrown because the
 * config is already on disk, `"kept"` and `"unsafe-config-path"` are withheld offers that must still
 * be stated, and a user's "no" stays `undefined`. `path` is a repository-relative POSIX path.
 */
export type AgentRuleOutcome =
  | { kind: "written"; path: string }
  | { kind: "failed"; path: string; code?: string }
  | { kind: "kept"; path: string }
  | { kind: "unsafe-config-path"; path: string };

/**
 * Offer - and, if accepted, write - the opt-in agent rule. Reached through `offerOptInFiles`, after a
 * config write or a `skip` alike, for the same reason as the CI-workflow offer. Anchored at the
 * repository root for the reason the workflow is: agent context is read from the repository root,
 * not from wherever a nested config happens to sit, and the page itself names that config's
 * directory so its commands still find it. Never overwrites an existing rule - the page is meant to
 * be edited, and a re-run of `init` must not undo those edits.
 */
async function offerAgentRule(params: {
  repoRoot: string;
  configAbsPath: string;
  yes: boolean;
  withAgentRule: boolean | undefined;
  prompter: InitPrompter;
  cliInstalled: boolean;
  packageManager: DetectedPackageManager;
  cliVersion: string;
}): Promise<AgentRuleOutcome | undefined> {
  const { repoRoot, configAbsPath, yes, withAgentRule, prompter } = params;

  if (yes && withAgentRule !== true) {
    return undefined;
  }

  const configFromRoot = normalizeRelativePath(
    path.relative(repoRoot, configAbsPath),
  );
  const agentRulePath = path.join(repoRoot, ...AGENT_RULE_PATH_SEGMENTS);
  const relativeAgentRulePath = normalizeRelativePath(
    path.relative(repoRoot, agentRulePath),
  );

  // The page names the config's directory inside an inline code span, and no code span can carry a
  // line terminator - so decline rather than write a page pointing agents at a directory that does
  // not exist.
  if (/[\r\n]/.test(configFromRoot)) {
    return { kind: "unsafe-config-path", path: relativeAgentRulePath };
  }

  if (await fileExists(agentRulePath)) {
    return { kind: "kept", path: relativeAgentRulePath };
  }

  const wantsRule = yes || (await askOptIn(() => prompter.confirmAgentRule()));
  if (!wantsRule) {
    return undefined;
  }

  const written = await writeOptInFile(
    agentRulePath,
    buildAgentRuleMarkdown({
      configPath: configFromRoot,
      cliInstalled: params.cliInstalled,
      packageManager: params.packageManager,
      cliVersion: params.cliVersion,
    }),
  );
  return written.ok
    ? { kind: "written", path: relativeAgentRulePath }
    : { kind: "failed", path: relativeAgentRulePath, code: written.code };
}

/**
 * Offers both opt-in files in their fixed order - the workflow, then the agent rule. The config-write
 * branch and the `skip` branch of `runInitCommand` both go through here rather than each calling the
 * two offers, because two copies of this sequence would drift: one branch would gain a new opt-in
 * file, an ordering change or a guard that the other silently lacks.
 */
export async function offerOptInFiles(params: {
  repoRoot: string;
  configAbsPath: string;
  options: InitCommandOptions;
  prompter: InitPrompter;
  cliInstalled: boolean;
  packageManager: DetectedPackageManager;
}): Promise<{
  ciWorkflow: CiWorkflowOutcome | undefined;
  agentRule: AgentRuleOutcome | undefined;
}> {
  const { repoRoot, configAbsPath, options, prompter } = params;
  const ciWorkflow = await offerCiWorkflow({
    repoRoot,
    configAbsPath,
    yes: options.yes,
    withCiWorkflow: options.withCiWorkflow,
    prompter,
  });
  // Offered even when the workflow write just failed: the two files are independent, and a failure
  // in one is no reason to withhold the other the user may have asked for.
  const agentRule = await offerAgentRule({
    repoRoot,
    configAbsPath,
    yes: options.yes,
    withAgentRule: options.withAgentRule,
    prompter,
    cliInstalled: params.cliInstalled,
    packageManager: params.packageManager,
    cliVersion: options.cliVersion,
  });
  return { ciWorkflow, agentRule };
}

/**
 * The run's outcome once the opt-in files have been offered. A requested opt-in file that failed to
 * land turns an otherwise-successful run into a failed write whichever branch it followed - the
 * summary names which file it was, and names both when both failed, which is why naming the
 * workflow first here loses nothing. `onSuccess` is what the run was before the offers: `"written"`
 * after a config write, `"skipped"` after leaving an existing config untouched.
 */
export function optInOutcome(
  ciWorkflow: CiWorkflowOutcome | undefined,
  agentRule: AgentRuleOutcome | undefined,
  onSuccess: "written" | "skipped",
): InitOutcome {
  if (ciWorkflow?.kind === "failed") {
    return "ci-workflow-write-failed";
  }
  if (agentRule?.kind === "failed") {
    return "agent-rule-write-failed";
  }
  return onSuccess;
}

export async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}
