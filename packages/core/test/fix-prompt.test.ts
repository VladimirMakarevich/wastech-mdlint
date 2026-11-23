import { describe, expect, it } from "vitest";

import {
  COMPRESS_RULES,
  FIX_NOT_SILENCE,
  SPLIT_FORMS,
  splitSteps,
} from "../src/discovery/agent-rule.js";
import {
  buildFindingPrompt,
  findingPromptStrategies,
  type FindingPromptInput,
  type PromptFinding,
} from "../src/engine/fix-prompt.js";
import { sizeBudget } from "../src/engine/rules/size.js";

const RUNNER = "npx wastech-mdlint";
const command = (args: string): string => `\`${RUNNER} ${args}\``;

const TOKENS_WARNING: PromptFinding = {
  ruleId: "SIZE-001",
  severity: "warning",
  message: "File exceeds tokens warn budget: 16800 tokens > 16000.",
  line: 0,
  data: { metric: "tokens", actual: 16800, warnAt: 16000, errorAt: 24000 },
};

const BROKEN_LINK: PromptFinding = {
  ruleId: "REF-001",
  severity: "error",
  message: "Broken link: ./gone.md does not exist.",
  line: 12,
};

const CONTEXT_OVER: PromptFinding = {
  ruleId: "LLM-001",
  severity: "warning",
  message: "Entrypoint CLAUDE.md is over context budget.",
  line: 0,
  data: { totalTokens: 10450, maxTokens: 10000, importedFiles: 6 },
};

// The SIZE-001 options of a config that budgets task records apart from everything else: the
// override sets bytes and tokens, the top level also sets lines.
const SIZE_ENTRY = {
  ruleId: "SIZE-001",
  options: {
    lines: { warn: 800 },
    tokens: { warn: 11000, error: 15000 },
    overrides: [
      {
        pattern: "docs/tasks/**",
        bytes: { error: 98304 },
        tokens: { warn: 16000, error: 24000 },
      },
    ],
  },
};

function prompt(overrides: Partial<FindingPromptInput>): string {
  return buildFindingPrompt({
    filePath: "docs/tasks/audit.md",
    findings: [TOKENS_WARNING],
    strategy: "compress",
    configPath: "wastech-mdlint.config.json",
    runner: RUNNER,
    ruleEntries: [SIZE_ENTRY],
    ...overrides,
  });
}

describe("findingPromptStrategies", () => {
  it("offers compressing, splitting and a larger budget for a size finding", () => {
    expect(findingPromptStrategies([TOKENS_WARNING])).toEqual([
      "compress",
      "split",
      "budget",
    ]);
    expect(findingPromptStrategies([CONTEXT_OVER, BROKEN_LINK])).toEqual([
      "compress",
      "split",
      "budget",
    ]);
  });

  // LLM-001 also reports a missing import and an import cycle; neither is about size, so neither can
  // be compressed away or given a budget.
  it("offers only a fix for every other finding", () => {
    expect(findingPromptStrategies([BROKEN_LINK])).toEqual(["fix"]);
    expect(
      findingPromptStrategies([
        {
          ruleId: "LLM-001",
          severity: "warning",
          message: "Missing eager import @./gone.md.",
          line: 3,
          data: { rawTarget: "./gone.md", targetPath: "gone.md" },
        },
      ]),
    ).toEqual(["fix"]);
  });
});

describe("buildFindingPrompt", () => {
  it("is deterministic, LF-terminated and lists every finding with where it is", () => {
    const text = prompt({ findings: [TOKENS_WARNING, BROKEN_LINK] });
    expect(prompt({ findings: [TOKENS_WARNING, BROKEN_LINK] })).toBe(text);
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toContain("\r");
    expect(text).toContain(
      "- **warning** `SIZE-001` (whole file): File exceeds tokens warn budget: 16800 tokens > 16000.",
    );
    expect(text).toContain(
      "- **error** `REF-001` (line 12): Broken link: ./gone.md does not exist.",
    );
  });

  // An agent told to shorten a file must meet the same floor the agent rule sets — nothing is cut to
  // fit — so the policy text is the rule's own, not a paraphrase that could drift from it.
  it("asks for compressing under the agent rule's own floor, with the target to reach", () => {
    const text = prompt({ strategy: "compress" });
    expect(text.startsWith("# Compress `docs/tasks/audit.md`\n")).toBe(true);
    for (const rule of COMPRESS_RULES) {
      expect(text).toContain(`- ${rule}`);
    }
    expect(text).toContain("- `tokens`: 16800 now; bring it to 16000 or less.");
    expect(text).toContain("Do not split it into other files");
    expect(text).toContain("Do not cut content to make it fit.");
  });

  it("asks for a split by the agent rule's method, starting from the file's blast radius", () => {
    const text = prompt({ strategy: "split" });
    expect(text).toContain(
      `For this file: ${command("impact docs/tasks/audit.md")}.`,
    );
    for (const form of SPLIT_FORMS) {
      expect(text).toContain(`- ${form}`);
    }
    for (const step of splitSteps(command)) {
      expect(text).toContain(step);
    }
    // The new files may fall under another override than the original's.
    expect(text).toContain(
      "each new file is held to the first `overrides` entry whose `pattern` matches its own path",
    );
  });

  // The obvious edit — an override with only the exceeded metric, appended at the end — is wrong
  // twice: a later override never applies while a broader one matches first, and a metric it leaves
  // out falls back to the top level rather than to the broader override.
  it("raises a SIZE-001 budget with an exact-path override placed first and repeating every threshold", () => {
    const text = prompt({ strategy: "budget" });
    expect(
      text.startsWith("# Raise the size budget for `docs/tasks/audit.md`\n"),
    ).toBe(true);
    expect(text).toContain(
      "The user has decided that `docs/tasks/audit.md` keeps its size",
    );
    expect(text).toContain(
      "- `bytes`: fails above 98304 — from the `overrides` entry with pattern `docs/tasks/**`.",
    );
    expect(text).toContain(
      "- `lines`: warns above 800 — from the top-level `lines` option.",
    );
    expect(text).toContain(
      "- `tokens`: warns above 16000, fails above 24000 — from the `overrides` entry with pattern `docs/tasks/**`.",
    );
    expect(text).toContain('`"pattern": "docs/tasks/audit.md"`');
    expect(text).toContain(
      "today that is the entry with pattern `docs/tasks/**`",
    );
    expect(text).toContain("SIZE-001 uses the first override that matches");
    expect(text).toContain("repeat in it every threshold listed above");
    expect(text).toContain("- `tokens` `warn`: above 16800, for example 19000");
    expect(text).not.toContain("`tokens` `error`");
  });

  it("raises an exceeded error threshold above the new warning one", () => {
    const text = prompt({
      strategy: "budget",
      findings: [
        {
          ...TOKENS_WARNING,
          severity: "error",
          data: {
            metric: "tokens",
            actual: 25000,
            warnAt: 16000,
            errorAt: 24000,
          },
        },
      ],
    });
    expect(text).toContain("- `tokens` `warn`: above 25000, for example 28000");
    expect(text).toContain(
      "- `tokens` `error`: above 25000 and above the new `warn`, for example 33000.",
    );
  });

  // A warning threshold raised past an untouched error threshold would never warn again.
  it("keeps the error threshold above a raised warning one", () => {
    const text = prompt({
      strategy: "budget",
      findings: [
        {
          ...TOKENS_WARNING,
          data: {
            metric: "tokens",
            actual: 23000,
            warnAt: 16000,
            errorAt: 24000,
          },
        },
      ],
    });
    expect(text).toContain("- `tokens` `warn`: above 23000, for example 26000");
    expect(text).toContain(
      "- `tokens` `error`: not exceeded, but it has to stay above the new `warn`, for example 30000.",
    );
    expect(prompt({ strategy: "budget" })).not.toContain("`tokens` `error`");
  });

  // LLM-001 has one limit for every entrypoint an entry matches, so raising it in place would raise
  // it for all of them.
  it("gives an LLM-001 entrypoint an entry of its own", () => {
    const text = prompt({
      filePath: "CLAUDE.md",
      findings: [CONTEXT_OVER],
      strategy: "budget",
      ruleEntries: [],
    });
    expect(text).toContain(
      'add a second `LLM-001` entry with `"entrypoints": ["CLAUDE.md"]`',
    );
    expect(text).toContain("above 10450 — for example 12000");
    expect(text).toContain('add `"!CLAUDE.md"` there when a glob matches it');
  });

  it("asks for a fix, never a silence, with what each rule checks", () => {
    const text = prompt({ findings: [BROKEN_LINK], strategy: "fix" });
    expect(
      text.startsWith(
        "# Fix the wastech-mdlint findings in `docs/tasks/audit.md`\n",
      ),
    ).toBe(true);
    expect(text).toContain(`- ${FIX_NOT_SILENCE}`);
    expect(text).toMatch(
      /- `REF-001`: .+ Documented at https:\/\/github\.com\/VladimirMakarevich\/wastech-mdlint\/blob\/main\/docs\/guide\/rules\/REF-001\.md/,
    );
    const custom = prompt({
      findings: [{ ...BROKEN_LINK, ruleId: "TEAM-001" }],
      strategy: "fix",
    });
    expect(custom).toContain("- `TEAM-001`: a custom rule from the config");
  });

  // A size strategy asked of findings with no size finding among them has nothing to act on.
  it("fixes findings that have no size finding whatever strategy is asked", () => {
    expect(prompt({ findings: [BROKEN_LINK], strategy: "split" })).toBe(
      prompt({ findings: [BROKEN_LINK], strategy: "fix" }),
    );
  });

  it("answers the other findings beside a size strategy", () => {
    const text = prompt({
      findings: [TOKENS_WARNING, BROKEN_LINK],
      strategy: "compress",
    });
    expect(text).toContain("## The other findings");
    expect(text).toContain(`- ${FIX_NOT_SILENCE}`);
  });

  // The commands resolve the config by walking up from where they run.
  it("runs the linter where the config is found", () => {
    expect(prompt({ configPath: "docs/wastech-mdlint.config.json" })).toContain(
      `Run the linter from \`docs/\`, the directory that holds the config: ${command("lint")}.`,
    );
    expect(prompt({ configPath: undefined })).toContain(
      `Run the linter from the repository root: ${command("lint")}.`,
    );
  });
});

describe("sizeBudget", () => {
  const options = SIZE_ENTRY.options;

  it("takes the first matching override and falls back to the top level per metric", () => {
    expect(sizeBudget(options, "docs/tasks/audit.md")).toEqual({
      override: { index: 0, pattern: "docs/tasks/**" },
      metrics: {
        bytes: { error: 98304, from: "override" },
        lines: { warn: 800, from: "top-level" },
        tokens: { warn: 16000, error: 24000, from: "override" },
      },
    });
  });

  it("uses the top level alone for a file no override matches", () => {
    expect(sizeBudget(options, "README.md")).toEqual({
      override: undefined,
      metrics: {
        lines: { warn: 800, from: "top-level" },
        tokens: { warn: 11000, error: 15000, from: "top-level" },
      },
    });
  });

  it("ignores a later override once an earlier one matches", () => {
    const budget = sizeBudget(
      {
        overrides: [
          { pattern: "docs/**", tokens: { warn: 1 } },
          { pattern: "docs/tasks/audit.md", tokens: { warn: 2 } },
        ],
      },
      "docs/tasks/audit.md",
    );
    expect(budget.override).toEqual({ index: 0, pattern: "docs/**" });
    expect(budget.metrics.tokens).toEqual({ warn: 1, from: "override" });
  });
});
