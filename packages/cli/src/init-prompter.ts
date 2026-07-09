import { Writable } from "node:stream";

import { checkbox, confirm, select } from "@inquirer/prompts";

import type { DetectedPackageManager, DocCluster, RuleCategory } from "@wastech-mdlint/core";

import { DEFAULT_EXISTING_CONFIG_ACTION, type ExistingConfigAction, type InitPrompter } from "./init-command.js";

const PACKAGE_MANAGER_CHOICES: { name: string; value: DetectedPackageManager }[] = [
  { name: "bun", value: "bun" },
  { name: "pnpm", value: "pnpm" },
  { name: "yarn", value: "yarn" },
  { name: "npm", value: "npm" },
  { name: "none of these", value: undefined }
];

// Real `@inquirer/prompts` calls can't be driven in a test without a live TTY (confirmed: even a
// redirected `/dev/null` stdin just hangs rather than resolving/rejecting), so these two builders
// are split out and exported purely so a test can assert the exact `default` handed to `select()`
// — the config that decides what plain Enter resolves to — without needing to render a prompt.

/**
 * `default` mirrors `DEFAULT_EXISTING_CONFIG_ACTION` (the same constant `--yes` falls back to
 * with no `--on-existing`), so pressing Enter through the interactive flow can never resolve to
 * the destructive `"overwrite"` — `@inquirer/select` otherwise defaults to the first choice.
 */
export function buildExistingConfigActionPromptConfig(configPath: string): {
  message: string;
  choices: { name: string; value: ExistingConfigAction }[];
  default: ExistingConfigAction;
} {
  return {
    message: `An existing config was found at ${configPath}. What should init do?`,
    choices: [
      { name: "Overwrite — replace it with the freshly inferred config", value: "overwrite" },
      { name: "Merge — keep every existing rule, append only the new ones", value: "merge" },
      { name: "Skip — leave it untouched", value: "skip" }
    ],
    default: DEFAULT_EXISTING_CONFIG_ACTION
  };
}

/**
 * `default: undefined` selects the "none of these" choice, matching `--yes`'s own behavior of
 * leaving an undetected package manager unset (printed as "not detected") — `@inquirer/select`
 * otherwise defaults to the first real choice (`"bun"`), inventing evidence the scan never found.
 */
export function buildPackageManagerPromptConfig(): {
  message: string;
  choices: { name: string; value: DetectedPackageManager }[];
  default: DetectedPackageManager;
} {
  return {
    message: "No lockfile was detected. Which package manager does this project use?",
    choices: PACKAGE_MANAGER_CHOICES,
    default: undefined
  };
}

// `@inquirer/prompts`' context argument wants a full `NodeJS.WritableStream` (it renders through
// `.write()` but also expects the standard `Writable` shape); our injected seam is deliberately
// narrowed to just `write` (mirrors `CliIo.stdout`), so wrap it in a real `Writable` that forwards
// every chunk rather than casting across the gap.
function toWritableStream(stream: Pick<NodeJS.WriteStream, "write">): Writable {
  return new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      stream.write(chunk.toString());
      callback();
    }
  });
}

/**
 * The only module that imports `@inquirer/prompts` — a thin pass-through to a well-tested
 * third-party library, deliberately not unit-tested beyond a light smoke check (the rest of the
 * codebase doesn't unit-test thin host adapters like `commander` itself beyond their own logic).
 *
 * `stdout` is the CLI's own injected stream (mirrors `CliIo.stdout`). Every prompt call — not just
 * `confirmDraft`'s manual draft write — renders through it via Inquirer's `context.output`, so
 * interactive `init` never splits its output across the injected seam and the real
 * `process.stdout`.
 */
export function createInquirerPrompter(stdout: Pick<NodeJS.WriteStream, "write"> = process.stdout): InitPrompter {
  const context = { output: toWritableStream(stdout) };

  return {
    async resolveExistingConfigAction(configPath: string): Promise<ExistingConfigAction> {
      return select<ExistingConfigAction>(buildExistingConfigActionPromptConfig(configPath), context);
    },

    async choosePackageManager(): Promise<DetectedPackageManager> {
      return select<DetectedPackageManager>(buildPackageManagerPromptConfig(), context);
    },

    async selectClusters(clusters: DocCluster[]): Promise<DocCluster[]> {
      return checkbox<DocCluster>(
        {
          message: "Include these documentation clusters?",
          choices: clusters.map((cluster) => ({
            name: `${cluster.includeGlob} (${cluster.subtreeCount} file(s))`,
            value: cluster,
            checked: true
          }))
        },
        context
      );
    },

    async selectCategories(categories: RuleCategory[]): Promise<RuleCategory[]> {
      return checkbox<RuleCategory>(
        {
          message: "Enable these rule categories?",
          choices: categories.map((category) => ({ name: category, value: category, checked: true }))
        },
        context
      );
    },

    async confirmDraft(summary: string): Promise<boolean> {
      // Shown exactly once, here — `runInitCommand` relies on this and does not re-print `summary`
      // itself after a confirmed interactive run (see the `InitPrompter.confirmDraft` contract).
      stdout.write(summary);
      return confirm({ message: "Confirm this draft configuration?", default: true }, context);
    }
  };
}
