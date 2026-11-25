import {
  COMPRESS_RULES,
  FIX_NOT_SILENCE,
  SPLIT_FORMS,
  blastRadius,
  codeSpan,
  runPlace,
  splitSteps,
} from "../discovery/agent-rule.js";
import { isGlobPattern, matchesConfigGlob } from "../discovery/globs.js";
import { ruleRegistry } from "./rules/index.js";
import { sizeBudgetForEntry, type SizeMetric } from "./rules/size.js";
import type { LintMessage } from "./types.js";

// A prompt a reader copies from a host (the viewer) and hands to a coding agent, asking it to deal
// with the findings in one file. Pure and deterministic, like the agent rule `init` writes: core
// produces the text, the host decides where it goes.
//
// A size finding (SIZE-001, or LLM-001's context budget) can be answered three ways, and the reader
// picks one: compress the wording, split the file, or raise the budget for this one path. The first
// two reuse the agent rule's own policy text word for word, so an agent told to shorten a file meets
// the same floor - nothing is cut to fit - that the rule page sets. Raising a budget is the reader's
// explicit decision, which the policy requires before a threshold moves; the prompt says so and
// spells out how SIZE-001 picks a budget, since the obvious edit gets it wrong. Every other finding
// gets one prompt: fix it in the document, never silence it.

export type PromptStrategy = "compress" | "split" | "budget" | "fix";

export const PROMPT_STRATEGY_LABELS: Readonly<Record<PromptStrategy, string>> =
  {
    compress: "Compress the text",
    split: "Split into several files",
    budget: "Raise the budget for this path",
    fix: "Fix it",
  };

export type PromptFinding = Pick<
  LintMessage,
  "ruleId" | "severity" | "message" | "line" | "data"
>;

// One rule entry of the config, with the canonical id of its rule. Custom rules, names the registry
// does not know and entries switched `off` are left out by the host: there is no budget to read from
// the first two, and the last reports nothing.
export type PromptRuleEntry = { ruleId: string; options: unknown };

export type FindingPromptInput = {
  // Repository-relative POSIX path of the file the findings are in.
  filePath: string;
  // The findings to deal with, in the order the host shows them: one, or all of the file's.
  findings: readonly PromptFinding[];
  strategy: PromptStrategy;
  // Repository-relative POSIX path of the config, or `undefined` when the repository has none.
  configPath: string | undefined;
  // How a command line runs the CLI here (`cliRunner`).
  runner: string;
  // The config's rule entries in order, for the budget that applies to the file.
  ruleEntries: readonly PromptRuleEntry[];
};

/** Whether a finding is about a size budget, which can be compressed, split or given more room. */
export function isBudgetFinding(finding: PromptFinding): boolean {
  return (
    (finding.ruleId === "SIZE-001" &&
      typeof finding.data?.metric === "string") ||
    (finding.ruleId === "LLM-001" &&
      typeof finding.data?.totalTokens === "number")
  );
}

/** The ways the findings can be answered, in the order a menu offers them. */
export function findingPromptStrategies(
  findings: readonly PromptFinding[],
): PromptStrategy[] {
  return findings.some(isBudgetFinding)
    ? ["compress", "split", "budget"]
    : ["fix"];
}

export function buildFindingPrompt(input: FindingPromptInput): string {
  const file = codeSpan(input.filePath);
  const command = (args: string): string => codeSpan(`${input.runner} ${args}`);
  const budgetFindings = input.findings.filter(isBudgetFinding);
  const otherFindings = input.findings.filter(
    (finding) => !isBudgetFinding(finding),
  );
  // A size strategy asked of findings that hold no size finding has nothing to act on; they are
  // fixed instead, which is the only answer they have.
  const strategy: PromptStrategy =
    budgetFindings.length === 0 ? "fix" : input.strategy;
  const config =
    input.configPath === undefined ? undefined : codeSpan(input.configPath);

  const lines: string[] = [
    `# ${TITLES[strategy]} ${file}`,
    "",
    `wastech-mdlint reports ${input.findings.length === 1 ? "this finding" : "these findings"} in ${file}${config === undefined ? "" : `, under the config ${config}`}. Paths are relative to the repository root.`,
    "",
    ...input.findings.map(describeFinding),
    "",
  ];

  if (strategy === "fix") {
    lines.push("## What to do", "", ...fixSection(otherFindings, command));
  } else {
    lines.push("## What to do", "");
    if (strategy === "compress") {
      lines.push(...compressSection(file, budgetFindings));
    } else if (strategy === "split") {
      lines.push(...splitSection(input, budgetFindings, command));
    } else {
      lines.push(...budgetSection(input, budgetFindings, config));
    }
    if (otherFindings.length > 0) {
      lines.push(
        "",
        "## The other findings",
        "",
        ...fixSection(otherFindings, command),
      );
    }
  }

  lines.push("", "## Verify", "", ...verifySection(input, strategy, command));
  return `${lines.join("\n")}\n`;
}

const TITLES: Record<PromptStrategy, string> = {
  compress: "Compress",
  split: "Split",
  budget: "Raise the size budget for",
  fix: "Fix the wastech-mdlint findings in",
};

function describeFinding(finding: PromptFinding): string {
  // Line 0 is how a rule reports a finding about the file as a whole, such as its size.
  const where = finding.line > 0 ? `line ${finding.line}` : "whole file";
  return `- **${finding.severity}** ${codeSpan(finding.ruleId)} (${where}): ${finding.message}`;
}

type SizeData = {
  metric: SizeMetric;
  actual: number;
  warnAt?: number;
  errorAt?: number;
};

function sizeData(finding: PromptFinding): SizeData | undefined {
  const data = finding.data;
  if (
    finding.ruleId !== "SIZE-001" ||
    typeof data?.metric !== "string" ||
    typeof data.actual !== "number"
  ) {
    return undefined;
  }
  return {
    metric: data.metric as SizeMetric,
    actual: data.actual,
    warnAt: typeof data.warnAt === "number" ? data.warnAt : undefined,
    errorAt: typeof data.errorAt === "number" ? data.errorAt : undefined,
  };
}

function contextData(
  finding: PromptFinding,
): { totalTokens: number; maxTokens: number } | undefined {
  const data = finding.data;
  return finding.ruleId === "LLM-001" &&
    typeof data?.totalTokens === "number" &&
    typeof data.maxTokens === "number"
    ? { totalTokens: data.totalTokens, maxTokens: data.maxTokens }
    : undefined;
}

// What "under budget" means for each size finding: below its warning threshold when it has one, so
// the file stops warning rather than merely stops failing.
function targets(file: string, findings: readonly PromptFinding[]): string[] {
  return findings.flatMap((finding) => {
    const size = sizeData(finding);
    if (size !== undefined) {
      const limit = size.warnAt ?? size.errorAt;
      return limit === undefined
        ? []
        : [
            `- ${codeSpan(size.metric)}: ${size.actual} now; bring it to ${limit} or less.`,
          ];
    }
    const context = contextData(finding);
    return context === undefined
      ? []
      : [
          `- Estimated tokens of ${file} together with everything it imports eagerly through \`@\` imports: ${context.totalTokens} now; bring the total to ${context.maxTokens} or less. Any of those files can be shortened.`,
        ];
  });
}

function compressSection(
  file: string,
  findings: readonly PromptFinding[],
): string[] {
  return [
    `Bring ${file} back under its budget by tightening its wording. Do not split it into other files, and do not change the config or the budget.`,
    "",
    ...targets(file, findings),
    "",
    ...COMPRESS_RULES.map((rule) => `- ${rule}`),
    "",
    "If compressing cannot reach the budget without losing meaning or quality, stop there: report what you tightened and how far that got, and propose how the rest could be split. Do not cut content to make it fit.",
  ];
}

function splitSection(
  input: FindingPromptInput,
  findings: readonly PromptFinding[],
  command: (args: string) => string,
): string[] {
  const file = codeSpan(input.filePath);
  const lines = [
    `Bring ${file} under its budget by splitting it, by meaning, into several files. Compress the wording first wherever that loses nothing, then split what still does not fit.`,
    "",
    ...targets(file, findings),
    "",
    `- ${blastRadius(command)} For this file: ${command(`impact ${input.filePath}`)}.`,
    ...COMPRESS_RULES.map((rule) => `- ${rule}`),
    "",
    "Choose the form by the shape of the document:",
    "",
    ...SPLIT_FORMS.map((form) => `- ${form}`),
    "",
    ...splitSteps(command),
  ];
  const overrides = (
    reportingSizeEntry(input, findings)?.options as
      | { overrides?: unknown }
      | undefined
  )?.overrides;
  if (Array.isArray(overrides) && overrides.length > 0) {
    lines.push(
      "",
      "SIZE-001 budgets files by path: each new file is held to the first `overrides` entry whose `pattern` matches its own path, or else to the top-level budget, which may differ from the original's. Check that every part lands well under the budget that applies to it.",
    );
  }
  return lines;
}

function budgetSection(
  input: FindingPromptInput,
  findings: readonly PromptFinding[],
  config: string | undefined,
): string[] {
  const file = codeSpan(input.filePath);
  const where = config ?? "the wastech-mdlint config";
  const lines = [
    `The user has decided that ${file} keeps its size and gets a larger budget of its own, instead of being shortened or split. Make that change in ${where}, and do not shorten or split ${file} to answer its size findings.`,
  ];
  const sizeFindings = findings.filter(
    (finding) => sizeData(finding) !== undefined,
  );
  const contextFindings = findings.filter(
    (finding) => contextData(finding) !== undefined,
  );
  if (sizeFindings.length > 0) {
    lines.push("", ...sizeBudgetSteps(input, sizeFindings));
  }
  if (contextFindings.length > 0) {
    lines.push("", ...contextBudgetSteps(input, contextFindings));
  }
  lines.push(
    "",
    "Add a short comment beside the new entry saying why this file has a budget of its own, in the style of the config's other comments.",
  );
  return lines;
}

function sizeBudgetSteps(
  input: FindingPromptInput,
  findings: readonly PromptFinding[],
): string[] {
  const file = codeSpan(input.filePath);
  const entry = reportingSizeEntry(input, findings);
  const budget =
    entry === undefined
      ? undefined
      : sizeBudgetForEntry(entry.options, input.filePath);
  const lines: string[] = [];
  if (budget !== undefined) {
    lines.push(`What SIZE-001 holds ${file} to today:`, "");
    for (const [metric, thresholds] of Object.entries(budget.metrics)) {
      const limits = [
        thresholds.warn === undefined ? "" : `warns above ${thresholds.warn}`,
        thresholds.error === undefined ? "" : `fails above ${thresholds.error}`,
      ]
        .filter(Boolean)
        .join(", ");
      const source =
        thresholds.from === "override" && budget.override !== undefined
          ? `from the \`overrides\` entry with pattern ${codeSpan(budget.override.pattern)}`
          : `from the top-level ${codeSpan(metric)} option`;
      lines.push(`- ${codeSpan(metric)}: ${limits} - ${source}.`);
    }
    lines.push("");
  }
  const broader =
    budget?.override === undefined
      ? ""
      : ` - today that is the entry with pattern ${codeSpan(budget.override.pattern)}`;
  lines.push(
    `Add an entry to SIZE-001's \`options.overrides\` with \`"pattern": "${exactPattern(input.filePath)}"\`, the exact path, and place it before every other entry in that list whose pattern also matches ${file}${broader}: SIZE-001 uses the first override that matches and ignores the rest. A metric the new entry leaves out falls back to the top-level option, not to a broader override, so repeat in it every threshold listed above, and raise only the ones the file exceeds:`,
    "",
    ...findings.flatMap((finding) => raiseSteps(sizeData(finding)!)),
  );
  return lines;
}

/**
 * The SIZE-001 entry the size findings came from. A config may list the rule more than once, and
 * each entry measures every file against a budget of its own, so the first entry is not necessarily
 * the one that reported: the one that did is the entry whose budget for this file has the
 * thresholds the first size finding carries. Explaining any other entry's budget, or telling the
 * agent to add an override there, would leave the finding exactly as it is. The first entry when
 * none matches, which a finding computed under another config could cause.
 */
function reportingSizeEntry(
  input: FindingPromptInput,
  findings: readonly PromptFinding[],
): PromptRuleEntry | undefined {
  const entries = input.ruleEntries.filter(
    (entry) => entry.ruleId === "SIZE-001",
  );
  const size = findings
    .map(sizeData)
    .find((data): data is SizeData => data !== undefined);
  const reporting =
    size === undefined
      ? undefined
      : entries.find((entry) => {
          const thresholds = sizeBudgetForEntry(entry.options, input.filePath)
            ?.metrics[size.metric];
          return (
            thresholds !== undefined &&
            thresholds.warn === size.warnAt &&
            thresholds.error === size.errorAt
          );
        });
  return reporting ?? entries[0];
}

function raiseSteps(size: SizeData): string[] {
  const steps: string[] = [];
  const warnExceeded = size.warnAt !== undefined && size.actual > size.warnAt;
  const errorExceeded =
    size.errorAt !== undefined && size.actual > size.errorAt;
  const newWarn = roomAbove(size.actual, 1.1);
  if (warnExceeded) {
    steps.push(
      `- ${codeSpan(size.metric)} \`warn\`: above ${size.actual}, for example ${newWarn} - some room above today's size, so the next small edit does not trip it again.`,
    );
  }
  if (errorExceeded) {
    steps.push(
      `- ${codeSpan(size.metric)} \`error\`: above ${size.actual}${warnExceeded ? ` and above the new \`warn\`, for example ${roomAbove(size.actual, 1.3)}` : `, for example ${newWarn}`}.`,
    );
  } else if (
    warnExceeded &&
    size.errorAt !== undefined &&
    newWarn >= size.errorAt
  ) {
    // Not exceeded, but a warning threshold at or above the error one would never warn: the file
    // would go straight from silent to failing.
    steps.push(
      `- ${codeSpan(size.metric)} \`error\`: not exceeded, but it has to stay above the new \`warn\`, for example ${roomAbove(size.actual, 1.3)}.`,
    );
  }
  return steps;
}

function contextBudgetSteps(
  input: FindingPromptInput,
  findings: readonly PromptFinding[],
): string[] {
  const file = codeSpan(input.filePath);
  const context = contextData(findings[0]!)!;
  const pattern = exactPattern(input.filePath);
  // An entry that names this file alone is already its own budget, and taking the file out of it
  // would leave `entrypoints: []`, which the config schema refuses - so the agent raises it there.
  if (namesOnly(reportingContextEntry(input, context), input.filePath)) {
    return [
      `LLM-001 holds ${file} to an entry that names only this file, so raise that entry's \`maxTokensPerEntrypoint\` from ${context.maxTokens} to above ${context.totalTokens} - for example ${roomAbove(context.totalTokens, 1.1)}, some room above today's total. Do not take the file out of that entry: its \`entrypoints\` would be left empty, which the config refuses. A pattern without a \`/\` matches that name in every folder, so a same-named entrypoint elsewhere gets the raised budget too.`,
    ];
  }
  return [
    `LLM-001 holds every entrypoint an entry matches to that entry's one \`maxTokensPerEntrypoint\` (${context.maxTokens} today), so raising it there would raise it for every other entrypoint too. Instead, add a second \`LLM-001\` entry with \`"entrypoints": ["${pattern}"]\` and a \`maxTokensPerEntrypoint\` above ${context.totalTokens} - for example ${roomAbove(context.totalTokens, 1.1)}, some room above today's total - and make the existing entry stop matching ${file}: remove it from that entry's \`entrypoints\`, or add \`"!${pattern}"\` there when a glob matches it.`,
  ];
}

// The LLM-001 entry whose budget the file is reported against: one whose `entrypoints` select the
// file, and of those the one whose limit is the one the finding names, since two entries can both
// select it and the rule reports each.
function reportingContextEntry(
  input: FindingPromptInput,
  context: { maxTokens: number },
): { entrypoints: string[] } | undefined {
  const entries = input.ruleEntries.flatMap((entry) => {
    const options = entry.options as
      | { entrypoints?: unknown; maxTokensPerEntrypoint?: unknown }
      | undefined;
    const entrypoints = options?.entrypoints;
    return entry.ruleId === "LLM-001" &&
      Array.isArray(entrypoints) &&
      entrypoints.every((value) => typeof value === "string") &&
      matchesConfigGlob(input.filePath, entrypoints)
      ? [{ entrypoints, maxTokens: options?.maxTokensPerEntrypoint }]
      : [];
  });
  return (
    entries.find((entry) => entry.maxTokens === context.maxTokens) ?? entries[0]
  );
}

// Whether every pattern an entry adds names `filePath` itself: removing the file would then leave
// nothing. A glob, even one that matches only this file today, is left to the general steps, which
// tell the agent to exclude the file with a `!` pattern instead of emptying the list. So is a bare
// name that reaches this file only through its depth-agnostic reading - `README.md` selecting
// `docs/README.md` - since it selects every `README.md` and the `!` form leaves the rest of it.
function namesOnly(
  entry: { entrypoints: string[] } | undefined,
  filePath: string,
): boolean {
  const added = (entry?.entrypoints ?? []).filter(
    (pattern) => !pattern.startsWith("!"),
  );
  return (
    added.length > 0 &&
    added.every(
      (pattern) =>
        !isGlobPattern(pattern) &&
        matchesConfigGlob(filePath, [pattern]) &&
        (pattern.includes("/") || !filePath.includes("/")),
    )
  );
}

// The config pattern that matches `filePath` and nothing else. Config globs without a `/` are
// depth-agnostic - `README.md` is read as `**/README.md` - so a root file's bare name would hand
// the raised budget to every same-named file in the repository, and its `!` form would pull every
// nested one out of the existing entry too. A leading `./` anchors it to the root, the same form
// `init` writes for its root-only patterns; a path that already has a `/` is anchored as it stands.
function exactPattern(filePath: string): string {
  return filePath.includes("/") ? filePath : `./${filePath}`;
}

// A round number comfortably above `value`: `value` times `factor`, rounded up at its second
// significant digit, so a suggested threshold reads as a choice rather than a measurement.
function roomAbove(value: number, factor: number): number {
  const raw = Math.ceil(value * factor);
  const unit = 10 ** Math.max(0, Math.floor(Math.log10(raw)) - 1);
  return Math.ceil(raw / unit) * unit;
}

function fixSection(
  findings: readonly PromptFinding[],
  command: (args: string) => string,
): string[] {
  const ruleIds = [...new Set(findings.map((finding) => finding.ruleId))];
  const lines = [
    "Fix each finding in the document it is reported in.",
    "",
    `- ${FIX_NOT_SILENCE}`,
    `- ${blastRadius(command)}`,
    "",
    "What each rule checks:",
    "",
  ];
  for (const ruleId of ruleIds) {
    const metadata = ruleRegistry.getMetadata(ruleId);
    lines.push(
      metadata === undefined
        ? `- ${codeSpan(ruleId)}: a custom rule from the config; its entry there says what it checks.`
        : `- ${codeSpan(ruleId)}: ${metadata.description}${metadata.docsUrl === undefined ? "" : ` Documented at ${metadata.docsUrl}`}`,
    );
  }
  return lines;
}

function verifySection(
  input: FindingPromptInput,
  strategy: PromptStrategy,
  command: (args: string) => string,
): string[] {
  const place =
    input.configPath === undefined
      ? "from the repository root"
      : runPlace(input.configPath);
  const run = `Run the linter ${place}: ${command("lint")}.`;
  if (strategy === "budget") {
    const others = input.findings.some((finding) => !isBudgetFinding(finding))
      ? " The other findings above must be gone too."
      : "";
    return [
      `${run} ${codeSpan(input.filePath)} must no longer be reported for its size, and no other file's findings may change.${others}`,
    ];
  }
  return [
    `${run} None of the findings above may remain, and no new one may appear - a change like this most often breaks a link or an anchor (\`REF-001\`, \`REF-002\`) or closes a reference cycle (\`GRP-001\`), where the config enables them.`,
  ];
}
