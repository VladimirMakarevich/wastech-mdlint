import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lintConfigSchema, ruleEntrySchema, type DocCluster, type InferredRule, type RuleCategory } from "@wastech-mdlint/core";

import { EXIT_CODE_SUCCESS, EXIT_CODE_USAGE_ERROR } from "../src/commands.js";
import {
  buildConfigPreview,
  DEFAULT_EXISTING_CONFIG_ACTION,
  diffAgainstExistingRuleIds,
  formatDraftSummary,
  groupInferredRulesByCategory,
  readExistingRuleIds,
  type ConfirmedInitSelections,
  type InitPrompter
} from "../src/init-command.js";
import { buildExistingConfigActionPromptConfig, buildPackageManagerPromptConfig } from "../src/init-prompter.js";
import { runCli, type CliIo } from "../src/program.js";

function createMemoryWriter() {
  let text = "";
  return {
    stream: {
      write(chunk: string) {
        text += chunk;
        return true;
      }
    },
    read() {
      return text;
    }
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-init-"));
  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return root;
}

async function run(argv: string[], cwd: string, ioOverrides: Partial<CliIo> = {}) {
  const stdout = createMemoryWriter();
  const stderr = createMemoryWriter();
  const exitCode = await runCli(argv, { cwd, stdout: stdout.stream, stderr: stderr.stream, ...ioOverrides });
  return { exitCode, stdout: stdout.read(), stderr: stderr.read() };
}

// A --yes-shaped prompter: every method returns exactly what --yes would pick without a prompt, so
// tests can assert interactive output is byte-identical to --yes output.
function createDefaultFakePrompter(overrides: Partial<InitPrompter> = {}): InitPrompter {
  return {
    resolveExistingConfigAction: overrides.resolveExistingConfigAction ?? (async () => "skip"),
    choosePackageManager: overrides.choosePackageManager ?? (async () => undefined),
    selectClusters: overrides.selectClusters ?? (async (clusters) => clusters),
    selectCategories: overrides.selectCategories ?? (async (categories) => categories),
    confirmDraft: overrides.confirmDraft ?? (async () => true)
  };
}

// Cross-linked docs/ cluster: two local links (one anchored) + a real anchor match (REF-001/002),
// a two-node reference cycle (GRP-001), a table (TBL-002), and an unchecked checklist item
// (CTX-002). "docs" is a known cluster name (DEFAULT_KNOWN_CLUSTER_NAMES) so 2 files qualify.
const CROSS_LINKED_DOCS_FIXTURE: Record<string, string> = {
  "docs/a.md": [
    "# A",
    "",
    "See [B](b.md) and [more detail](b.md#overview).",
    "",
    "## Tasks",
    "",
    "- [ ] write more docs",
    "",
    "| Name | Status |",
    "| --- | --- |",
    "| Widget | Done |",
    ""
  ].join("\n"),
  "docs/b.md": ["# B", "", "See [A](a.md).", "", "## Overview", "", "Additional detail about B.", ""].join("\n")
};

describe("init command · scan + inference draft", () => {
  it("--yes produces a deterministic draft that is byte-identical across runs", async () => {
    const cwdOne = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const cwdTwo = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const first = await run(["init", cwdOne, "--yes"], cwdOne);
    const second = await run(["init", cwdTwo, "--yes"], cwdTwo);

    expect(first.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toContain("docs/**/*.{md,mdx}");
    expect(first.stdout).toContain("- REF-001:");
    expect(first.stdout).toContain("- REF-002:");
    expect(first.stdout).toContain("- TBL-002:");
    expect(first.stdout).toContain("- CTX-002:");
    expect(first.stdout).toContain("- GRP-001:");
  });

  it("hands an interactive confirm the exact same draft --yes would print, exactly once", async () => {
    // Regression test for the double-print bug: a real prompter's confirmDraft is the only place
    // the draft is shown interactively, and `runInitCommand` must not also return it as `output`
    // once confirmed — otherwise the draft would be printed twice (once by the prompter, once more
    // by `runCli`'s final `stdout.write`).
    const yesCwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const yesResult = await run(["init", yesCwd, "--yes"], yesCwd);

    const interactiveCwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const confirmDraftCalls: string[] = [];
    const prompter = createDefaultFakePrompter({
      confirmDraft: async (summary) => {
        confirmDraftCalls.push(summary);
        return true;
      }
    });
    const interactiveResult = await run(["init", interactiveCwd], interactiveCwd, { isTty: true, initPrompter: prompter });

    expect(interactiveResult.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(confirmDraftCalls).toEqual([yesResult.stdout]);
    // Nothing left for runCli itself to print — the prompter already showed it once.
    expect(interactiveResult.stdout).toBe("");
  });

  it("never writes any file to disk", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    await run(["init", cwd, "--yes"], cwd);

    const entries = await Promise.all(
      Object.keys(CROSS_LINKED_DOCS_FIXTURE).map((relativePath) => readFile(path.join(cwd, relativePath), "utf8"))
    );
    expect(entries).toEqual(Object.values(CROSS_LINKED_DOCS_FIXTURE));
  });

  it("resolves a relative [path] argument against the injected cwd, not the real process.cwd()", async () => {
    // `cwd` here is a temp fixture dir, deliberately different from the real process.cwd() (the
    // repo root this test runs from). If "." were resolved against the wrong base, this scan
    // would cover the repo root instead of the tiny fixture and diverge from the absolute-path run.
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const absoluteResult = await run(["init", cwd, "--yes"], cwd);
    const relativeResult = await run(["init", ".", "--yes"], cwd);

    expect(relativeResult.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(relativeResult.stdout).toBe(absoluteResult.stdout);
  });
});

describe("init command · existing config handling", () => {
  const existingConfigText = JSON.stringify({ rules: [{ rule: "REF-001" }] });

  it("defaults to skip under --yes with no --on-existing, leaving the file untouched", async () => {
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": existingConfigText });

    const result = await run(["init", cwd, "--yes"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("skipped — existing config left untouched.");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe(existingConfigText);
  });

  it("--on-existing overwrite previews the full inferred draft without writing", async () => {
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": existingConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "overwrite"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("will be overwritten with the confirmed draft");
    expect(result.stdout).toContain("- REF-001:");
    expect(result.stdout).toContain("- GRP-001:");
    // Unlike merge, overwrite replaces the whole config, so the Include section still applies.
    expect(result.stdout).toContain("Include (");
    expect(result.stdout).toContain("docs/**/*.{md,mdx}");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe(existingConfigText);
  });

  it("--on-existing merge previews only the new-by-canonical-id rules and leaves existing ones unmentioned", async () => {
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": existingConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "merge"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("existing rules[] entries are left untouched");
    expect(result.stdout).not.toContain("WARNING");
    expect(result.stdout).not.toContain("- REF-001:");
    expect(result.stdout).toContain("- REF-002:");
    expect(result.stdout).toContain("- TBL-002:");
    expect(result.stdout).toContain("- CTX-002:");
    expect(result.stdout).toContain("- GRP-001:");
    // Merge is additive/existing-wins: include/exclude/settings must never appear as changing.
    expect(result.stdout).not.toContain("Include (");
    expect(result.stdout).not.toContain("docs/**/*.{md,mdx}");
    expect(result.stdout).toContain("Include / exclude / settings: left unchanged");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe(existingConfigText);
  });

  it("--on-existing skip previews the skip message and leaves the file untouched", async () => {
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": existingConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "skip"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("skipped — existing config left untouched.");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe(existingConfigText);
  });

  it("passes the existing-config prompt a repository-relative POSIX path, never an absolute one", async () => {
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": existingConfigText });

    const receivedPaths: string[] = [];
    const prompter = createDefaultFakePrompter({
      resolveExistingConfigAction: async (configPath) => {
        receivedPaths.push(configPath);
        return "skip";
      }
    });
    const result = await run(["init", cwd], cwd, { isTty: true, initPrompter: prompter });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(receivedPaths).toEqual(["wastech-mdlint.config.json"]);
    expect(receivedPaths[0]).not.toContain(cwd);
    expect(path.isAbsolute(receivedPaths[0]!)).toBe(false);
  });

  it("--on-existing merge warns instead of presenting the diff as authoritative when the existing config is malformed", async () => {
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": "{ not json" });

    const result = await run(["init", cwd, "--yes", "--on-existing", "merge"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("WARNING: the existing config could not be read or parsed");
    expect(result.stdout).toContain("- REF-001:");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe("{ not json");
  });

  it("--on-existing merge warns rather than merging cleanly when rules[] is JSONC-valid but not an array", async () => {
    const malformedConfigText = JSON.stringify({ rules: {} });
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": malformedConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "merge"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("WARNING: the existing config could not be read or parsed");
    expect(result.stdout).toContain("- REF-001:");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe(malformedConfigText);
  });

  // `findConfig` walks up from `[path]` to find the root config; the whole flow must then re-root
  // there too instead of scanning/inferring against the subdirectory the user happened to pass.
  describe("[path] targets a subdirectory of a repo with a root config", () => {
    async function fixtureWithRootConfigAndLockfile(): Promise<string> {
      return fixtureRepo({
        ...CROSS_LINKED_DOCS_FIXTURE,
        "wastech-mdlint.config.json": existingConfigText,
        "package-lock.json": "{}"
      });
    }

    it("--on-existing overwrite: re-rooted subdirectory run matches the root-invoked run byte for byte", async () => {
      const cwd = await fixtureWithRootConfigAndLockfile();

      const fromRoot = await run(["init", cwd, "--yes", "--on-existing", "overwrite"], cwd);
      const fromSubdirectory = await run(["init", "docs", "--yes", "--on-existing", "overwrite"], cwd);

      expect(fromSubdirectory.exitCode).toBe(EXIT_CODE_SUCCESS);
      expect(fromSubdirectory.stdout).toBe(fromRoot.stdout);
      // Re-rooted to the repo root: the config line names the file directly (no "../" prefix),
      // the root lockfile is detected, and the include glob is scoped from the repo root.
      expect(fromSubdirectory.stdout).toContain("Existing config found at wastech-mdlint.config.json:");
      expect(fromSubdirectory.stdout).not.toContain("..");
      expect(fromSubdirectory.stdout).toContain("Package manager: npm.");
      expect(fromSubdirectory.stdout).toContain("docs/**/*.{md,mdx}");
    });

    it("--on-existing merge: re-rooted subdirectory run matches the root-invoked run byte for byte", async () => {
      const cwd = await fixtureWithRootConfigAndLockfile();

      const fromRoot = await run(["init", cwd, "--yes", "--on-existing", "merge"], cwd);
      const fromSubdirectory = await run(["init", "docs", "--yes", "--on-existing", "merge"], cwd);

      expect(fromSubdirectory.exitCode).toBe(EXIT_CODE_SUCCESS);
      expect(fromSubdirectory.stdout).toBe(fromRoot.stdout);
      expect(fromSubdirectory.stdout).toContain("Existing config found at wastech-mdlint.config.json:");
      expect(fromSubdirectory.stdout).not.toContain("..");
      expect(fromSubdirectory.stdout).toContain("Package manager: npm.");
    });
  });
});

describe("init command · Ctrl+C and TTY guard", () => {
  it("exits 0 when a prompt is cancelled with Ctrl+C (ExitPromptError) from any prompt step", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const prompter = createDefaultFakePrompter({
      selectClusters: async () => {
        throw Object.assign(new Error("cancelled"), { name: "ExitPromptError" });
      }
    });

    const result = await run(["init", cwd], cwd, { isTty: true, initPrompter: prompter });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  });

  it("exits 0 on Ctrl+C from the final confirmation step too", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const prompter = createDefaultFakePrompter({
      confirmDraft: async () => {
        throw Object.assign(new Error("cancelled"), { name: "ExitPromptError" });
      }
    });

    const result = await run(["init", cwd], cwd, { isTty: true, initPrompter: prompter });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  });

  it("rejects a non-interactive invocation without --yes as a usage error", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", cwd], cwd, { isTty: false });

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain("init requires an interactive terminal");
  });

  it("rejects a TTY stdin paired with a non-TTY (piped) stdout as a usage error", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", cwd], cwd, { stdinIsTty: true, stdoutIsTty: false });

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain("init requires an interactive terminal");
  });

  it("rejects a TTY stdout paired with a non-TTY stdin as a usage error", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", cwd], cwd, { stdinIsTty: false, stdoutIsTty: true });

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain("init requires an interactive terminal");
  });

  it("proceeds interactively only when both stdin and stdout resolve to a TTY", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const prompter = createDefaultFakePrompter();

    const result = await run(["init", cwd], cwd, {
      stdinIsTty: true,
      stdoutIsTty: true,
      initPrompter: prompter
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  });
});

describe("init command · declined confirmation", () => {
  it("reports an abort without printing the draft when the user declines", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const prompter = createDefaultFakePrompter({ confirmDraft: async () => false });

    const result = await run(["init", cwd], cwd, { isTty: true, initPrompter: prompter });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toBe("Aborted: configuration not confirmed.\n");
  });
});

function buildDocCluster(overrides: Partial<DocCluster> & { path: string }): DocCluster {
  return {
    kind: "cluster",
    score: 3,
    subtreeCount: 3,
    includeGlob: `${overrides.path}/**/*.md`,
    sampleFiles: [],
    ...overrides
  };
}

function buildInferredRule(overrides: Partial<InferredRule> & { rule: string; category: RuleCategory }): InferredRule {
  return {
    description: "A rule description.",
    defaultSeverity: "warning",
    fixable: false,
    rationale: "Because the sample evidence says so.",
    ...overrides
  };
}

describe("groupInferredRulesByCategory", () => {
  it("groups by category, preserving each group's input order", () => {
    const refOne = buildInferredRule({ rule: "REF-001", category: "REF" });
    const tbl = buildInferredRule({ rule: "TBL-002", category: "TBL" });
    const refTwo = buildInferredRule({ rule: "REF-002", category: "REF" });

    const grouped = groupInferredRulesByCategory([refOne, tbl, refTwo]);

    expect(grouped.REF).toEqual([refOne, refTwo]);
    expect(grouped.TBL).toEqual([tbl]);
    expect(grouped.SEC).toBeUndefined();
  });
});

describe("diffAgainstExistingRuleIds", () => {
  it("filters out rules whose canonical id is already present, case/dash-insensitively", () => {
    const refOne = buildInferredRule({ rule: "REF-001", category: "REF" });
    const refTwo = buildInferredRule({ rule: "REF-002", category: "REF" });

    const { newRules } = diffAgainstExistingRuleIds(["ref001"], [refOne, refTwo]);

    expect(newRules).toEqual([refTwo]);
  });

  it("treats no existing ids as every rule being new", () => {
    const refOne = buildInferredRule({ rule: "REF-001", category: "REF" });
    const { newRules } = diffAgainstExistingRuleIds([], [refOne]);
    expect(newRules).toEqual([refOne]);
  });
});

describe("buildConfigPreview", () => {
  it("dedupes/sorts include globs and shapes rules into a LintConfig-compatible slice", () => {
    const clusterA = buildDocCluster({ path: "docs" });
    const clusterB = buildDocCluster({ path: "docs" }); // same includeGlob — must dedupe.
    const sec001 = buildInferredRule({
      rule: "SEC-001",
      category: "SEC",
      options: { files: ["docs/**/*.md"], sections: ["Status", "Context", "Decision"] }
    });

    const preview = buildConfigPreview([clusterA, clusterB], [sec001]);

    expect(preview.include).toEqual(["docs/**/*.md"]);
    expect(preview.rules).toEqual([
      { rule: "SEC-001", options: { files: ["docs/**/*.md"], sections: ["Status", "Context", "Decision"] } }
    ]);
  });

  it("omits the options key entirely for a rule with no derived options", () => {
    const preview = buildConfigPreview([], [buildInferredRule({ rule: "REF-001", category: "REF" })]);
    expect(preview.rules).toEqual([{ rule: "REF-001" }]);
    expect(Object.keys(preview.rules[0]!)).not.toContain("options");
  });

  it("stays forward-compatible with lintConfigSchema/ruleEntrySchema (P6.04 smoke check)", () => {
    const cluster = buildDocCluster({ path: "docs" });
    const rule = buildInferredRule({
      rule: "SEC-001",
      category: "SEC",
      options: { files: ["docs/**/*.md"], sections: ["Status"] }
    });

    const preview = buildConfigPreview([cluster], [rule]);

    expect(lintConfigSchema.safeParse(preview).success).toBe(true);
    for (const entry of preview.rules) {
      expect(ruleEntrySchema.safeParse(entry).success).toBe(true);
    }
  });
});

describe("formatDraftSummary", () => {
  function buildSelections(overrides: Partial<ConfirmedInitSelections> = {}): ConfirmedInitSelections {
    return {
      existingConfigAction: "none",
      packageManager: undefined,
      clusters: [],
      rules: [],
      newRuleIds: [],
      existingConfigUnreadable: false,
      ...overrides
    };
  }

  it("reports no existing config and no detected package manager", () => {
    const summary = formatDraftSummary(buildSelections(), undefined);
    expect(summary).toContain("Existing config: none found.");
    expect(summary).toContain("Package manager: not detected.");
    expect(summary).toContain("(none — no Markdown clusters detected)");
    expect(summary).toContain("(none inferred)");
  });

  it("groups rules under sorted category headings regardless of input order", () => {
    const tbl = buildInferredRule({ rule: "TBL-002", category: "TBL" });
    const ctx = buildInferredRule({ rule: "CTX-002", category: "CTX" });
    const summary = formatDraftSummary(buildSelections({ rules: [tbl, ctx] }), undefined);

    const ctxIndex = summary.indexOf("CTX:");
    const tblIndex = summary.indexOf("TBL:");
    expect(ctxIndex).toBeGreaterThan(-1);
    expect(tblIndex).toBeGreaterThan(ctxIndex);
  });

  it("describes a merge as leaving existing entries untouched and counts the new ones", () => {
    const rule = buildInferredRule({ rule: "REF-002", category: "REF" });
    // Selected clusters are non-empty here specifically to prove the Include section is
    // deliberately suppressed for merge, not just trivially empty.
    const cluster = buildDocCluster({ path: "docs" });
    const summary = formatDraftSummary(
      buildSelections({ existingConfigAction: "merge", clusters: [cluster], rules: [rule], newRuleIds: ["REF-002"] }),
      "wastech-mdlint.config.json"
    );

    expect(summary).toContain("wastech-mdlint.config.json");
    expect(summary).toContain("existing rules[] entries are left untouched");
    expect(summary).toContain("1 new rule(s)");
    expect(summary).not.toContain("WARNING");
    // Merge must not present an Include section — it never touches include/exclude/settings.
    expect(summary).not.toContain("Include (");
    expect(summary).not.toContain(cluster.includeGlob);
    expect(summary).toContain("Include / exclude / settings: left unchanged");
  });

  it("warns instead of presenting the merge diff as authoritative when the existing config was unreadable", () => {
    const rule = buildInferredRule({ rule: "REF-002", category: "REF" });
    const summary = formatDraftSummary(
      buildSelections({
        existingConfigAction: "merge",
        rules: [rule],
        newRuleIds: ["REF-002"],
        existingConfigUnreadable: true
      }),
      "wastech-mdlint.config.json"
    );

    expect(summary).toContain("WARNING: the existing config could not be read or parsed");
  });
});

describe("readExistingRuleIds", () => {
  it("returns parsed: false and no ids rather than throwing on a malformed config", async () => {
    const cwd = await fixtureRepo({ "broken.json": "{ not json" });
    const result = await readExistingRuleIds(cwd, path.join(cwd, "broken.json"));
    expect(result).toEqual({ ruleIds: [], parsed: false });
  });

  it("returns parsed: false for a missing file rather than throwing", async () => {
    const cwd = await fixtureRepo({});
    const result = await readExistingRuleIds(cwd, path.join(cwd, "does-not-exist.json"));
    expect(result).toEqual({ ruleIds: [], parsed: false });
  });

  it("returns parsed: true with [] for a validly-parsed config with no rules[]", async () => {
    const cwd = await fixtureRepo({ "wastech-mdlint.config.json": JSON.stringify({ include: ["**/*.md"] }) });
    const result = await readExistingRuleIds(cwd, path.join(cwd, "wastech-mdlint.config.json"));
    expect(result).toEqual({ ruleIds: [], parsed: true });
  });

  it("returns parsed: false for a JSONC-valid config whose rules key isn't an array", async () => {
    const cwd = await fixtureRepo({ "wastech-mdlint.config.json": JSON.stringify({ rules: {} }) });
    const result = await readExistingRuleIds(cwd, path.join(cwd, "wastech-mdlint.config.json"));
    expect(result).toEqual({ ruleIds: [], parsed: false });
  });

  it("returns parsed: false when rules is a scalar rather than an array", async () => {
    const cwd = await fixtureRepo({ "wastech-mdlint.config.json": JSON.stringify({ rules: "REF-001" }) });
    const result = await readExistingRuleIds(cwd, path.join(cwd, "wastech-mdlint.config.json"));
    expect(result).toEqual({ ruleIds: [], parsed: false });
  });

  it("parses JSONC (comments + trailing commas), canonicalizing every rule id", async () => {
    const cwd = await fixtureRepo({
      "wastech-mdlint.config.json": [
        "{",
        "  // rationale: link integrity",
        '  "rules": [',
        '    { "rule": "ref001" },',
        '    { "rule": "TBL-002" },',
        "  ],",
        "}"
      ].join("\n")
    });

    const result = await readExistingRuleIds(cwd, path.join(cwd, "wastech-mdlint.config.json"));
    expect(result).toEqual({ ruleIds: ["REF-001", "TBL-002"], parsed: true });
  });
});

// Real `@inquirer/prompts` calls hang without a live TTY (confirmed elsewhere in this suite: even
// a redirected /dev/null stdin never resolves), so these assert the exact `default` handed to the
// real `select()` call — the config that decides what plain Enter resolves to — as a stand-in for
// actually driving the prompt. That default must never silently diverge from what `--yes` does.
describe("interactive prompt defaults match --yes", () => {
  it("resolveExistingConfigAction's prompt defaults to the same action --yes falls back to", () => {
    const config = buildExistingConfigActionPromptConfig("wastech-mdlint.config.json");
    expect(config.default).toBe(DEFAULT_EXISTING_CONFIG_ACTION);
    expect(config.default).toBe("skip");
    // The default must also be one of the real offered choices, not a dangling value.
    expect(config.choices.map((choice) => choice.value)).toContain(config.default);
  });

  it("choosePackageManager's prompt defaults to \"not detected\", not the first listed manager", () => {
    const config = buildPackageManagerPromptConfig();
    expect(config.default).toBeUndefined();
    // "none of these" (value: undefined) must be an offered choice, not just an unreachable default.
    expect(config.choices.map((choice) => choice.value)).toContain(undefined);
  });
});
