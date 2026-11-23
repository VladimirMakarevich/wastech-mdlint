import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import {
  buildFindingPrompt,
  cliRunner,
  detectPackageManager,
  findingPromptStrategies,
  PROMPT_STRATEGY_LABELS,
  type LintMessage,
  type PromptStrategy,
} from "@wastech-mdlint/core";

import { entryRuleIds } from "./config-editor.js";
import type { Corpus } from "./corpus.js";

// The fix prompts the page offers for a finding, or for all of a document's findings. The text and
// the choice of strategies are core's (`buildFindingPrompt`); this picks the findings out of the
// latest lint run and supplies what core needs to know about this repository.

export type PromptChoice = {
  strategy: PromptStrategy;
  label: string;
  text: string;
};

export type PromptsAnswer =
  | { status: 200; body: { prompts: PromptChoice[] } }
  | { status: 404 | 409; body: { error: string } };

// The CLI, the viewer and core are released together under one version, so the viewer's own is the
// version of the CLI release a prompt pins when the repository has none installed.
const VIEWER_VERSION = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

/**
 * The command a prompt tells an agent to run the CLI with, as `init`'s agent rule does: the
 * repository's installed copy through its package manager, or else the pinned release fetched on
 * demand — a bare `npx wastech-mdlint` with nothing installed would fetch an unrelated package.
 */
async function promptRunner(rootDir: string): Promise<string> {
  return cliRunner({
    cliInstalled: existsSync(
      path.join(
        rootDir,
        "node_modules",
        "@wastech-mdlint",
        "cli",
        "package.json",
      ),
    ),
    packageManager: await detectPackageManager(rootDir),
    cliVersion: VIEWER_VERSION,
  });
}

export async function findingPrompts(params: {
  corpus: Corpus;
  // The latest findings by file; `undefined` until the first lint finishes.
  findings: ReadonlyMap<string, readonly LintMessage[]> | undefined;
  filePath: string;
  // One finding, by rule and line; both absent for all of the file's findings.
  ruleId?: string;
  line?: number;
}): Promise<PromptsAnswer> {
  const { corpus } = params;
  if (!corpus.documents.has(params.filePath)) {
    return {
      status: 404,
      body: { error: "This path is not a document in the corpus." },
    };
  }
  if (params.findings === undefined) {
    return {
      status: 409,
      body: { error: "The linter has not finished its first run yet." },
    };
  }
  const all = params.findings.get(params.filePath) ?? [];
  // A rule can report more than one finding on a line — SIZE-001 reports each metric over budget on
  // line 0 — and they are answered together, as the panel shows them together.
  const findings =
    params.ruleId === undefined
      ? all
      : all.filter(
          (finding) =>
            finding.ruleId === params.ruleId && finding.line === params.line,
        );
  if (findings.length === 0) {
    return {
      status: 409,
      body: {
        error:
          "These findings are no longer reported; the page shows the latest ones once it refreshes.",
      },
    };
  }
  const config = corpus.configuration;
  const ruleIds = entryRuleIds(config.config);
  const ruleEntries = (config.config.rules ?? []).flatMap((entry, index) => {
    const ruleId = ruleIds[index];
    return ruleId === null || ruleId === undefined
      ? []
      : [{ ruleId, options: "options" in entry ? entry.options : undefined }];
  });
  const configPath =
    config.configPath === undefined
      ? undefined
      : path
          .relative(corpus.rootDir, config.configPath)
          .split(path.sep)
          .join("/");
  const runner = await promptRunner(corpus.rootDir);
  return {
    status: 200,
    body: {
      prompts: findingPromptStrategies(findings).map((strategy) => ({
        strategy,
        label: PROMPT_STRATEGY_LABELS[strategy],
        text: buildFindingPrompt({
          filePath: params.filePath,
          findings,
          strategy,
          configPath,
          runner,
          ruleEntries,
        }),
      })),
    },
  };
}
