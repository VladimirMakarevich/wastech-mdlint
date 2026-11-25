import type {
  DetectedPackageManager,
  DocCluster,
  RuleCategory,
} from "@wastech-mdlint/core";

// The contracts every `init` module shares: the host-facing options, the prompter seam and the
// run's named outcomes. They live apart from the orchestrator so the sibling modules that build the
// draft, offer the opt-in files and render the summaries can depend on them without importing the
// orchestrator that imports them - a cycle would make module evaluation order matter.

export type ExistingConfigAction = "overwrite" | "merge" | "skip";

// The least-destructive choice - `init` never clobbers a file implicitly. Both `--yes`'s own
// fallback in `runInitCommand` and the interactive prompt's default (init-prompter.ts) resolve to this single
// constant, so pressing Enter through the interactive flow can never silently diverge from what
// non-interactive `--yes` does.
export const DEFAULT_EXISTING_CONFIG_ACTION: ExistingConfigAction = "skip";

// One method per real decision point (mirrors CliIo's stdout/stderr/cwd seam), so a fake prompter
// can drive every branch of runInitCommand in tests without a TTY.
export type InitPrompter = {
  // `configPath` is already a repository-relative POSIX path (normalized by the caller) - public
  // output never surfaces an absolute, platform-native filesystem path.
  resolveExistingConfigAction(
    configPath: string,
  ): Promise<ExistingConfigAction>;
  choosePackageManager(): Promise<DetectedPackageManager>;
  selectClusters(clusters: DocCluster[]): Promise<DocCluster[]>;
  selectCategories(categories: RuleCategory[]): Promise<RuleCategory[]>;
  // Must display `summary` to the user before asking for confirmation - it is the only place the
  // draft is shown on an interactive run. `runInitCommand` trusts that display already happened
  // and does not re-emit `summary` itself once this resolves, so a caller must not skip it.
  confirmDraft(summary: string): Promise<boolean>;
  // The opt-in CI-workflow offer: "ask first, don't write silently", so its prompt defaults to
  // no. Only consulted on an interactive run when no workflow file already exists.
  confirmCiWorkflow(): Promise<boolean>;
  // The opt-in agent-rule offer, under the same discipline and with the same default: only
  // consulted on an interactive run when no agent rule file already exists.
  confirmAgentRule(): Promise<boolean>;
};

export type InitCommandOptions = {
  cwd: string;
  yes: boolean;
  onExisting?: ExistingConfigAction;
  isTty: boolean;
  // Pre-answers the CI-workflow prompt under `--yes` only (mirrors `--on-existing`): interactive
  // runs always prompt regardless of this flag.
  withCiWorkflow?: boolean;
  // Pre-answers the agent-rule prompt under `--yes` only, exactly as `withCiWorkflow` does.
  withAgentRule?: boolean;
  // The running CLI's own version. The agent rule pins its on-demand runner and its companion skill
  // to it; read once by the host rather than here, since the host already owns reading its package
  // metadata for `--version`.
  cliVersion: string;
  // True only when the CLI's `[path]` argument was actually typed by the user (program.ts is the
  // one layer that can tell "typed, and happens to equal cwd" apart from "omitted"). A required
  // field, not optional, so every call site is forced to decide it explicitly: an
  // explicit target directory must not be silently re-rooted onto a config found at a strict
  // ancestor - that is decided where `runInitCommand` resolves which existing config governs the run.
  pathWasExplicit: boolean;
};

/**
 * Every way `runInitCommand` can end, named - because four of the seven write nothing and the host has
 * to sort them into two exit codes that mean opposite things. A boolean could not:
 * the previous `writeFailed` flag collapsed "the user asked for no write" and "the file we were told
 * to merge into is invalid" into one `false`, so a CI merge step that refused to write reported
 * success. Which bucket a new outcome belongs in is a decision, so it is spelled out here and
 * switched exhaustively at the boundary rather than inferred from a flag.
 *
 * Deliberate no-write (exit `0`): `skipped`, `declined`. Operational failure (exit `2`):
 * `invalid-existing-config`, `write-failed`, `ci-workflow-write-failed`, `agent-rule-write-failed`.
 *
 * `skipped` means the *config* was deliberately left alone, not that nothing was written: the CI
 * workflow and agent rule are still offered after a skip, because a repository that already has a
 * config is exactly the one that wants to add them without touching it. So the two opt-in failure
 * outcomes can follow either a config write or a skip - a requested file that could not be written
 * is a failed write either way, and exiting `0` for it would let a CI step report success after
 * writing nothing it was asked to write.
 */
export type InitOutcome =
  | "written"
  | "skipped"
  | "declined"
  | "invalid-existing-config"
  | "write-failed"
  | "ci-workflow-write-failed"
  | "agent-rule-write-failed";

export type RunInitCommandResult = {
  output: string;
  outcome: InitOutcome;
};
