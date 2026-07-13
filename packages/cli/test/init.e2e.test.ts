import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parse as parseJsonc } from "jsonc-parser";

import {
  generateConfigSchema,
  lintConfigSchema,
  loadConfiguration,
  ruleEntrySchema,
  type DocCluster,
  type InferredRule,
  type RuleCategory
} from "@wastech-mdlint/core";

import { EXIT_CODE_SUCCESS, EXIT_CODE_USAGE_ERROR } from "../src/commands.js";
import {
  buildConfigPreview,
  DEFAULT_EXISTING_CONFIG_ACTION,
  diffAgainstExistingRuleIds,
  formatDraftSummary,
  formatNotWrittenSummary,
  formatWriteSummary,
  groupInferredRulesByCategory,
  readExistingRuleIds,
  type ConfirmedInitSelections,
  type InitPrompter
} from "../src/init-command.js";
import {
  buildCiWorkflowPromptConfig,
  buildExistingConfigActionPromptConfig,
  buildPackageManagerPromptConfig
} from "../src/init-prompter.js";
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
    confirmDraft: overrides.confirmDraft ?? (async () => true),
    confirmCiWorkflow: overrides.confirmCiWorkflow ?? (async () => false)
  };
}

const CONFIG_FILE = "wastech-mdlint.config.json";

function readConfig(text: string): Record<string, unknown> {
  return parseJsonc(text) as Record<string, unknown>;
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

// A deliberately clean derivation of CROSS_LINKED_DOCS_FIXTURE (P6.05 deliverable 3 + the P6 exit
// criterion "on a clean fixture, lint exits 0"). Two surgical edits keep the *same* inferred rule
// set the byte-identical draft test already proves — REF-001/REF-002/TBL-002/CTX-002/GRP-001 — so
// the new test only has to prove the new property (zero findings): the checklist item is checked
// (CTX-002 clean) and docs/b.md's back-link to a.md is dropped so a↔b is a DAG, not a cycle
// (GRP-001 clean). The resolvable link + real anchor + filled table stay, so REF-001/REF-002/TBL-002
// still infer and still pass.
const CLEAN_DOCS_FIXTURE: Record<string, string> = {
  "docs/a.md": [
    "# A",
    "",
    "See [B](b.md) and [more detail](b.md#overview).",
    "",
    "## Tasks",
    "",
    "- [x] write more docs",
    "",
    "| Name | Status |",
    "| --- | --- |",
    "| Widget | Done |",
    ""
  ].join("\n"),
  "docs/b.md": ["# B", "", "## Overview", "", "Additional detail about B.", ""].join("\n")
};

// A clean custom layout (specs/ + adr/), both non-`docs/` known cluster names. It does triple duty:
// deliverable 1's "custom layout" fixture, deliverable 3's "clean fixture lints clean", and the only
// fixture that exercises SEC-001's clean path (plain docs/ never infers SEC-001). specs/ is a
// one-directional resolvable link + a checked checklist + a filled table (REF-001/CTX-002/TBL-002/
// GRP-001 clean, no cycle, no anchor so no REF-002). adr/ carries two files with Status/Context/
// Decision headings, modeled on rule-inference.test.ts's proven ADR shape, so SEC-001 is inferred
// scoped to adr/**/*.{md,mdx} and passes (every adr file has all three sections).
const CUSTOM_LAYOUT_FIXTURE: Record<string, string> = {
  "specs/overview.md": [
    "# Overview",
    "",
    "See the [details](details.md).",
    "",
    "## Tasks",
    "",
    "- [x] draft the spec",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| Owner | Team A |",
    ""
  ].join("\n"),
  "specs/details.md": ["# Details", "", "Concrete detail about the spec.", ""].join("\n"),
  "adr/0001-use-typescript.md": [
    "# ADR 0001: Use TypeScript",
    "",
    "## Status",
    "",
    "Accepted",
    "",
    "## Context",
    "",
    "We need a language.",
    "",
    "## Decision",
    "",
    "Use TypeScript.",
    ""
  ].join("\n"),
  "adr/0002-use-vitest.md": [
    "# ADR 0002: Use Vitest",
    "",
    "## Status",
    "",
    "Accepted",
    "",
    "## Context",
    "",
    "We need a test runner.",
    "",
    "## Decision",
    "",
    "Use Vitest.",
    ""
  ].join("\n")
};

// A small npm monorepo: a workspace root (package.json `workspaces` + package-lock.json → npm) with
// two nested packages, each carrying its own docs/ cluster. Scoped to shape/determinism only (not
// clean-lint): each package's docs/ reuses the cross-linked cycle shape — cleanliness is proven by
// the docs/ and custom fixtures, so this one only proves per-package cluster detection, a
// deterministic sorted root `include` spanning both packages, and that loadConfiguration accepts it.
const MONOREPO_FIXTURE: Record<string, string> = {
  "package.json": JSON.stringify({ name: "monorepo", private: true, workspaces: ["packages/*"] }),
  "package-lock.json": "{}",
  "packages/alpha/package.json": JSON.stringify({ name: "alpha" }),
  "packages/alpha/docs/a.md": ["# A", "", "See [B](b.md).", ""].join("\n"),
  "packages/alpha/docs/b.md": ["# B", "", "See [A](a.md).", ""].join("\n"),
  "packages/beta/package.json": JSON.stringify({ name: "beta" }),
  "packages/beta/docs/a.md": ["# A", "", "See [B](b.md).", ""].join("\n"),
  "packages/beta/docs/b.md": ["# B", "", "See [A](a.md).", ""].join("\n")
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
    // The draft the prompter was shown is a prefix of --yes's output (which appends a write summary
    // the interactive run reserves for its own second stage).
    expect(confirmDraftCalls).toHaveLength(1);
    expect(yesResult.stdout.startsWith(confirmDraftCalls[0]!)).toBe(true);
    // Interactive run: the prompter already showed the draft, so runCli only prints the write
    // summary — non-empty now that P6.04 actually writes.
    expect(interactiveResult.stdout).not.toBe("");
    expect(interactiveResult.stdout).toContain(`Wrote ${CONFIG_FILE}`);
  });

  it("leaves the sampled Markdown fixture files untouched", async () => {
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
    // Separate fixtures per run: init now writes a config, so a second run against the same cwd
    // would find that written config and default to skip instead of re-inferring.
    const absoluteCwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const relativeCwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const absoluteResult = await run(["init", absoluteCwd, "--yes"], absoluteCwd);
    const relativeResult = await run(["init", ".", "--yes"], relativeCwd);

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

  it("--on-existing overwrite writes the full inferred config, replacing the existing one", async () => {
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": existingConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "overwrite"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("will be overwritten with the confirmed draft");
    expect(result.stdout).toContain(`Wrote ${CONFIG_FILE}`);

    const written = readConfig(await readFile(path.join(cwd, CONFIG_FILE), "utf8"));
    const ruleIds = (written.rules as { rule: string }[]).map((entry) => entry.rule);
    // Overwrite replaces the whole config: the freshly inferred canonical ids, the package $schema.
    expect(ruleIds).toContain("REF-001");
    expect(ruleIds).toContain("GRP-001");
    expect(written.include).toContain("docs/**/*.{md,mdx}");
    expect(written.$schema).toBe("./node_modules/@wastech-mdlint/cli/schema.json");
  });

  it("--on-existing merge appends only new-by-canonical-id rules and keeps existing ones verbatim", async () => {
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": existingConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "merge"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("existing rules[] entries are left untouched");
    expect(result.stdout).not.toContain("WARNING");
    expect(result.stdout).toContain(`Merged ${CONFIG_FILE}`);

    const written = readConfig(await readFile(path.join(cwd, CONFIG_FILE), "utf8"));
    const ruleIds = (written.rules as { rule: string }[]).map((entry) => entry.rule);
    // Existing REF-001 preserved (still first), new rules appended, package $schema (no custom rule).
    expect(ruleIds[0]).toBe("REF-001");
    expect(ruleIds).toContain("REF-002");
    expect(ruleIds).toContain("TBL-002");
    expect(ruleIds).toContain("GRP-001");
    expect(written.$schema).toBe("./node_modules/@wastech-mdlint/cli/schema.json");
  });

  it("--on-existing skip previews the skip message and leaves the file untouched", async () => {
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": existingConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "skip"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("skipped — existing config left untouched.");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe(existingConfigText);
  });

  it("--on-existing skip never touches the filesystem, even with --with-ci-workflow", async () => {
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      ".git/HEAD": "ref: refs/heads/main\n",
      "wastech-mdlint.config.json": existingConfigText
    });

    const result = await run(["init", cwd, "--yes", "--on-existing", "skip", "--with-ci-workflow"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("skipped — existing config left untouched.");
    // skip is a strict no-write outcome (plan invariant): no CI workflow, no config change.
    expect(result.stdout).not.toContain("Wrote CI workflow");
    await expect(readFile(path.join(cwd, ".github", "workflows", "wastech-mdlint.yml"), "utf8")).rejects.toThrow();
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
    expect(result.stdout).toContain("WARNING: the existing config could not be read, parsed, or validated");
    expect(result.stdout).toContain("- REF-001:");
    // Unreadable + merge aborts the write: the file is untouched and the output says so explicitly.
    expect(result.stdout).toContain("Not written:");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe("{ not json");
  });

  it("--on-existing merge warns rather than merging cleanly when rules[] is JSONC-valid but not an array", async () => {
    const malformedConfigText = JSON.stringify({ rules: {} });
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": malformedConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "merge"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("WARNING: the existing config could not be read, parsed, or validated");
    expect(result.stdout).toContain("- REF-001:");
    expect(result.stdout).toContain("Not written:");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe(malformedConfigText);
  });

  it("--on-existing merge aborts when rules[] is an array with an unidentifiable entry", async () => {
    // `["REF-001"]` is array-shaped but the bare-string entry can't be canonically diffed, so
    // merging would append an inferred REF-001 as a duplicate — the additive existing-wins contract
    // forbids that, so the write aborts and the file is left untouched.
    const malformedConfigText = JSON.stringify({ rules: ["REF-001"] });
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": malformedConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "merge"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("WARNING: the existing config could not be read, parsed, or validated");
    expect(result.stdout).toContain("Not written:");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe(malformedConfigText);
  });

  it("--on-existing merge aborts when a custom entry can't be canonically identified", async () => {
    // A `rule: "custom"` entry with no usable `id` (missing here) can't be diffed or schema-wired, so
    // the merge aborts rather than rewrite a config it can't reason about (additive-merge safety).
    const malformedConfigText = JSON.stringify({
      rules: [{ rule: "custom", options: { assert: { kind: "sectionPresent", sections: ["X"] } } }]
    });
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": malformedConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "merge"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("WARNING: the existing config could not be read, parsed, or validated");
    expect(result.stdout).toContain("Not written:");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe(malformedConfigText);
  });

  it("--on-existing merge aborts when the existing config parses but loadConfiguration rejects it", async () => {
    // Parses fine and every rule id is identifiable, but an unknown top-level key fails the strict
    // root schema. Preserving it verbatim would write a config `loadConfiguration` rejects, so the
    // merge aborts instead of reporting a successful (but invalid) write.
    const invalidConfigText = JSON.stringify({ notARealKey: true, rules: [{ rule: "REF-001" }] });
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, "wastech-mdlint.config.json": invalidConfigText });

    const result = await run(["init", cwd, "--yes", "--on-existing", "merge"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("WARNING: the existing config could not be read, parsed, or validated");
    expect(result.stdout).toContain("Not written:");
    await expect(readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8")).resolves.toBe(invalidConfigText);
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
      // Separate fixtures per run: init now writes, so reusing one cwd would let the first run's
      // write change what the second run observes.
      const rootCwd = await fixtureWithRootConfigAndLockfile();
      const subdirCwd = await fixtureWithRootConfigAndLockfile();

      const fromRoot = await run(["init", rootCwd, "--yes", "--on-existing", "overwrite"], rootCwd);
      const fromSubdirectory = await run(["init", "docs", "--yes", "--on-existing", "overwrite"], subdirCwd);

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
      const rootCwd = await fixtureWithRootConfigAndLockfile();
      const subdirCwd = await fixtureWithRootConfigAndLockfile();

      const fromRoot = await run(["init", rootCwd, "--yes", "--on-existing", "merge"], rootCwd);
      const fromSubdirectory = await run(["init", "docs", "--yes", "--on-existing", "merge"], subdirCwd);

      expect(fromSubdirectory.exitCode).toBe(EXIT_CODE_SUCCESS);
      expect(fromSubdirectory.stdout).toBe(fromRoot.stdout);
      expect(fromSubdirectory.stdout).toContain("Existing config found at wastech-mdlint.config.json:");
      expect(fromSubdirectory.stdout).not.toContain("..");
      expect(fromSubdirectory.stdout).toContain("Package manager: npm.");
    });
  });
});

describe("init command · writing the config (P6.04)", () => {
  it("--yes with no existing config writes a config loadConfiguration accepts", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", cwd, "--yes"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain(`Wrote ${CONFIG_FILE}`);
    const written = readConfig(await readFile(path.join(cwd, CONFIG_FILE), "utf8"));
    expect(written.$schema).toBe("./node_modules/@wastech-mdlint/cli/schema.json");
    // Deliverable 1 / C1: the fresh write prunes the noise trees, so init never broadens the
    // scanned corpus back to node_modules/.git/dist after writing.
    expect(written.exclude).toContain("node_modules/**");
    expect(written.exclude).toContain(".git/**");
    // Forward-compat smoke check: the written config must load without a ConfigError.
    await expect(loadConfiguration({ cwd })).resolves.toBeDefined();
  });

  it("merge preserving a custom rule writes a project-local schema and points $schema at it", async () => {
    const customConfig = JSON.stringify({
      rules: [
        {
          rule: "custom",
          id: "REQ-100",
          description: "Requires an Owner section.",
          options: { assert: { kind: "sectionPresent", sections: ["Owner"] } }
        }
      ]
    });
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, [CONFIG_FILE]: customConfig });

    const result = await run(["init", cwd, "--yes", "--on-existing", "merge"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    const written = readConfig(await readFile(path.join(cwd, CONFIG_FILE), "utf8"));
    expect(written.$schema).toBe("./schema.json");
    const schemaText = await readFile(path.join(cwd, "schema.json"), "utf8");
    expect(schemaText).toBe(
      generateConfigSchema({ customRules: [{ id: "REQ-100", description: "Requires an Owner section." }] })
    );
  });

  it("--yes --with-ci-workflow writes the workflow file; plain --yes does not", async () => {
    const workflowPath = path.join(".github", "workflows", "wastech-mdlint.yml");

    const withCwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const withResult = await run(["init", withCwd, "--yes", "--with-ci-workflow"], withCwd);
    expect(withResult.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(withResult.stdout).toContain("Wrote CI workflow");
    const workflow = await readFile(path.join(withCwd, workflowPath), "utf8");
    // Self-contained: installs the published CLI and runs it directly (P9.03's composite Action is
    // not built yet, so no `uses:` reference to a not-yet-published Action).
    expect(workflow).toContain("npm install --no-save @wastech-mdlint/cli");
    expect(workflow).toContain("npx wastech-mdlint lint --fail-on error");

    const withoutCwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    await run(["init", withoutCwd, "--yes"], withoutCwd);
    await expect(readFile(path.join(withoutCwd, workflowPath), "utf8")).rejects.toThrow();
  });

  it("anchors the CI workflow at the git root (not the target subdirectory) and passes the config path", async () => {
    const workflowPath = path.join(".github", "workflows", "wastech-mdlint.yml");
    // A git repo whose Markdown lives under docs/, with no existing config anywhere.
    const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, ".git/HEAD": "ref: refs/heads/main\n" });

    const result = await run(["init", "docs", "--yes", "--with-ci-workflow"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // The summary reports the repo-relative path, so a subdirectory run says where the config landed.
    expect(result.stdout).toContain("Wrote docs/wastech-mdlint.config.json");
    // Config is written into the targeted subdirectory, and its local `$schema` points up at the
    // repo-root node_modules — not a path nested under docs/ that would resolve to nothing.
    const written = readConfig(await readFile(path.join(cwd, "docs", CONFIG_FILE), "utf8"));
    expect(written.$schema).toBe("../node_modules/@wastech-mdlint/cli/schema.json");
    // ...but the workflow is anchored at the repo root, where GitHub will actually load it, and it
    // scopes lint to the config's directory (so include/exclude resolve there) plus an explicit
    // --config — both single-quoted, POSIX, relative to the repo root.
    const workflow = await readFile(path.join(cwd, workflowPath), "utf8");
    expect(workflow).toContain("npx wastech-mdlint lint 'docs' --fail-on error --config 'docs/wastech-mdlint.config.json'");
    // The dead-workflow location under docs/ is never created.
    await expect(readFile(path.join(cwd, "docs", workflowPath), "utf8")).rejects.toThrow();
  });

  it("writes a nested config whose workflow lint command actually lints that subtree", async () => {
    // docs/ has a broken local link (REF-001 evidence + a real violation). The workflow scopes lint
    // to the config directory, so running that same command must load the nested config and scan the
    // nested tree — not lint the repo root against docs-relative globs and find nothing.
    const cwd = await fixtureRepo({
      ".git/HEAD": "ref: refs/heads/main\n",
      "docs/a.md": "# A\n\nSee [missing](nope.md).\n",
      "docs/b.md": "# B\n\nSee [A](a.md).\n"
    });

    const initResult = await run(["init", "docs", "--yes"], cwd);
    expect(initResult.exitCode).toBe(EXIT_CODE_SUCCESS);

    // Mirror the workflow's `lint <configDir> --config <configPath>` (absolute here so the lint cwd
    // is unambiguous, exactly as the repo-root-run workflow resolves `docs`).
    const lintResult = await run(
      ["lint", path.join(cwd, "docs"), "--config", path.join(cwd, "docs", CONFIG_FILE)],
      cwd
    );

    // Not a usage/config error (2): the nested config loaded. REF-001 fired on the broken link,
    // proving lint scanned the docs subtree rather than an empty/wrong root.
    expect(lintResult.exitCode).not.toBe(EXIT_CODE_USAGE_ERROR);
    expect(lintResult.stdout).toContain("REF-001");
  });

  it("anchors schema and workflow at the project root even without .git (package.json marks it)", async () => {
    const workflowPath = path.join(".github", "workflows", "wastech-mdlint.yml");
    // A valid non-git project: no `.git`, but `package.json` at the root marks the install root.
    const cwd = await fixtureRepo({
      "package.json": JSON.stringify({ name: "proj" }),
      "docs/a.md": "# A\n\nSee [B](b.md).\n",
      "docs/b.md": "# B\n\nSee [A](a.md).\n"
    });

    const result = await run(["init", "docs", "--yes", "--with-ci-workflow"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // `$schema` resolves up to the project-root node_modules, not `./node_modules` inside docs/.
    const written = readConfig(await readFile(path.join(cwd, "docs", CONFIG_FILE), "utf8"));
    expect(written.$schema).toBe("../node_modules/@wastech-mdlint/cli/schema.json");
    // Workflow is anchored at the project root, not under docs/.
    await expect(readFile(path.join(cwd, workflowPath), "utf8")).resolves.toContain(
      "--config 'docs/wastech-mdlint.config.json'"
    );
    await expect(readFile(path.join(cwd, "docs", workflowPath), "utf8")).rejects.toThrow();
  });

  it("anchors at the git repo root for a nested workspace package (not the package dir)", async () => {
    const workflowPath = path.join(".github", "workflows", "wastech-mdlint.yml");
    // A monorepo: `.git` + workspace `package.json` at the root, and a nested package with its own
    // `package.json`. Running init inside the nested package must still anchor at the repo root.
    const cwd = await fixtureRepo({
      ".git/HEAD": "ref: refs/heads/main\n",
      "package.json": JSON.stringify({ name: "monorepo", workspaces: ["packages/*"] }),
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/foo/a.md": "# A\n\nSee [B](b.md).\n",
      "packages/foo/b.md": "# B\n\nSee [A](a.md).\n"
    });

    const result = await run(["init", "packages/foo", "--yes", "--with-ci-workflow"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // `$schema` climbs to the repo-root node_modules (two levels up), not the package's own.
    const written = readConfig(await readFile(path.join(cwd, "packages", "foo", CONFIG_FILE), "utf8"));
    expect(written.$schema).toBe("../../node_modules/@wastech-mdlint/cli/schema.json");
    // Workflow lives at the repo root (where GitHub loads it), pointed at the nested config...
    const workflow = await readFile(path.join(cwd, workflowPath), "utf8");
    expect(workflow).toContain("--config 'packages/foo/wastech-mdlint.config.json'");
    // ...and never at the dead `packages/foo/.github/...` location.
    await expect(readFile(path.join(cwd, "packages", "foo", workflowPath), "utf8")).rejects.toThrow();
  });

  it("never anchors the CI workflow or $schema above the user's home directory", async () => {
    // A realistic hazard: the home directory is itself a git repo (a common dotfiles setup), and the
    // actual project being bootstrapped sits underneath it with no `.git`/`package.json` of its own
    // yet (the ordinary "init before git init" case). The repo-root/schema-anchor walk must stop
    // before reaching the home directory rather than mistake the unrelated dotfiles repo for the
    // project root and write files there.
    const fakeHome = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-fakehome-"));
    tempDirs.push(fakeHome);
    await mkdir(path.join(fakeHome, ".git"), { recursive: true });
    const projectDir = path.join(fakeHome, "projects", "my-docs");
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "a.md"), "# A\n\nSee [B](b.md).\n", "utf8");
    await writeFile(path.join(projectDir, "b.md"), "# B\n\nSee [A](a.md).\n", "utf8");

    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
    try {
      const result = await run(["init", projectDir, "--yes", "--with-ci-workflow"], projectDir);

      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      // Must never land at the unrelated dotfiles-repo root...
      await expect(
        readFile(path.join(fakeHome, ".github", "workflows", "wastech-mdlint.yml"), "utf8")
      ).rejects.toThrow();
      // ...it stays anchored at the actual target directory instead (no ancestor qualifies).
      await expect(
        readFile(path.join(projectDir, ".github", "workflows", "wastech-mdlint.yml"), "utf8")
      ).resolves.toBeDefined();
      const written = readConfig(await readFile(path.join(projectDir, CONFIG_FILE), "utf8"));
      expect(written.$schema).toBe("./node_modules/@wastech-mdlint/cli/schema.json");
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("shell-quotes a config path with spaces so the lint command stays a single argument", async () => {
    const workflowPath = path.join(".github", "workflows", "wastech-mdlint.yml");
    // A legal target directory containing a space: the config path must not split into two tokens.
    const cwd = await fixtureRepo({
      ".git/HEAD": "ref: refs/heads/main\n",
      "doc site/a.md": "# A\n\nSee [B](b.md).\n",
      "doc site/b.md": "# B\n\nSee [A](a.md).\n"
    });

    const result = await run(["init", "doc site", "--yes", "--with-ci-workflow"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    await expect(readFile(path.join(cwd, "doc site", CONFIG_FILE), "utf8")).resolves.toBeDefined();
    const workflow = await readFile(path.join(cwd, workflowPath), "utf8");
    // Single-quoted as one shell argument — never the bare, space-split `--config doc site/...`.
    expect(workflow).toContain("--config 'doc site/wastech-mdlint.config.json'");
    expect(workflow).not.toContain("--config doc site/");
  });

  it("never overwrites an existing CI workflow file", async () => {
    const workflowPath = path.join(".github", "workflows", "wastech-mdlint.yml");
    const existingWorkflowText = "name: hand-written\non: push\n";
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      [workflowPath]: existingWorkflowText
    });

    const result = await run(["init", cwd, "--yes", "--with-ci-workflow"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // Never clobber a file the user already owns — no "Wrote CI workflow" line, and the file is
    // byte-for-byte untouched (the offer is skipped before ever reaching the prompt/write step).
    expect(result.stdout).not.toContain("Wrote CI workflow");
    await expect(readFile(path.join(cwd, workflowPath), "utf8")).resolves.toBe(existingWorkflowText);
  });

  it("interactive mode always prompts for the CI workflow, even with --with-ci-workflow set", async () => {
    // `--with-ci-workflow` only pre-answers the prompt under `--yes` (mirrors `--on-existing`);
    // interactively the flag must not silently bypass confirmCiWorkflow.
    let confirmCiWorkflowCalls = 0;
    const prompter = createDefaultFakePrompter({
      confirmCiWorkflow: async () => {
        confirmCiWorkflowCalls += 1;
        return false;
      }
    });
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", cwd, "--with-ci-workflow"], cwd, { isTty: true, initPrompter: prompter });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(confirmCiWorkflowCalls).toBe(1);
    expect(result.stdout).not.toContain("Wrote CI workflow");
    await expect(
      readFile(path.join(cwd, ".github", "workflows", "wastech-mdlint.yml"), "utf8")
    ).rejects.toThrow();
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

  it("Ctrl+C at the post-write CI-workflow prompt keeps the already-written config + summary", async () => {
    // This prompt runs after the config is on disk; cancelling it must not discard the write summary
    // and make the mutated repo look untouched. Cancellation is treated as "no workflow".
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const prompter = createDefaultFakePrompter({
      confirmDraft: async () => true,
      confirmCiWorkflow: async () => {
        throw Object.assign(new Error("cancelled"), { name: "ExitPromptError" });
      }
    });

    const result = await run(["init", cwd], cwd, { isTty: true, initPrompter: prompter });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // The config was written and its summary printed — cancellation only skipped the workflow.
    expect(result.stdout).toContain(`Wrote ${CONFIG_FILE}`);
    expect(result.stdout).not.toContain("Wrote CI workflow");
    await expect(readFile(path.join(cwd, CONFIG_FILE), "utf8")).resolves.toBeDefined();
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

    expect(summary).toContain("WARNING: the existing config could not be read, parsed, or validated");
  });
});

describe("formatWriteSummary", () => {
  function buildResult(
    overrides: Partial<{
      configText: string;
      schemaRef: string;
      projectSchema?: { fileName: string; text: string };
      addedRuleCount: number;
      totalRuleCount: number;
    }> = {}
  ) {
    return {
      configText: "{}\n",
      schemaRef: "./node_modules/@wastech-mdlint/cli/schema.json",
      addedRuleCount: 2,
      totalRuleCount: 2,
      ...overrides
    };
  }

  it("reports a fresh write with its rule count and schema ref, and no schema/workflow lines by default", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult(),
      configPath: CONFIG_FILE
    });

    expect(summary).toContain(`Wrote ${CONFIG_FILE} with 2 rule(s).`);
    expect(summary).toContain("Schema: ./node_modules/@wastech-mdlint/cli/schema.json");
    expect(summary).not.toContain("Wrote project-local schema");
    expect(summary).not.toContain("Wrote CI workflow");
  });

  it("reports a merge's added-vs-total rule counts with distinct wording from a fresh write", () => {
    const summary = formatWriteSummary({
      action: "merge",
      result: buildResult({ addedRuleCount: 1, totalRuleCount: 3 }),
      configPath: CONFIG_FILE
    });

    expect(summary).toContain(`Merged ${CONFIG_FILE}: 1 new rule(s) appended (3 total).`);
  });

  it("mentions the project-local schema and CI workflow only when their paths are actually passed", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult({ schemaRef: "./schema.json" }),
      configPath: CONFIG_FILE,
      schemaPath: "schema.json",
      ciWorkflowPath: ".github/workflows/wastech-mdlint.yml"
    });

    expect(summary).toContain("Wrote project-local schema schema.json (custom rules present).");
    expect(summary).toContain("Wrote CI workflow .github/workflows/wastech-mdlint.yml.");
  });
});

describe("formatNotWrittenSummary", () => {
  it("names the unreadable existing config's path and tells the user how to recover", () => {
    const summary = formatNotWrittenSummary("docs/wastech-mdlint.config.json");
    expect(summary).toContain("Not written: the existing config at docs/wastech-mdlint.config.json");
    expect(summary).toContain("Fix or remove it, then re-run init.");
  });

  it("falls back to the canonical filename when no config path is known", () => {
    const summary = formatNotWrittenSummary(undefined);
    expect(summary).toContain(`Not written: the existing config at ${CONFIG_FILE}`);
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

  it("returns parsed: false when a rules[] entry is a bare string (not identifiable for the diff)", async () => {
    // `["REF-001"]` looks array-shaped but the element carries no `{ rule }` to canonically diff, so
    // a merge could not prove it a duplicate — the whole config is non-mergeable, not silently kept.
    const cwd = await fixtureRepo({ "wastech-mdlint.config.json": JSON.stringify({ rules: ["REF-001"] }) });
    const result = await readExistingRuleIds(cwd, path.join(cwd, "wastech-mdlint.config.json"));
    expect(result).toEqual({ ruleIds: [], parsed: false });
  });

  it("returns parsed: false when a rules[] entry has a non-string rule value", async () => {
    const cwd = await fixtureRepo({ "wastech-mdlint.config.json": JSON.stringify({ rules: [{ rule: 1 }] }) });
    const result = await readExistingRuleIds(cwd, path.join(cwd, "wastech-mdlint.config.json"));
    expect(result).toEqual({ ruleIds: [], parsed: false });
  });

  it("returns parsed: false for a custom entry with a missing or non-string id", async () => {
    for (const rules of [[{ rule: "custom" }], [{ rule: "custom", id: 1 }]]) {
      const cwd = await fixtureRepo({ "wastech-mdlint.config.json": JSON.stringify({ rules }) });
      const result = await readExistingRuleIds(cwd, path.join(cwd, "wastech-mdlint.config.json"));
      expect(result).toEqual({ ruleIds: [], parsed: false });
    }
  });

  it("identifies a custom entry by its canonical id, not the literal \"custom\"", async () => {
    const cwd = await fixtureRepo({
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom", id: "req-100", options: { assert: { kind: "sectionPresent", sections: ["X"] } } }]
      })
    });
    const result = await readExistingRuleIds(cwd, path.join(cwd, "wastech-mdlint.config.json"));
    expect(result).toEqual({ ruleIds: ["REQ-100"], parsed: true });
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

  it("confirmCiWorkflow's prompt defaults to false — \"ask first, don't write silently\"", () => {
    expect(buildCiWorkflowPromptConfig().default).toBe(false);
  });
});

describe("init command · clean fixture lints clean (P6.05)", () => {
  // The P6 exit criterion is "on a clean fixture (no violations), lint exits 0". Severity is not a
  // safe proxy: TBL-002/CTX-002 default to `warning`, so a fixture with lingering warnings would
  // still exit 0 under the default `--fail-on error` while violating "content with no violations".
  // Assert the stronger, direct property instead — the exact zero-messages string plus exit 0.
  it("plain docs/ clean fixture: init --yes then lint reports no problems and exits 0", async () => {
    const cwd = await fixtureRepo(CLEAN_DOCS_FIXTURE);

    const initResult = await run(["init", cwd, "--yes"], cwd);
    expect(initResult.exitCode).toBe(EXIT_CODE_SUCCESS);

    const lintResult = await run(["lint", cwd], cwd);
    expect(lintResult.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(lintResult.stdout).toBe("No problems found.\n");
    await expect(loadConfiguration({ cwd })).resolves.toBeDefined();
  });

  it("custom layout (specs/ + adr/) clean fixture lints clean, exercising SEC-001's clean path", async () => {
    const cwd = await fixtureRepo(CUSTOM_LAYOUT_FIXTURE);

    const initResult = await run(["init", cwd, "--yes"], cwd);
    expect(initResult.exitCode).toBe(EXIT_CODE_SUCCESS);
    // SEC-001 is inferred here (ADR sections) but not in the plain-docs fixture, so this case is the
    // one that proves its clean-lint path — every adr/ file has Status/Context/Decision.
    expect(initResult.stdout).toContain("- SEC-001:");

    const lintResult = await run(["lint", cwd], cwd);
    expect(lintResult.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(lintResult.stdout).toBe("No problems found.\n");
    await expect(loadConfiguration({ cwd })).resolves.toBeDefined();
  });
});

describe("init command · custom layout (specs/, adr/) (P6.05)", () => {
  it("--yes produces a deterministic draft covering both clusters with a local $schema and no remote URL", async () => {
    const cwdOne = await fixtureRepo(CUSTOM_LAYOUT_FIXTURE);
    const cwdTwo = await fixtureRepo(CUSTOM_LAYOUT_FIXTURE);

    const first = await run(["init", cwdOne, "--yes"], cwdOne);
    const second = await run(["init", cwdTwo, "--yes"], cwdTwo);

    expect(first.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(first.stdout).toBe(second.stdout);

    const written = readConfig(await readFile(path.join(cwdOne, CONFIG_FILE), "utf8"));
    expect(written.include).toContain("specs/**/*.{md,mdx}");
    expect(written.include).toContain("adr/**/*.{md,mdx}");
    const ruleIds = (written.rules as { rule: string }[]).map((entry) => entry.rule).sort();
    expect(ruleIds).toEqual(["CTX-002", "GRP-001", "REF-001", "SEC-001", "TBL-002"]);
    // Local, version-matched schema ref — never a remote URL (architecture invariant / C9).
    expect(written.$schema).toBe("./node_modules/@wastech-mdlint/cli/schema.json");
    expect(JSON.stringify(written.$schema)).not.toContain("http");
    await expect(loadConfiguration({ cwd: cwdOne })).resolves.toBeDefined();
  });
});

describe("init command · small monorepo layout (P6.05)", () => {
  it("--yes detects each workspace package's docs/ cluster into one deterministic root config", async () => {
    const cwdOne = await fixtureRepo(MONOREPO_FIXTURE);
    const cwdTwo = await fixtureRepo(MONOREPO_FIXTURE);

    const first = await run(["init", cwdOne, "--yes"], cwdOne);
    const second = await run(["init", cwdTwo, "--yes"], cwdTwo);

    expect(first.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toContain("Package manager: npm.");

    const written = readConfig(await readFile(path.join(cwdOne, CONFIG_FILE), "utf8"));
    const include = written.include as string[];
    expect(include).toContain("packages/alpha/docs/**/*.{md,mdx}");
    expect(include).toContain("packages/beta/docs/**/*.{md,mdx}");
    // include is user-visible output, so it must be sorted deterministically, not filesystem-ordered.
    expect(include).toEqual([...include].sort());
    await expect(loadConfiguration({ cwd: cwdOne })).resolves.toBeDefined();
  });
});

describe("init command · package-manager detection e2e (P6.05)", () => {
  // Core unit-tests every lockfile→manager mapping; this proves the full CLI run surfaces the same
  // detection in the --yes draft. One case per lockfile plus the no-lockfile fallback.
  const lockfileCases: { lockfile: string; expected: string }[] = [
    { lockfile: "bun.lock", expected: "bun" },
    { lockfile: "pnpm-lock.yaml", expected: "pnpm" },
    { lockfile: "yarn.lock", expected: "yarn" },
    { lockfile: "package-lock.json", expected: "npm" }
  ];

  for (const { lockfile, expected } of lockfileCases) {
    it(`reports "${expected}" from a ${lockfile} lockfile`, async () => {
      const cwd = await fixtureRepo({ ...CROSS_LINKED_DOCS_FIXTURE, [lockfile]: "" });

      const result = await run(["init", cwd, "--yes"], cwd);

      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain(`Package manager: ${expected}.`);
    });
  }

  it("reports \"not detected\" when no lockfile is present", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", cwd, "--yes"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("Package manager: not detected.");
  });
});
