import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
  type GeneratedInitConfig,
  type InferredRule,
  type RuleCategory,
} from "@wastech-mdlint/core";

import { EXIT_CODE_SUCCESS, EXIT_CODE_USAGE_ERROR } from "../src/commands.js";
import {
  buildConfigPreview,
  DEFAULT_EXISTING_CONFIG_ACTION,
  diffAgainstExistingRuleIds,
  extractExistingRuleIds,
  formatDraftSummary,
  formatNotWrittenSummary,
  formatScanExclusions,
  formatWriteFailureSummary,
  formatWriteSummary,
  groupInferredRulesByCategory,
  readExistingConfigDocument,
  resolveSchemaWriteOutcome,
  type ConfirmedInitSelections,
  type InitPrompter,
} from "../src/init-command.js";
import {
  buildCiWorkflowPromptConfig,
  buildExistingConfigActionPromptConfig,
  buildPackageManagerPromptConfig,
} from "../src/init-prompter.js";
import { runCli, type CliIo } from "../src/program.js";

function createMemoryWriter() {
  let text = "";
  return {
    stream: {
      write(chunk: string) {
        text += chunk;
        return true;
      },
    },
    read() {
      return text;
    },
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "wastech-mdlint-cli-init-"),
  );
  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return root;
}

async function run(
  argv: string[],
  cwd: string,
  ioOverrides: Partial<CliIo> = {},
) {
  const stdout = createMemoryWriter();
  const stderr = createMemoryWriter();
  const exitCode = await runCli(argv, {
    cwd,
    stdout: stdout.stream,
    stderr: stderr.stream,
    ...ioOverrides,
  });
  return { exitCode, stdout: stdout.read(), stderr: stderr.read() };
}

// Split a generated workflow's `run:` line the way POSIX sh would, so a test can execute the emitted
// argv instead of a hand-written approximation of it. Only single quotes need handling — that is the
// only quoting `buildCiWorkflowYaml` emits (`shellSingleQuote`), including its `'\''` escape.
function shellArgv(command: string): string[] {
  return [...command.trim().matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map(
    (match) =>
      match[1] === undefined
        ? (match[2] as string)
        : match[1].replaceAll("'\\''", "'"),
  );
}

// A --yes-shaped prompter: every method returns exactly what --yes would pick without a prompt, so
// tests can assert interactive output is byte-identical to --yes output.
function createDefaultFakePrompter(
  overrides: Partial<InitPrompter> = {},
): InitPrompter {
  return {
    resolveExistingConfigAction:
      overrides.resolveExistingConfigAction ?? (async () => "skip"),
    choosePackageManager:
      overrides.choosePackageManager ?? (async () => undefined),
    selectClusters: overrides.selectClusters ?? (async (clusters) => clusters),
    selectCategories:
      overrides.selectCategories ?? (async (categories) => categories),
    confirmDraft: overrides.confirmDraft ?? (async () => true),
    confirmCiWorkflow: overrides.confirmCiWorkflow ?? (async () => false),
  };
}

const CONFIG_FILE = "wastech-mdlint.config.json";

function readConfig(text: string): Record<string, unknown> {
  return parseJsonc(text) as Record<string, unknown>;
}

// Where a locally-installed `@wastech-mdlint/cli` puts its schema. `findInstalledSchemaDir` walks up
// looking for exactly this path, so its presence in a fixture is the difference between the two
// scenarios `init` has to get right (audit L-10): a package-relative `$schema` when the CLI is
// installed, and a generated project-local `./schema.json` when it is not (the `npx` case). Fixtures
// are temp directories with nothing installed, so the fallback is the default they exercise.
const INSTALLED_SCHEMA_REL_PATH =
  "node_modules/@wastech-mdlint/cli/schema.json";

// `node_modules` is a scan noise directory, so seeding it never perturbs cluster detection.
function withInstalledSchema(
  files: Record<string, string>,
): Record<string, string> {
  return { ...files, [INSTALLED_SCHEMA_REL_PATH]: generateConfigSchema() };
}

/**
 * The acceptance check behind L-10: resolve a written `$schema` the way an editor would — relative
 * to the config's own directory — and read the file it names. A dangling ref is exactly the defect,
 * so "it is a string that looks right" is not enough.
 */
async function readReferencedSchema(configDir: string): Promise<string> {
  const written = readConfig(
    await readFile(path.join(configDir, CONFIG_FILE), "utf8"),
  );
  const ref = written.$schema;
  expect(typeof ref).toBe("string");
  return readFile(path.resolve(configDir, ref as string), "utf8");
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
    "",
  ].join("\n"),
  "docs/b.md": [
    "# B",
    "",
    "See [A](a.md).",
    "",
    "## Overview",
    "",
    "Additional detail about B.",
    "",
  ].join("\n"),
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
    "",
  ].join("\n"),
  "docs/b.md": [
    "# B",
    "",
    "## Overview",
    "",
    "Additional detail about B.",
    "",
  ].join("\n"),
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
    "",
  ].join("\n"),
  "specs/details.md": [
    "# Details",
    "",
    "Concrete detail about the spec.",
    "",
  ].join("\n"),
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
    "",
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
    "",
  ].join("\n"),
};

// A small npm monorepo: a workspace root (package.json `workspaces` + package-lock.json → npm) with
// two nested packages, each carrying its own docs/ cluster. Scoped to shape/determinism only (not
// clean-lint): each package's docs/ reuses the cross-linked cycle shape — cleanliness is proven by
// the docs/ and custom fixtures, so this one only proves per-package cluster detection, a
// deterministic sorted root `include` spanning both packages, and that loadConfiguration accepts it.
const MONOREPO_FIXTURE: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "monorepo",
    private: true,
    workspaces: ["packages/*"],
  }),
  "package-lock.json": "{}",
  "packages/alpha/package.json": JSON.stringify({ name: "alpha" }),
  "packages/alpha/docs/a.md": ["# A", "", "See [B](b.md).", ""].join("\n"),
  "packages/alpha/docs/b.md": ["# B", "", "See [A](a.md).", ""].join("\n"),
  "packages/beta/package.json": JSON.stringify({ name: "beta" }),
  "packages/beta/docs/a.md": ["# A", "", "See [B](b.md).", ""].join("\n"),
  "packages/beta/docs/b.md": ["# B", "", "See [A](a.md).", ""].join("\n"),
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
      },
    });
    const interactiveResult = await run(
      ["init", interactiveCwd],
      interactiveCwd,
      { isTty: true, initPrompter: prompter },
    );

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
      Object.keys(CROSS_LINKED_DOCS_FIXTURE).map((relativePath) =>
        readFile(path.join(cwd, relativePath), "utf8"),
      ),
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

    const absoluteResult = await run(
      ["init", absoluteCwd, "--yes"],
      absoluteCwd,
    );
    const relativeResult = await run(["init", ".", "--yes"], relativeCwd);

    expect(relativeResult.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(relativeResult.stdout).toBe(absoluteResult.stdout);
  });
});

describe("init command · existing config handling", () => {
  const existingConfigText = JSON.stringify({ rules: [{ rule: "REF-001" }] });

  it("defaults to skip under --yes with no --on-existing, leaving the file untouched", async () => {
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      "wastech-mdlint.config.json": existingConfigText,
    });

    const result = await run(["init", cwd, "--yes"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain(
      "skipped — existing config left untouched.",
    );
    await expect(
      readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
    ).resolves.toBe(existingConfigText);
  });

  it("--on-existing overwrite writes the full inferred config, replacing the existing one", async () => {
    const cwd = await fixtureRepo(
      withInstalledSchema({
        ...CROSS_LINKED_DOCS_FIXTURE,
        "wastech-mdlint.config.json": existingConfigText,
      }),
    );

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "overwrite"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain(
      "will be overwritten with the confirmed draft",
    );
    expect(result.stdout).toContain(`Wrote ${CONFIG_FILE}`);

    const written = readConfig(
      await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    );
    const ruleIds = (written.rules as { rule: string }[]).map(
      (entry) => entry.rule,
    );
    // Overwrite replaces the whole config: the freshly inferred canonical ids, the package $schema.
    expect(ruleIds).toContain("REF-001");
    expect(ruleIds).toContain("GRP-001");
    expect(written.include).toContain("docs/**/*.{md,mdx}");
    expect(written.$schema).toBe(
      "./node_modules/@wastech-mdlint/cli/schema.json",
    );
  });

  it("--on-existing merge appends only new-by-canonical-id rules and keeps existing ones verbatim", async () => {
    const cwd = await fixtureRepo(
      withInstalledSchema({
        ...CROSS_LINKED_DOCS_FIXTURE,
        "wastech-mdlint.config.json": existingConfigText,
      }),
    );

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain(
      "existing rules[] entries are left untouched",
    );
    expect(result.stdout).not.toContain("WARNING");
    expect(result.stdout).toContain(`Merged ${CONFIG_FILE}`);

    const written = readConfig(
      await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    );
    const ruleIds = (written.rules as { rule: string }[]).map(
      (entry) => entry.rule,
    );
    // Existing REF-001 preserved (still first), new rules appended, package $schema (no custom rule).
    expect(ruleIds[0]).toBe("REF-001");
    expect(ruleIds).toContain("REF-002");
    expect(ruleIds).toContain("TBL-002");
    expect(ruleIds).toContain("GRP-001");
    expect(written.$schema).toBe(
      "./node_modules/@wastech-mdlint/cli/schema.json",
    );
  });

  it("--on-existing skip previews the skip message and leaves the file untouched", async () => {
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      "wastech-mdlint.config.json": existingConfigText,
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "skip"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain(
      "skipped — existing config left untouched.",
    );
    await expect(
      readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
    ).resolves.toBe(existingConfigText);
  });

  it("--on-existing skip never touches the filesystem, even with --with-ci-workflow", async () => {
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      ".git/HEAD": "ref: refs/heads/main\n",
      "wastech-mdlint.config.json": existingConfigText,
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "skip", "--with-ci-workflow"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain(
      "skipped — existing config left untouched.",
    );
    // skip is a strict no-write outcome (plan invariant): no CI workflow, no config change.
    expect(result.stdout).not.toContain("Wrote CI workflow");
    await expect(
      readFile(
        path.join(cwd, ".github", "workflows", "wastech-mdlint.yml"),
        "utf8",
      ),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
    ).resolves.toBe(existingConfigText);
  });

  it("--on-existing skip over an unloadable config still exits 0 (deliberate no-write)", async () => {
    // The other half of the P14.02 split, on the same input the merge cases above exit 2 on: the
    // file being unloadable is irrelevant to `skip`, which never intended to write. Only the reason
    // for not writing separates the two outcomes, so both need pinning against the same fixture.
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      "wastech-mdlint.config.json": "{ not json",
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "skip"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain(
      "skipped — existing config left untouched.",
    );
    expect(result.stdout).not.toContain("Not written:");
    await expect(
      readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
    ).resolves.toBe("{ not json");
  });

  it("passes the existing-config prompt a repository-relative POSIX path, never an absolute one", async () => {
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      "wastech-mdlint.config.json": existingConfigText,
    });

    const receivedPaths: string[] = [];
    const prompter = createDefaultFakePrompter({
      resolveExistingConfigAction: async (configPath) => {
        receivedPaths.push(configPath);
        return "skip";
      },
    });
    const result = await run(["init", cwd], cwd, {
      isTty: true,
      initPrompter: prompter,
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(receivedPaths).toEqual(["wastech-mdlint.config.json"]);
    expect(receivedPaths[0]).not.toContain(cwd);
    expect(path.isAbsolute(receivedPaths[0]!)).toBe(false);
  });

  it("--on-existing merge warns instead of presenting the diff as authoritative when the existing config is malformed", async () => {
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      "wastech-mdlint.config.json": "{ not json",
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    // Exit 2, not 0 (P14.02 / W-13): the refusal is caused by an invalid file, which is an
    // operational failure, not the deliberate no-write that `--on-existing skip` is. The four
    // sibling merge-abort cases below pin the same code for the other ways the config can be
    // unloadable.
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stdout).toContain(
      "WARNING: the existing config could not be read, parsed, or validated",
    );
    expect(result.stdout).toContain("- REF-001:");
    // Unreadable + merge aborts the write: the file is untouched and the output says so explicitly.
    expect(result.stdout).toContain("Not written:");
    await expect(
      readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
    ).resolves.toBe("{ not json");
  });

  it("--on-existing merge warns rather than merging cleanly when rules[] is JSONC-valid but not an array", async () => {
    const malformedConfigText = JSON.stringify({ rules: {} });
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      "wastech-mdlint.config.json": malformedConfigText,
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stdout).toContain(
      "WARNING: the existing config could not be read, parsed, or validated",
    );
    expect(result.stdout).toContain("- REF-001:");
    expect(result.stdout).toContain("Not written:");
    await expect(
      readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
    ).resolves.toBe(malformedConfigText);
  });

  it("--on-existing merge aborts when rules[] is an array with an unidentifiable entry", async () => {
    // `["REF-001"]` is array-shaped but the bare-string entry can't be canonically diffed, so
    // merging would append an inferred REF-001 as a duplicate — the additive existing-wins contract
    // forbids that, so the write aborts and the file is left untouched.
    const malformedConfigText = JSON.stringify({ rules: ["REF-001"] });
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      "wastech-mdlint.config.json": malformedConfigText,
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stdout).toContain(
      "WARNING: the existing config could not be read, parsed, or validated",
    );
    expect(result.stdout).toContain("Not written:");
    await expect(
      readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
    ).resolves.toBe(malformedConfigText);
  });

  it("--on-existing merge aborts when a custom entry can't be canonically identified", async () => {
    // A `rule: "custom"` entry with no usable `id` (missing here) can't be diffed or schema-wired, so
    // the merge aborts rather than rewrite a config it can't reason about (additive-merge safety).
    const malformedConfigText = JSON.stringify({
      rules: [
        {
          rule: "custom",
          options: { assert: { kind: "sectionPresent", sections: ["X"] } },
        },
      ],
    });
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      "wastech-mdlint.config.json": malformedConfigText,
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stdout).toContain(
      "WARNING: the existing config could not be read, parsed, or validated",
    );
    expect(result.stdout).toContain("Not written:");
    await expect(
      readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
    ).resolves.toBe(malformedConfigText);
  });

  it("--on-existing merge aborts when the existing config parses but loadConfiguration rejects it", async () => {
    // Parses fine and every rule id is identifiable, but an unknown top-level key fails the strict
    // root schema. Preserving it verbatim would write a config `loadConfiguration` rejects, so the
    // merge aborts instead of reporting a successful (but invalid) write.
    const invalidConfigText = JSON.stringify({
      notARealKey: true,
      rules: [{ rule: "REF-001" }],
    });
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      "wastech-mdlint.config.json": invalidConfigText,
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stdout).toContain(
      "WARNING: the existing config could not be read, parsed, or validated",
    );
    expect(result.stdout).toContain("Not written:");
    await expect(
      readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
    ).resolves.toBe(invalidConfigText);
  });

  // An explicit `[path]` names the exact directory init must operate on — a config found while
  // walking up from it must not govern that run (H-3, P11.04). This replaces the pre-fix behavior
  // (an explicit `[path]` silently re-rooted onto an ancestor's config) with the corrected one.
  describe("explicit [path] vs. an ancestor's config found while walking up (H-3)", () => {
    async function fixtureWithRootConfigAndLockfile(): Promise<string> {
      return fixtureRepo({
        ...CROSS_LINKED_DOCS_FIXTURE,
        ".git/HEAD": "ref: refs/heads/main\n",
        "wastech-mdlint.config.json": existingConfigText,
        "package-lock.json": "{}",
      });
    }

    it("--on-existing overwrite: an explicit [path] is honored, not re-rooted onto the root config", async () => {
      const cwd = await fixtureWithRootConfigAndLockfile();

      const result = await run(
        ["init", "docs", "--yes", "--on-existing", "overwrite"],
        cwd,
      );

      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      // Nothing exists at the exact target (`docs/`), so the root config found while walking up
      // does not count as this run's existing config.
      expect(result.stdout).toContain("Existing config: none found.");
      expect(result.stdout).toContain("Wrote docs/wastech-mdlint.config.json");
      // The scan is not re-rooted to the parent, but `detectPackageManager` still walks up to the
      // repo root's lockfile (audit L-11) — a subdirectory of an npm repo is still an npm repo, and
      // reporting "not detected" there was the defect, not the design.
      expect(result.stdout).toContain("Package manager: npm.");
      await expect(
        readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
      ).resolves.toBe(existingConfigText);
    });

    it("--on-existing merge: an explicit [path] is honored, not re-rooted onto the root config", async () => {
      const cwd = await fixtureWithRootConfigAndLockfile();

      const result = await run(
        ["init", "docs", "--yes", "--on-existing", "merge"],
        cwd,
      );

      // `--on-existing merge` is moot once nothing exists at the exact target — both flags degrade
      // to a fresh write.
      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain("Existing config: none found.");
      expect(result.stdout).toContain("Wrote docs/wastech-mdlint.config.json");
      expect(result.stdout).toContain("Package manager: npm.");
      await expect(
        readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
      ).resolves.toBe(existingConfigText);
    });

    it("the literal H-3 repro: init . in a nested sub-project never touches the parent's config", async () => {
      const rootConfigText = JSON.stringify({ include: ["parent-only.md"] });
      const cwd = await fixtureRepo({
        "wastech-mdlint.config.json": rootConfigText,
        "sub-project/a.md": "# A\n\nSee [B](b.md).\n",
        "sub-project/b.md": "# B\n\nSee [A](a.md).\n",
      });
      const subProjectDir = path.join(cwd, "sub-project");

      const result = await run(["init", ".", "--yes"], subProjectDir);

      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain("Existing config: none found.");
      const subProjectConfig = readConfig(
        await readFile(
          path.join(subProjectDir, "wastech-mdlint.config.json"),
          "utf8",
        ),
      );
      // Proves the written config reflects the sub-project's own scan, not a copy of the parent's
      // content — a regression that re-rooted onto the parent would carry this entry across.
      expect(subProjectConfig.include).not.toContain("parent-only.md");
      // The parent's config is byte-identical to what it was before this run.
      await expect(
        readFile(path.join(cwd, "wastech-mdlint.config.json"), "utf8"),
      ).resolves.toBe(rootConfigText);
    });

    it("a bare invocation (no [path]) still re-roots and shows the true relative path", async () => {
      const cwd = await fixtureWithRootConfigAndLockfile();
      const nestedDir = path.join(cwd, "docs", "nested");
      await mkdir(nestedDir, { recursive: true });

      const receivedPaths: string[] = [];
      const prompter = createDefaultFakePrompter({
        resolveExistingConfigAction: async (configPath) => {
          receivedPaths.push(configPath);
          return "skip";
        },
      });
      const result = await run(["init"], nestedDir, {
        isTty: true,
        initPrompter: prompter,
      });

      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      // Two levels up: nested -> docs -> the repo root where the config actually lives.
      expect(receivedPaths).toEqual(["../../wastech-mdlint.config.json"]);
    });
  });
});

describe("init command · writing the config (P6.04)", () => {
  it("--yes with no existing config writes a config loadConfiguration accepts", async () => {
    const cwd = await fixtureRepo(
      withInstalledSchema(CROSS_LINKED_DOCS_FIXTURE),
    );

    const result = await run(["init", cwd, "--yes"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain(`Wrote ${CONFIG_FILE}`);
    const written = readConfig(
      await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    );
    expect(written.$schema).toBe(
      "./node_modules/@wastech-mdlint/cli/schema.json",
    );
    // Deliverable 1 / C1: the fresh write prunes the noise trees, so init never broadens the
    // scanned corpus back to node_modules/.git/dist after writing.
    expect(written.exclude).toContain("**/node_modules/**");
    expect(written.exclude).toContain("**/.git/**");
    // W-15 (P14.03): a hidden *dependency* tree is excluded by name, but no glob excludes a
    // directory merely for starting with a dot — that prune belongs to the scan, not to the corpus.
    expect(written.exclude).toContain("**/.venv/**");
    expect(written.exclude).not.toContain("**/.*/**");
    // Audit L-7's other half: gitignore is honored, matching what the scan saw.
    expect(written.respectGitignore).toBe(true);
    // Forward-compat smoke check: the written config must load without a ConfigError.
    await expect(loadConfiguration({ cwd })).resolves.toBeDefined();
  });

  // Audit L-10. Every assertion here is about the ref resolving to a real file: the previous
  // behavior emitted `./node_modules/@wastech-mdlint/cli/schema.json` unconditionally, which under
  // `npx` (nothing installed locally) named a path that does not exist.
  describe("the written $schema resolves to a file that exists", () => {
    it("points at the installed package schema when one is on disk", async () => {
      const cwd = await fixtureRepo(
        withInstalledSchema(CROSS_LINKED_DOCS_FIXTURE),
      );

      const result = await run(["init", cwd, "--yes"], cwd);
      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

      const written = readConfig(
        await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
      );
      expect(written.$schema).toBe(
        "./node_modules/@wastech-mdlint/cli/schema.json",
      );
      await expect(readReferencedSchema(cwd)).resolves.toBe(
        generateConfigSchema(),
      );
      // Nothing extra is generated when a real package schema is already there.
      await expect(
        readFile(path.join(cwd, "schema.json"), "utf8"),
      ).rejects.toThrow();
      expect(result.stdout).not.toContain("Wrote project-local schema");
    });

    it("generates and points at a project-local schema in the npx scenario", async () => {
      const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

      const result = await run(["init", cwd, "--yes"], cwd);
      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

      const written = readConfig(
        await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
      );
      expect(written.$schema).toBe("./schema.json");
      await expect(readReferencedSchema(cwd)).resolves.toBe(
        generateConfigSchema(),
      );
      expect(result.stdout).toContain(
        "Wrote project-local schema schema.json (no installed package schema to point at).",
      );
      // Still a local ref, never a remote URL (C9 / the security boundary).
      expect(written.$schema).not.toMatch(/https?:\/\//);
    });

    it("resolves for a subdirectory config in the npx scenario too", async () => {
      // The ref is relative to the config's own directory, so the nested case is the one where a
      // wrong base silently produces a dangling path.
      const cwd = await fixtureRepo({
        ".git/HEAD": "ref: refs/heads/main\n",
        ...CROSS_LINKED_DOCS_FIXTURE,
      });

      const result = await run(["init", "docs", "--yes"], cwd);
      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

      const docsDir = path.join(cwd, "docs");
      const written = readConfig(
        await readFile(path.join(docsDir, CONFIG_FILE), "utf8"),
      );
      expect(written.$schema).toBe("./schema.json");
      await expect(readReferencedSchema(docsDir)).resolves.toBe(
        generateConfigSchema(),
      );
    });

    it("re-running init over the generated project schema reports it unchanged", async () => {
      const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

      await run(["init", cwd, "--yes"], cwd);
      const second = await run(
        ["init", cwd, "--yes", "--on-existing", "merge"],
        cwd,
      );

      expect(second.exitCode).toBe(EXIT_CODE_SUCCESS);
      expect(second.stdout).toContain(
        "Project-local schema schema.json is already up to date (no installed package schema to point at).",
      );
      await expect(readReferencedSchema(cwd)).resolves.toBe(
        generateConfigSchema(),
      );
    });

    // `--on-existing overwrite` is a disposition for the *config*; the user never named
    // `schema.json`. Once the npx fallback started generating that file for any repo, the overwrite
    // branch became reachable against a name plenty of projects already use for something else (an
    // OpenAPI document, a product schema) — so it must degrade to "kept" whenever the only reason
    // for the project schema is that nothing is installed to point at.
    it("never replaces an unrelated schema.json under --on-existing overwrite in the npx scenario", async () => {
      const unrelatedSchema = '{ "openapi": "3.1.0", "paths": {} }\n';
      const cwd = await fixtureRepo({
        ...CROSS_LINKED_DOCS_FIXTURE,
        [CONFIG_FILE]: '{\n  "rules": []\n}\n',
        "schema.json": unrelatedSchema,
      });

      const result = await run(
        ["init", cwd, "--yes", "--on-existing", "overwrite"],
        cwd,
      );

      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      await expect(
        readFile(path.join(cwd, "schema.json"), "utf8"),
      ).resolves.toBe(unrelatedSchema);
      expect(result.stdout).not.toContain("Overwrote schema.json");
      expect(result.stdout).toContain(
        "Kept existing schema.json at schema.json",
      );
      // The config was still rewritten and still points at that file, which is the honest — and
      // reported — cost of not clobbering it.
      expect(result.stdout).toContain(
        "The config's $schema points at it even though init did not generate it",
      );
      const written = readConfig(
        await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
      );
      expect(written.$schema).toBe("./schema.json");
    });
  });

  it("a monorepo init writes an exclude that keeps nested dist/node_modules out of the lint corpus", async () => {
    // A temp tree, not a checked-in fixture: the repo `.gitignore` ignores `dist/` and
    // `node_modules/` at any depth, so such a fixture could never be committed.
    //
    // Shape chosen so the written `include` is the broad fallback and the test is therefore
    // non-vacuous: two `.md` files under one non-known-named directory is below
    // DEFAULT_MIN_CLUSTER_SIZE and there is no root-level `.md`, so no cluster qualifies and
    // scanRepository emits the `**/*.md` fallback.
    const cwd = await fixtureRepo({
      "notes/a.md": "# A\n",
      "notes/b.md": "# B\n",
      "packages/foo/dist/OUT.md": "# Generated\n",
      "packages/foo/node_modules/somelib/README.md": "# Dep\n",
    });

    const init = await run(["init", cwd, "--yes"], cwd);
    expect(init.exitCode).toBe(EXIT_CODE_SUCCESS);

    const written = readConfig(
      await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    );
    // Pins the setup assumption: if a future scan-heuristic change narrows the include, this fails
    // loudly instead of passing because nothing was in scope to begin with.
    expect(written.include).toEqual(["**/*.md"]);

    // `--fail-on off` keeps the exit code at 0 regardless of findings; `files` carries the full
    // analyzed corpus, so the assertion holds even when the inferred rules report nothing.
    const lint = await run(
      ["lint", cwd, "--format", "json", "--fail-on", "off"],
      cwd,
    );
    expect(lint.exitCode).toBe(EXIT_CODE_SUCCESS);
    const { files } = JSON.parse(lint.stdout) as { files: string[] };

    expect(files).toContain("notes/a.md");
    expect(files).not.toContain("packages/foo/dist/OUT.md");
    expect(files).not.toContain("packages/foo/node_modules/somelib/README.md");
  });

  it("merge preserving a custom rule writes a project-local schema and points $schema at it", async () => {
    const customConfig = JSON.stringify({
      rules: [
        {
          rule: "custom",
          id: "REQ-100",
          description: "Requires an Owner section.",
          options: { assert: { kind: "sectionPresent", sections: ["Owner"] } },
        },
      ],
    });
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      [CONFIG_FILE]: customConfig,
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    const written = readConfig(
      await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    );
    expect(written.$schema).toBe("./schema.json");
    const schemaText = await readFile(path.join(cwd, "schema.json"), "utf8");
    expect(schemaText).toBe(
      generateConfigSchema({
        customRules: [
          { id: "REQ-100", description: "Requires an Owner section." },
        ],
      }),
    );
  });

  it("merge preserves an existing schema.json byte-for-byte and reports it in the summary", async () => {
    const customConfig = JSON.stringify({
      rules: [
        {
          rule: "custom",
          id: "REQ-100",
          description: "Requires an Owner section.",
          options: { assert: { kind: "sectionPresent", sections: ["Owner"] } },
        },
      ],
    });
    const existingSchemaText = '{"hand-written":true}\n';
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      [CONFIG_FILE]: customConfig,
      "schema.json": existingSchemaText,
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("Kept existing schema.json at schema.json");
    expect(result.stdout).not.toContain("Wrote project-local schema");
    await expect(readFile(path.join(cwd, "schema.json"), "utf8")).resolves.toBe(
      existingSchemaText,
    );
    // Config write itself is unaffected by the schema guard — still merges and still points at it.
    const written = readConfig(
      await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    );
    expect(written.$schema).toBe("./schema.json");
  });

  it("a second merge run reports the schema as already up to date, not falsely 'kept'", async () => {
    const customConfig = JSON.stringify({
      rules: [
        {
          rule: "custom",
          id: "REQ-100",
          description: "Requires an Owner section.",
          options: { assert: { kind: "sectionPresent", sections: ["Owner"] } },
        },
      ],
    });
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      [CONFIG_FILE]: customConfig,
    });

    const first = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );
    expect(first.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(first.stdout).toContain("Wrote project-local schema schema.json");
    const schemaAfterFirstRun = await readFile(
      path.join(cwd, "schema.json"),
      "utf8",
    );

    const second = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    expect(second.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(second.stdout).toContain(
      "Project-local schema schema.json is already up to date",
    );
    expect(second.stdout).not.toContain("Kept existing schema.json");
    await expect(readFile(path.join(cwd, "schema.json"), "utf8")).resolves.toBe(
      schemaAfterFirstRun,
    );
  });

  // P11.10 (audit M-6). This used to reach the write and report an ENOENT partial-write summary,
  // blaming a write for what is really a bad argument; the target is now validated up front.
  it("rejects a nonexistent [path] with a repo-relative message and exit 2", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", "./does-not-exist", "--yes"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain(
      "Target path does not exist: does-not-exist",
    );
    expect(result.stderr).not.toContain(cwd);
    expect(result.stdout).not.toContain("Write failed");
  });

  // @boundary-guard write-failure
  //
  // P11.09 (audit M-5). A directory sitting where the config file belongs is the one write fault
  // reachable on every platform: `findConfig` uses `stat`, so the directory counts as an existing
  // config, staging succeeds, and only the rename fails.
  it("reports a failed config write on stdout, exits 2, and leaves the corpus untouched", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    await mkdir(path.join(cwd, CONFIG_FILE));
    const docBefore = await readFile(path.join(cwd, "docs/a.md"), "utf8");

    // `overwrite` (not the `--yes` default `skip`) so the run actually reaches the write, and it
    // skips the merge-readability abort that would otherwise return first.
    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "overwrite"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stdout).toContain(
      `Write failed: could not replace ${CONFIG_FILE}`,
    );
    // The project-local schema is committed first (P11.09's schema-first ordering) and this fixture
    // has no installed package schema, so it genuinely lands before the config rename fails — the
    // summary has to name it rather than claim nothing was written.
    expect(result.stdout).toContain("Written: schema.json.");
    expect(result.stdout).toContain(
      "Every file listed as not written is byte-unchanged on disk",
    );
    expect(result.stdout).not.toContain(`Wrote ${CONFIG_FILE}`);
    await expect(readFile(path.join(cwd, "docs/a.md"), "utf8")).resolves.toBe(
      docBefore,
    );
    // No temp file left beside the target the rename could not reach.
    await expect(
      readdir(cwd).then((entries) =>
        entries.filter((entry) => entry.endsWith(".tmp")),
      ),
    ).resolves.toEqual([]);
  });

  // Root ignores directory permissions and Windows has no equivalent model, so the fault this
  // relies on only exists for an unprivileged POSIX user.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "leaves an existing config byte-unchanged when the write cannot be staged",
    async () => {
      const existingConfigText = `${JSON.stringify({ rules: [{ rule: "REF-001" }] }, null, 2)}\n`;
      // With the package schema installed, the config is the only staged write — so the failure this
      // test provokes is attributed to the config, which is the file whose bytes it is guarding.
      const cwd = await fixtureRepo(
        withInstalledSchema({
          ...CROSS_LINKED_DOCS_FIXTURE,
          [CONFIG_FILE]: existingConfigText,
        }),
      );
      // `r-x`: the corpus and the existing config stay readable, but no new file can be created —
      // so the temp write fails and no rename is ever attempted.
      await chmod(cwd, 0o555);

      try {
        const result = await run(
          ["init", cwd, "--yes", "--on-existing", "overwrite"],
          cwd,
        );

        expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
        expect(result.stdout).toContain(
          `Write failed: could not replace ${CONFIG_FILE} (EACCES).`,
        );
        expect(result.stdout).toContain("Written: nothing.");
        // The point of the change: the truncate-and-write path used to leave this file clobbered.
        await expect(
          readFile(path.join(cwd, CONFIG_FILE), "utf8"),
        ).resolves.toBe(existingConfigText);
      } finally {
        // Without this the shared afterEach `rm(..., { recursive: true })` fails with EACCES.
        await chmod(cwd, 0o755);
      }
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps an unreadable existing schema.json, still writes the config, and exits 0",
    async () => {
      const customConfig = JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "REQ-100",
            description: "Requires an Owner section.",
            options: {
              assert: { kind: "sectionPresent", sections: ["Owner"] },
            },
          },
        ],
      });
      const existingSchemaText = '{"hand-written":true}\n';
      const cwd = await fixtureRepo({
        ...CROSS_LINKED_DOCS_FIXTURE,
        [CONFIG_FILE]: customConfig,
        "schema.json": existingSchemaText,
      });
      const schemaPath = path.join(cwd, "schema.json");
      // Unreadable but present. The read that feeds the byte-comparison degrades any failure to
      // `undefined`, which used to be safe only because the write would fail identically — a
      // temp+rename commit would have replaced it (P11.09).
      await chmod(schemaPath, 0o000);

      const result = await run(
        ["init", cwd, "--yes", "--on-existing", "merge"],
        cwd,
      );
      await chmod(schemaPath, 0o644);

      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain(
        "Kept existing schema.json at schema.json",
      );
      expect(result.stdout).toContain("exists but could not be read");
      expect(result.stdout).not.toContain("Wrote project-local schema");
      await expect(readFile(schemaPath, "utf8")).resolves.toBe(
        existingSchemaText,
      );
      // The config write is independent of the schema guard and still lands.
      const written = readConfig(
        await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
      );
      expect(written.$schema).toBe("./schema.json");
    },
  );

  it("--yes --with-ci-workflow writes the workflow file; plain --yes does not", async () => {
    const workflowPath = path.join(
      ".github",
      "workflows",
      "wastech-mdlint.yml",
    );

    const withCwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const withResult = await run(
      ["init", withCwd, "--yes", "--with-ci-workflow"],
      withCwd,
    );
    expect(withResult.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(withResult.stdout).toContain("Wrote CI workflow");
    const workflow = await readFile(path.join(withCwd, workflowPath), "utf8");
    // Self-contained: installs the published CLI and runs it directly (P9.03's composite Action is
    // not built yet, so no `uses:` reference to a not-yet-published Action).
    expect(workflow).toContain("npm install --no-save @wastech-mdlint/cli");
    expect(workflow).toContain("npx wastech-mdlint lint --fail-on error");

    const withoutCwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    await run(["init", withoutCwd, "--yes"], withoutCwd);
    await expect(
      readFile(path.join(withoutCwd, workflowPath), "utf8"),
    ).rejects.toThrow();
  });

  it("anchors the CI workflow at the git root (not the target subdirectory) and passes the config path", async () => {
    const workflowPath = path.join(
      ".github",
      "workflows",
      "wastech-mdlint.yml",
    );
    // A git repo whose Markdown lives under docs/, with no existing config anywhere. The installed
    // package schema is what makes the `../` path math below the thing under test rather than the
    // project-local fallback.
    const cwd = await fixtureRepo(
      withInstalledSchema({
        ...CROSS_LINKED_DOCS_FIXTURE,
        ".git/HEAD": "ref: refs/heads/main\n",
      }),
    );

    const result = await run(
      ["init", "docs", "--yes", "--with-ci-workflow"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // The summary reports the repo-relative path, so a subdirectory run says where the config landed.
    expect(result.stdout).toContain("Wrote docs/wastech-mdlint.config.json");
    // Config is written into the targeted subdirectory, and its local `$schema` points up at the
    // repo-root node_modules — not a path nested under docs/ that would resolve to nothing.
    const written = readConfig(
      await readFile(path.join(cwd, "docs", CONFIG_FILE), "utf8"),
    );
    expect(written.$schema).toBe(
      "../node_modules/@wastech-mdlint/cli/schema.json",
    );
    // ...but the workflow is anchored at the repo root, where GitHub will actually load it, and it
    // scopes lint to the config's directory (so include/exclude resolve there) plus an explicit
    // --config — both single-quoted and POSIX. `[path]` is relative to the repo root the workflow
    // runs from; `--config` is relative to `[path]`, which is the base the CLI resolves it against
    // (P14.04).
    const workflow = await readFile(path.join(cwd, workflowPath), "utf8");
    expect(workflow).toContain(
      "npx wastech-mdlint lint 'docs' --fail-on error --config 'wastech-mdlint.config.json'",
    );
    // The dead-workflow location under docs/ is never created.
    await expect(
      readFile(path.join(cwd, "docs", workflowPath), "utf8"),
    ).rejects.toThrow();
  });

  it("writes a nested config whose workflow lint command actually lints that subtree", async () => {
    // docs/ has a broken local link (REF-001 evidence + a real violation). The workflow scopes lint
    // to the config directory, so running that same command must load the nested config and scan the
    // nested tree — not lint the repo root against docs-relative globs and find nothing.
    const cwd = await fixtureRepo({
      ".git/HEAD": "ref: refs/heads/main\n",
      "docs/a.md": "# A\n\nSee [missing](nope.md).\n",
      "docs/b.md": "# B\n\nSee [A](a.md).\n",
    });

    const initResult = await run(
      ["init", "docs", "--yes", "--with-ci-workflow"],
      cwd,
    );
    expect(initResult.exitCode).toBe(EXIT_CODE_SUCCESS);

    // Run the emitted argv *verbatim*, from the repo root where GitHub runs the workflow. This test
    // used to mirror the command with hand-written absolute paths, which is precisely why the
    // generator's relative `--config` form went unguarded through P14.04's change of base: only
    // executing what was actually written can catch a workflow that fails on its first run.
    const workflow = await readFile(
      path.join(cwd, ".github", "workflows", "wastech-mdlint.yml"),
      "utf8",
    );
    const lintCommand = workflow
      .split("\n")
      .find((line) => line.includes("npx wastech-mdlint lint"));
    expect(lintCommand).toBeDefined();

    const lintResult = await run(
      shellArgv(lintCommand as string).slice(2),
      cwd,
    );

    // Not a usage/config error (2): the nested config loaded. REF-001 fired on the broken link,
    // proving lint scanned the docs subtree rather than an empty/wrong root.
    expect(lintResult.exitCode).not.toBe(EXIT_CODE_USAGE_ERROR);
    expect(lintResult.stdout).toContain("REF-001");
  });

  it("anchors schema and workflow at the project root even without .git (package.json marks it)", async () => {
    const workflowPath = path.join(
      ".github",
      "workflows",
      "wastech-mdlint.yml",
    );
    // A valid non-git project: no `.git`, but `package.json` at the root marks the install root.
    const cwd = await fixtureRepo(
      withInstalledSchema({
        "package.json": JSON.stringify({ name: "proj" }),
        "docs/a.md": "# A\n\nSee [B](b.md).\n",
        "docs/b.md": "# B\n\nSee [A](a.md).\n",
      }),
    );

    const result = await run(
      ["init", "docs", "--yes", "--with-ci-workflow"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // `$schema` resolves up to the project-root node_modules, not `./node_modules` inside docs/.
    const written = readConfig(
      await readFile(path.join(cwd, "docs", CONFIG_FILE), "utf8"),
    );
    expect(written.$schema).toBe(
      "../node_modules/@wastech-mdlint/cli/schema.json",
    );
    // Workflow is anchored at the project root, not under docs/ — `[path]` carries that evidence,
    // since `--config` is relative to it (P14.04).
    await expect(
      readFile(path.join(cwd, workflowPath), "utf8"),
    ).resolves.toContain(
      "lint 'docs' --fail-on error --config 'wastech-mdlint.config.json'",
    );
    await expect(
      readFile(path.join(cwd, "docs", workflowPath), "utf8"),
    ).rejects.toThrow();
  });

  it("anchors at the git repo root for a nested workspace package (not the package dir)", async () => {
    const workflowPath = path.join(
      ".github",
      "workflows",
      "wastech-mdlint.yml",
    );
    // A monorepo: `.git` + workspace `package.json` at the root, and a nested package with its own
    // `package.json`. Running init inside the nested package must still anchor at the repo root.
    const cwd = await fixtureRepo(
      withInstalledSchema({
        ".git/HEAD": "ref: refs/heads/main\n",
        "package.json": JSON.stringify({
          name: "monorepo",
          workspaces: ["packages/*"],
        }),
        "packages/foo/package.json": JSON.stringify({ name: "foo" }),
        "packages/foo/a.md": "# A\n\nSee [B](b.md).\n",
        "packages/foo/b.md": "# B\n\nSee [A](a.md).\n",
      }),
    );

    const result = await run(
      ["init", "packages/foo", "--yes", "--with-ci-workflow"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // `$schema` climbs to the repo-root node_modules (two levels up), not the package's own.
    const written = readConfig(
      await readFile(path.join(cwd, "packages", "foo", CONFIG_FILE), "utf8"),
    );
    expect(written.$schema).toBe(
      "../../node_modules/@wastech-mdlint/cli/schema.json",
    );
    // Workflow lives at the repo root (where GitHub loads it), pointed at the nested config via a
    // repo-root-relative `[path]` and a `--config` relative to that (P14.04)...
    const workflow = await readFile(path.join(cwd, workflowPath), "utf8");
    expect(workflow).toContain(
      "lint 'packages/foo' --fail-on error --config 'wastech-mdlint.config.json'",
    );
    // ...and never at the dead `packages/foo/.github/...` location.
    await expect(
      readFile(path.join(cwd, "packages", "foo", workflowPath), "utf8"),
    ).rejects.toThrow();
  });

  it("never anchors the CI workflow or $schema above the user's home directory", async () => {
    // A realistic hazard: the home directory is itself a git repo (a common dotfiles setup), and the
    // actual project being bootstrapped sits underneath it with no `.git`/`package.json` of its own
    // yet (the ordinary "init before git init" case). The repo-root/schema-anchor walk must stop
    // before reaching the home directory rather than mistake the unrelated dotfiles repo for the
    // project root and write files there.
    const fakeHome = await mkdtemp(
      path.join(os.tmpdir(), "wastech-mdlint-fakehome-"),
    );
    tempDirs.push(fakeHome);
    await mkdir(path.join(fakeHome, ".git"), { recursive: true });
    const projectDir = path.join(fakeHome, "projects", "my-docs");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, "a.md"),
      "# A\n\nSee [B](b.md).\n",
      "utf8",
    );
    await writeFile(
      path.join(projectDir, "b.md"),
      "# B\n\nSee [A](a.md).\n",
      "utf8",
    );
    // Installed inside the project itself, so the `$schema` assertion below is about the walk
    // stopping at `$HOME` rather than about the project-local fallback firing.
    const installedSchemaDir = path.join(
      projectDir,
      "node_modules",
      "@wastech-mdlint",
      "cli",
    );
    await mkdir(installedSchemaDir, { recursive: true });
    await writeFile(
      path.join(installedSchemaDir, "schema.json"),
      generateConfigSchema(),
      "utf8",
    );

    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome);
    try {
      const result = await run(
        ["init", projectDir, "--yes", "--with-ci-workflow"],
        projectDir,
      );

      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      // Must never land at the unrelated dotfiles-repo root...
      await expect(
        readFile(
          path.join(fakeHome, ".github", "workflows", "wastech-mdlint.yml"),
          "utf8",
        ),
      ).rejects.toThrow();
      // ...it stays anchored at the actual target directory instead (no ancestor qualifies).
      await expect(
        readFile(
          path.join(projectDir, ".github", "workflows", "wastech-mdlint.yml"),
          "utf8",
        ),
      ).resolves.toBeDefined();
      const written = readConfig(
        await readFile(path.join(projectDir, CONFIG_FILE), "utf8"),
      );
      expect(written.$schema).toBe(
        "./node_modules/@wastech-mdlint/cli/schema.json",
      );
    } finally {
      homedirSpy.mockRestore();
    }
  });

  it("shell-quotes a path with spaces so the lint command stays a single argument", async () => {
    const workflowPath = path.join(
      ".github",
      "workflows",
      "wastech-mdlint.yml",
    );
    // A legal target directory containing a space: it must not split into two tokens.
    const cwd = await fixtureRepo({
      ".git/HEAD": "ref: refs/heads/main\n",
      "doc site/a.md": "# A\n\nSee [B](b.md).\n",
      "doc site/b.md": "# B\n\nSee [A](a.md).\n",
    });

    const result = await run(
      ["init", "doc site", "--yes", "--with-ci-workflow"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    await expect(
      readFile(path.join(cwd, "doc site", CONFIG_FILE), "utf8"),
    ).resolves.toBeDefined();
    const workflow = await readFile(path.join(cwd, workflowPath), "utf8");
    // Since P14.04 the space lives in `[path]`, not in `--config` (which is now a bare filename
    // relative to it), so that argument is where the quoting has to hold: single-quoted as one shell
    // argument, never the bare, space-split `lint doc site`.
    expect(workflow).toContain(
      "lint 'doc site' --fail-on error --config 'wastech-mdlint.config.json'",
    );
    expect(workflow).not.toContain("lint doc site");
  });

  it("never overwrites an existing CI workflow file", async () => {
    const workflowPath = path.join(
      ".github",
      "workflows",
      "wastech-mdlint.yml",
    );
    const existingWorkflowText = "name: hand-written\non: push\n";
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      [workflowPath]: existingWorkflowText,
    });

    const result = await run(["init", cwd, "--yes", "--with-ci-workflow"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // Never clobber a file the user already owns — no "Wrote CI workflow" line, and the file is
    // byte-for-byte untouched (the offer is skipped before ever reaching the prompt/write step).
    expect(result.stdout).not.toContain("Wrote CI workflow");
    // ...but the skip is now stated (audit L-11). Silence read identically to "no workflow was ever
    // offered", leaving a user who passed --with-ci-workflow unsure whether anything happened.
    expect(result.stdout).toContain(
      "Kept the existing CI workflow .github/workflows/wastech-mdlint.yml",
    );
    await expect(readFile(path.join(cwd, workflowPath), "utf8")).resolves.toBe(
      existingWorkflowText,
    );
  });

  it("interactive mode always prompts for the CI workflow, even with --with-ci-workflow set", async () => {
    // `--with-ci-workflow` only pre-answers the prompt under `--yes` (mirrors `--on-existing`);
    // interactively the flag must not silently bypass confirmCiWorkflow.
    let confirmCiWorkflowCalls = 0;
    const prompter = createDefaultFakePrompter({
      confirmCiWorkflow: async () => {
        confirmCiWorkflowCalls += 1;
        return false;
      },
    });
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", cwd, "--with-ci-workflow"], cwd, {
      isTty: true,
      initPrompter: prompter,
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(confirmCiWorkflowCalls).toBe(1);
    expect(result.stdout).not.toContain("Wrote CI workflow");
    await expect(
      readFile(
        path.join(cwd, ".github", "workflows", "wastech-mdlint.yml"),
        "utf8",
      ),
    ).rejects.toThrow();
  });
});

// Audit L-7: `init` proposed `.github/**`, `.venv/**` and `generated-docs/**` as doc clusters, and
// because the written config left `respectGitignore` at its `false` default, lint then read them.
describe("init command · hidden and gitignored trees (L-7)", () => {
  const HONEST_SCAN_FIXTURE: Record<string, string> = {
    ".gitignore": "generated-docs/\n",
    "docs/a.md": "# A\n\nSee [B](b.md).\n",
    "docs/b.md": "# B\n\nSee [A](a.md).\n",
    ".github/PULL_REQUEST_TEMPLATE.md": "# PR\n\nSee [nope](missing.md).\n",
    ".github/ISSUE_TEMPLATE/bug.md": "# Bug\n",
    ".venv/lib/pkg/README.md": "# Vendored\n",
    "generated-docs/api/one.md": "# One\n",
    "generated-docs/api/two.md": "# Two\n",
    "generated-docs/api/three.md": "# Three\n",
  };

  it("proposes none of them, and the written config does not lint them either", async () => {
    const cwd = await fixtureRepo(HONEST_SCAN_FIXTURE);

    const init = await run(["init", cwd, "--yes"], cwd);
    expect(init.exitCode).toBe(EXIT_CODE_SUCCESS);

    // Since P14.03 these names DO appear in stdout — in the disclosure that says they were skipped
    // (W-14). What L-7 is about is that they are not *proposed*, so the assertion is now scoped to
    // the Include section and to the written `include` rather than to the whole of stdout.
    const includeSection = init.stdout.slice(
      init.stdout.indexOf("Include ("),
      init.stdout.indexOf("Excluded from the scan:"),
    );
    expect(includeSection).toContain("docs/**/*.{md,mdx}");
    for (const skipped of [".github", ".venv", "generated-docs"]) {
      expect(includeSection).not.toContain(skipped);
      expect(init.stdout).toContain(skipped);
    }

    const written = readConfig(
      await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    );
    expect(written.include).toEqual(["docs/**/*.{md,mdx}"]);
    expect(written.respectGitignore).toBe(true);
    // `.venv` is excluded because it is a dependency tree named in DEFAULT_NOISE_DIR_NAMES, and
    // `.github` is not excluded at all — `include` is what keeps it out of this config's corpus.
    expect(written.exclude).toContain("**/.venv/**");
    expect(written.exclude).not.toContain("**/.*/**");

    // Not linted: the honest half of the fix. `--fail-on off` keeps the exit code at 0 regardless
    // of findings, and `files` carries the full analyzed corpus.
    const lint = await run(
      ["lint", cwd, "--format", "json", "--fail-on", "off"],
      cwd,
    );
    expect(lint.exitCode).toBe(EXIT_CODE_SUCCESS);
    const { files } = JSON.parse(lint.stdout) as { files: string[] };

    expect(files).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("names the hidden count and the reason in the summary (W-14)", async () => {
    const cwd = await fixtureRepo(HONEST_SCAN_FIXTURE);

    const init = await run(["init", cwd, "--yes"], cwd);
    expect(init.exitCode).toBe(EXIT_CODE_SUCCESS);

    // The count is the one thing the field test could not get from the draft: `.github` holds two
    // Markdown files and nothing said so, leaving a 63-file gap on the real repository silent.
    expect(init.stdout).toContain(
      "hidden directories: 2 Markdown files in 1 directory whose name starts with a dot — .github (2)",
    );
    // Per reason, not one total: each class gets its own line, and the two uncounted ones say so
    // rather than implying a zero.
    expect(init.stdout).toContain(
      "build and dependency directories: 1 directory skipped by name, contents not counted — .venv.",
    );
    expect(init.stdout).toContain(
      "gitignored directories: 1 directory skipped, contents not counted — generated-docs.",
    );
    expect(init.stdout).not.toContain("4 files excluded");
  });
});

// W-14 (P14.03): the field test's own shape — a repository whose LLM-facing documentation lives
// under dot-directories, beside an ordinary `docs/` cluster, a nested dependency tree, and a
// gitignored build output. On the real target this shape left the corpus at 139 files where
// `git ls-files` tracked 202, and nothing said so.
//
// The fixture and its companion tracked-file list are exported module-level consts so P16.01 §2 can
// import them for the both-directions corpus comparison (nothing missing, nothing extra) rather than
// building a second dot-directory repository that drifts from this one.
export const DOT_DIRECTORY_FIXTURE: Record<string, string> = {
  // `node_modules/` is gitignored as a real repository would have it, which is also what makes
  // DOT_DIRECTORY_TRACKED_MARKDOWN below a faithful `git ls-files` oracle rather than
  // "tracked minus whatever the test decided to drop".
  ".gitignore": "generated-docs/\nnode_modules/\n",
  "docs/guide.md": "# Guide\n",
  "docs/reference.md": "# Reference\n",
  ".agents/rules/testing.md": "# Testing\n",
  ".agents/rules/architecture.md": "# Architecture\n",
  ".claude/skills/lint/SKILL.md": "# Skill\n",
  "mobile/node_modules/leftpad/README.md": "# leftpad\n",
  "generated-docs/api/one.md": "# One\n",
};

// What `git ls-files '*.md'` would list for DOT_DIRECTORY_FIXTURE: every Markdown file the fixture's
// own `.gitignore` does not exclude, sorted. The oracle the `comm` comparison runs against.
export const DOT_DIRECTORY_TRACKED_MARKDOWN: string[] = [
  ".agents/rules/architecture.md",
  ".agents/rules/testing.md",
  ".claude/skills/lint/SKILL.md",
  "docs/guide.md",
  "docs/reference.md",
];

describe("init command · the scan-exclusion disclosure (W-14)", () => {
  it("names the excluded count and the reason for each class", async () => {
    const cwd = await fixtureRepo(DOT_DIRECTORY_FIXTURE);

    const init = await run(["init", cwd, "--yes"], cwd);

    expect(init.exitCode).toBe(EXIT_CODE_SUCCESS);
    // The count and the reason together — a count alone does not tell the user that `.claude/` was
    // considered and dropped, which is the sentence the field test found missing.
    expect(init.stdout).toContain(
      "hidden directories: 3 Markdown files in 2 directories whose name starts with a dot — .agents (2), .claude (1)",
    );
    expect(init.stdout).toContain(
      "build and dependency directories: 1 directory skipped by name, contents not counted — node_modules.",
    );
    expect(init.stdout).toContain(
      "gitignored directories: 1 directory skipped, contents not counted — generated-docs.",
    );
  });

  it("accounts for every tracked Markdown file as either linted or disclosed", async () => {
    // The `comm`-against-`git ls-files` arithmetic the field test used to prove its 63-file gap was
    // entirely the hidden-directory prune: corpus + disclosed hidden must equal the tracked set,
    // with the disclosed number read out of the summary rather than restated by the test.
    const cwd = await fixtureRepo(DOT_DIRECTORY_FIXTURE);

    const init = await run(["init", cwd, "--yes"], cwd);
    expect(init.exitCode).toBe(EXIT_CODE_SUCCESS);
    const disclosed = /hidden directories: (\d+) Markdown files/.exec(
      init.stdout,
    );
    expect(disclosed).not.toBeNull();

    const lint = await run(
      ["lint", cwd, "--format", "json", "--fail-on", "off"],
      cwd,
    );
    expect(lint.exitCode).toBe(EXIT_CODE_SUCCESS);
    const { files } = JSON.parse(lint.stdout) as { files: string[] };

    expect(files).toEqual(["docs/guide.md", "docs/reference.md"]);
    expect(files.length + Number(disclosed![1])).toBe(
      DOT_DIRECTORY_TRACKED_MARKDOWN.length,
    );
  });

  it("tells a dot-directory-only repository that the default lints those files anyway", async () => {
    // The branch the unconditional wording got wrong. With every Markdown file behind a dot, the
    // scan sees no cluster, `init` omits `include`, and the dot-matching `**/*.md` default lints
    // exactly the files the disclosure just named — so "add a pattern" would be false advice, and
    // it would contradict the `Include (…)` line printed two lines above it.
    const cwd = await fixtureRepo({
      ".agents/rules/testing.md": "# Testing\n",
      ".agents/rules/architecture.md": "# Architecture\n",
    });

    const init = await run(["init", cwd, "--yes"], cwd);
    expect(init.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(init.stdout).toContain(
      "hidden directories: 2 Markdown files in 1 directory",
    );
    expect(init.stdout).toContain("no include will be written");
    expect(init.stdout).not.toContain("add a pattern");

    const written = readConfig(
      await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    );
    expect(written.include).toBeUndefined();

    const lint = await run(
      ["lint", cwd, "--format", "json", "--fail-on", "off"],
      cwd,
    );
    expect(lint.exitCode).toBe(EXIT_CODE_SUCCESS);
    const { files } = JSON.parse(lint.stdout) as { files: string[] };
    expect(files).toEqual([
      ".agents/rules/architecture.md",
      ".agents/rules/testing.md",
    ]);
  });

  it("lints the dot-directories once the user adds the pattern the disclosure suggests", async () => {
    // W-15's answer made this possible at all: the lint-time default no longer excludes a directory
    // for starting with a dot, so the suggested `include` entry is sufficient on its own. Before
    // P14.03 the same edit produced an empty corpus, because `exclude` wins over `include`.
    const cwd = await fixtureRepo({
      ...DOT_DIRECTORY_FIXTURE,
      [CONFIG_FILE]: JSON.stringify({
        // Verbatim the shape `formatScanExclusions` suggests: the MARKDOWN_GLOB_SUFFIX tail, so the
        // test exercises the advice the user is actually given rather than a narrower hand-written one.
        include: [
          "docs/**/*.{md,mdx}",
          ".agents/**/*.{md,mdx}",
          ".claude/**/*.{md,mdx}",
        ],
        rules: [],
      }),
    });

    const lint = await run(
      ["lint", cwd, "--format", "json", "--fail-on", "off"],
      cwd,
    );

    expect(lint.exitCode).toBe(EXIT_CODE_SUCCESS);
    const { files } = JSON.parse(lint.stdout) as { files: string[] };
    expect(files).toEqual(DOT_DIRECTORY_TRACKED_MARKDOWN);
  });
});

// Audit L-9: `include: []` used to be omitted from the written config, and `lintFiles` defaults an
// absent `include` to `**/*.md` — so turning every cluster down linted the entire repository.
describe("init command · deselecting every cluster (L-9)", () => {
  it('writes an explicit "include": [], says so, and lints nothing', async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    let offeredClusterCount = 0;
    const prompter = createDefaultFakePrompter({
      selectClusters: async (clusters) => {
        offeredClusterCount = clusters.length;
        return [];
      },
    });

    const result = await run(["init", cwd], cwd, {
      isTty: true,
      initPrompter: prompter,
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // Pins the setup: the prompter really was offered something to turn down, so the empty result
    // is a choice rather than a scan that found nothing.
    expect(offeredClusterCount).toBeGreaterThan(0);
    expect(result.stdout).toContain(
      '"include" was written as an empty list, because no doc cluster was selected',
    );

    const written = readConfig(
      await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    );
    expect(written.include).toEqual([]);

    const lint = await run(
      ["lint", cwd, "--format", "json", "--fail-on", "off"],
      cwd,
    );
    expect(lint.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect((JSON.parse(lint.stdout) as { files: string[] }).files).toEqual([]);
  });

  it("shows the empty selection in the draft before the user confirms it", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    let shownDraft = "";
    const prompter = createDefaultFakePrompter({
      selectClusters: async () => [],
      confirmDraft: async (summary) => {
        shownDraft = summary;
        return false;
      },
    });

    const result = await run(["init", cwd], cwd, {
      isTty: true,
      initPrompter: prompter,
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(shownDraft).toContain("none selected");
    expect(shownDraft).toContain("no files will be linted");
    // Declining leaves nothing behind, so the warning was genuinely actionable.
    await expect(
      readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    ).rejects.toThrow();
  });

  it("still omits include when the scan found no cluster to offer", async () => {
    // The opposite reading of the same empty array: nothing was detected, so the tool default is
    // the right answer and the key stays absent. A repo with no Markdown at all is the only way to
    // reach it — with any Markdown present, `scanRepository` emits its `**/*.md` fallback cluster.
    const cwd = await fixtureRepo({ "src/index.ts": "export {};\n" });

    const result = await run(["init", cwd, "--yes"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("no Markdown clusters detected");
    expect(result.stdout).not.toContain("empty list");
    const written = readConfig(
      await readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    );
    expect("include" in written).toBe(false);
  });
});

// Audit L-8: the merge is advertised as additive and non-destructive, but it rebuilds the file from
// parsed values, so every comment the user wrote disappears without a word.
describe("init command · merge over a comment-bearing config (L-8)", () => {
  const COMMENTED_CONFIG = [
    "{",
    "  // Keep REF-001 at warning until the backlog is cleared.",
    '  "rules": [{ "rule": "REF-001", "severity": "warning" }]',
    "}",
    "",
  ].join("\n");

  it("reports the comment loss in the write summary", async () => {
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      [CONFIG_FILE]: COMMENTED_CONFIG,
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain(
      "the JSONC comments in the existing file are not preserved",
    );
    // The claim has to be true: the rebuilt file really has lost the user's comment.
    const rewritten = await readFile(path.join(cwd, CONFIG_FILE), "utf8");
    expect(rewritten).not.toContain("until the backlog is cleared");
  });

  it("warns in the draft, before the user confirms, so declining is still possible", async () => {
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      [CONFIG_FILE]: COMMENTED_CONFIG,
    });
    let shownDraft = "";
    const prompter = createDefaultFakePrompter({
      resolveExistingConfigAction: async () => "merge",
      confirmDraft: async (summary) => {
        shownDraft = summary;
        return false;
      },
    });

    const result = await run(["init", cwd], cwd, {
      isTty: true,
      initPrompter: prompter,
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(shownDraft).toContain(
      "WARNING: merge rebuilds the config from its parsed values",
    );
    expect(shownDraft).toContain("Back it up first if you need them.");
    // Declined, so the comment-bearing original survives byte-for-byte.
    await expect(readFile(path.join(cwd, CONFIG_FILE), "utf8")).resolves.toBe(
      COMMENTED_CONFIG,
    );
  });

  it("stays silent about comments when the existing config has none", async () => {
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      [CONFIG_FILE]: JSON.stringify({ rules: [{ rule: "REF-001" }] }),
    });

    const result = await run(
      ["init", cwd, "--yes", "--on-existing", "merge"],
      cwd,
    );

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).not.toContain("JSONC comments");
  });
});

describe("init command · Ctrl+C and TTY guard", () => {
  it("exits 0 when a prompt is cancelled with Ctrl+C (ExitPromptError) from any prompt step", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const prompter = createDefaultFakePrompter({
      selectClusters: async () => {
        throw Object.assign(new Error("cancelled"), {
          name: "ExitPromptError",
        });
      },
    });

    const result = await run(["init", cwd], cwd, {
      isTty: true,
      initPrompter: prompter,
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  });

  it("exits 0 on Ctrl+C from the final confirmation step too", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const prompter = createDefaultFakePrompter({
      confirmDraft: async () => {
        throw Object.assign(new Error("cancelled"), {
          name: "ExitPromptError",
        });
      },
    });

    const result = await run(["init", cwd], cwd, {
      isTty: true,
      initPrompter: prompter,
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  });

  it("Ctrl+C at the post-write CI-workflow prompt keeps the already-written config + summary", async () => {
    // This prompt runs after the config is on disk; cancelling it must not discard the write summary
    // and make the mutated repo look untouched. Cancellation is treated as "no workflow".
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const prompter = createDefaultFakePrompter({
      confirmDraft: async () => true,
      confirmCiWorkflow: async () => {
        throw Object.assign(new Error("cancelled"), {
          name: "ExitPromptError",
        });
      },
    });

    const result = await run(["init", cwd], cwd, {
      isTty: true,
      initPrompter: prompter,
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // The config was written and its summary printed — cancellation only skipped the workflow.
    expect(result.stdout).toContain(`Wrote ${CONFIG_FILE}`);
    expect(result.stdout).not.toContain("Wrote CI workflow");
    await expect(
      readFile(path.join(cwd, CONFIG_FILE), "utf8"),
    ).resolves.toBeDefined();
  });

  it("rejects a non-interactive invocation without --yes as a usage error", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", cwd], cwd, { isTty: false });

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain("init requires an interactive terminal");
  });

  it("rejects a TTY stdin paired with a non-TTY (piped) stdout as a usage error", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", cwd], cwd, {
      stdinIsTty: true,
      stdoutIsTty: false,
    });

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain("init requires an interactive terminal");
  });

  it("rejects a TTY stdout paired with a non-TTY stdin as a usage error", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);

    const result = await run(["init", cwd], cwd, {
      stdinIsTty: false,
      stdoutIsTty: true,
    });

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain("init requires an interactive terminal");
  });

  it("proceeds interactively only when both stdin and stdout resolve to a TTY", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const prompter = createDefaultFakePrompter();

    const result = await run(["init", cwd], cwd, {
      stdinIsTty: true,
      stdoutIsTty: true,
      initPrompter: prompter,
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
  });
});

describe("init command · declined confirmation", () => {
  it("reports an abort without printing the draft when the user declines", async () => {
    const cwd = await fixtureRepo(CROSS_LINKED_DOCS_FIXTURE);
    const prompter = createDefaultFakePrompter({
      confirmDraft: async () => false,
    });

    const result = await run(["init", cwd], cwd, {
      isTty: true,
      initPrompter: prompter,
    });

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toBe("Aborted: configuration not confirmed.\n");
  });
});

function buildDocCluster(
  overrides: Partial<DocCluster> & { path: string },
): DocCluster {
  return {
    kind: "cluster",
    score: 3,
    subtreeCount: 3,
    includeGlob: `${overrides.path}/**/*.md`,
    sampleFiles: [],
    ...overrides,
  };
}

function buildInferredRule(
  overrides: Partial<InferredRule> & { rule: string; category: RuleCategory },
): InferredRule {
  return {
    description: "A rule description.",
    defaultSeverity: "warning",
    fixable: false,
    rationale: "Because the sample evidence says so.",
    ...overrides,
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

    const { newRules } = diffAgainstExistingRuleIds(
      ["ref001"],
      [refOne, refTwo],
    );

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
      options: {
        files: ["docs/**/*.md"],
        sections: ["Status", "Context", "Decision"],
      },
    });

    const preview = buildConfigPreview([clusterA, clusterB], [sec001]);

    expect(preview.include).toEqual(["docs/**/*.md"]);
    expect(preview.rules).toEqual([
      {
        rule: "SEC-001",
        options: {
          files: ["docs/**/*.md"],
          sections: ["Status", "Context", "Decision"],
        },
      },
    ]);
  });

  it("omits the options key entirely for a rule with no derived options", () => {
    const preview = buildConfigPreview(
      [],
      [buildInferredRule({ rule: "REF-001", category: "REF" })],
    );
    expect(preview.rules).toEqual([{ rule: "REF-001" }]);
    expect(Object.keys(preview.rules[0]!)).not.toContain("options");
  });

  it("stays forward-compatible with lintConfigSchema/ruleEntrySchema (P6.04 smoke check)", () => {
    const cluster = buildDocCluster({ path: "docs" });
    const rule = buildInferredRule({
      rule: "SEC-001",
      category: "SEC",
      options: { files: ["docs/**/*.md"], sections: ["Status"] },
    });

    const preview = buildConfigPreview([cluster], [rule]);

    expect(lintConfigSchema.safeParse(preview).success).toBe(true);
    for (const entry of preview.rules) {
      expect(ruleEntrySchema.safeParse(entry).success).toBe(true);
    }
  });
});

describe("formatDraftSummary", () => {
  function buildSelections(
    overrides: Partial<ConfirmedInitSelections> = {},
  ): ConfirmedInitSelections {
    return {
      existingConfigAction: "none",
      packageManager: undefined,
      clusters: [],
      rules: [],
      newRuleIds: [],
      existingConfigUnreadable: false,
      clustersWereOffered: false,
      existingConfigHasComments: false,
      pruning: { directories: [] },
      ...overrides,
    };
  }

  it("reports no existing config and no detected package manager", () => {
    const summary = formatDraftSummary(buildSelections(), undefined);
    expect(summary).toContain("Existing config: none found.");
    expect(summary).toContain("Package manager: not detected.");
    expect(summary).toContain("(none — no Markdown clusters detected");
    expect(summary).toContain("(none inferred)");
  });

  // Audit L-9: both empty cases render "Include (0)", so the parenthetical is the only thing telling
  // the user whether a config that lints everything or one that lints nothing is about to be written.
  it("distinguishes 'no clusters detected' from 'every offered cluster deselected'", () => {
    const detectedNone = formatDraftSummary(
      buildSelections({ clustersWereOffered: false }),
      undefined,
    );
    expect(detectedNone).toContain("no Markdown clusters detected");
    expect(detectedNone).toContain("the default **/*.md applies");

    const deselectedAll = formatDraftSummary(
      buildSelections({ clustersWereOffered: true }),
      undefined,
    );
    expect(deselectedAll).toContain("none selected");
    expect(deselectedAll).toContain("no files will be linted");
    expect(deselectedAll).not.toContain("no Markdown clusters detected");
  });

  it("groups rules under sorted category headings regardless of input order", () => {
    const tbl = buildInferredRule({ rule: "TBL-002", category: "TBL" });
    const ctx = buildInferredRule({ rule: "CTX-002", category: "CTX" });
    const summary = formatDraftSummary(
      buildSelections({ rules: [tbl, ctx] }),
      undefined,
    );

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
      buildSelections({
        existingConfigAction: "merge",
        clusters: [cluster],
        rules: [rule],
        newRuleIds: ["REF-002"],
      }),
      "wastech-mdlint.config.json",
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
        existingConfigUnreadable: true,
      }),
      "wastech-mdlint.config.json",
    );

    expect(summary).toContain(
      "WARNING: the existing config could not be read, parsed, or validated",
    );
  });
});

describe("formatScanExclusions", () => {
  it("renders one line per reason and no aggregate total", () => {
    const lines = formatScanExclusions(
      {
        directories: [
          { path: ".agents", reason: "hidden", markdownFileCount: 23 },
          { path: ".claude", reason: "hidden", markdownFileCount: 28 },
          { path: "generated-docs", reason: "gitignored" },
          { path: "node_modules", reason: "noise" },
        ],
      },
      true,
    );

    expect(lines[0]).toBe("Excluded from the scan:");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("51 Markdown files in 2 directories");
    expect(lines[1]).toContain(".agents (23), .claude (28)");
    expect(lines[2]).toContain("contents not counted — node_modules");
    expect(lines[3]).toContain("contents not counted — generated-docs");

    // The defect this closes is a single number the user skims past, so no line may present the
    // three classes as one total.
    expect(lines.join("\n")).not.toContain("52 ");
  });

  it("renders nothing when the scan pruned nothing worth disclosing", () => {
    expect(formatScanExclusions({ directories: [] }, true)).toEqual([]);

    // A hidden directory holding no Markdown is not a finding — reporting it would train the reader
    // to ignore the line that matters.
    expect(
      formatScanExclusions(
        {
          directories: [
            { path: ".husky", reason: "hidden", markdownFileCount: 0 },
          ],
        },
        true,
      ),
    ).toEqual([]);
  });

  it("dedupes noise basenames and caps a long list with a +N more tail", () => {
    const lines = formatScanExclusions(
      {
        directories: [
          ...["a", "b", "c"].map((dir) => ({
            path: `${dir}/node_modules`,
            reason: "noise" as const,
          })),
          ...["d", "e", "f", "g", "h", "i"].map((dir) => ({
            path: `${dir}/${dir}build`,
            reason: "noise" as const,
          })),
        ],
      },
      true,
    );

    // Nine pruned directories, seven distinct basenames: the count is directories, the list is
    // names, and the cap keeps the line readable on a monorepo.
    expect(lines[1]).toContain("9 directories skipped by name");
    expect(lines[1]).toContain(
      "dbuild, ebuild, fbuild, gbuild, hbuild, +2 more",
    );
    expect(lines[1]).not.toContain("ibuild");
  });

  it("uses singular wording for a single file in a single directory", () => {
    const lines = formatScanExclusions(
      {
        directories: [
          { path: ".claude", reason: "hidden", markdownFileCount: 1 },
        ],
      },
      true,
    );

    expect(lines[1]).toContain("1 Markdown file in 1 directory");
    // The actionable half: a dot-directory is invisible to the scan, so no proposal covers it. The
    // suggested tail is MARKDOWN_GLOB_SUFFIX, not a literal `*.md`: the count in the same sentence
    // was produced with `.md` + `.mdx`, so a narrower pattern would under-deliver on it (W-09).
    expect(lines[1]).toContain(
      'add a pattern such as ".claude/**/*.{md,mdx}" to lint it',
    );
  });

  it("says the default lints them instead when no include will be written", () => {
    // The reachable case this closes: a repository whose only Markdown is in dot-directories offers
    // the scan no cluster at all, so `include` is omitted and the dot-matching `**/*.md` default is
    // what governs. Telling that user to add a pattern would contradict the `Include (…)` line
    // printed two lines above.
    const lines = formatScanExclusions(
      {
        directories: [
          { path: ".agents", reason: "hidden", markdownFileCount: 2 },
        ],
      },
      false,
    );

    expect(lines[1]).toContain("2 Markdown files in 1 directory");
    expect(lines[1]).toContain("no include will be written");
    expect(lines[1]).toContain("**/*.md default stays in force");
    expect(lines[1]).not.toContain("add a pattern");
  });

  it("sorts the hidden entries at the rendering site", () => {
    // `ScanPruning` is public core API and this formatter is exported, so an unsorted record must not
    // change either the order or which entries survive the cap.
    const lines = formatScanExclusions(
      {
        directories: [
          { path: ".claude", reason: "hidden", markdownFileCount: 1 },
          { path: ".agents", reason: "hidden", markdownFileCount: 2 },
        ],
      },
      true,
    );

    expect(lines[1]).toContain(".agents (2), .claude (1)");
    expect(lines[1]).toContain('add a pattern such as ".agents/**/*.{md,mdx}"');
  });
});

describe("formatWriteSummary", () => {
  function buildResult(
    overrides: Partial<GeneratedInitConfig> = {},
  ): GeneratedInitConfig {
    return {
      configText: "{}\n",
      schemaRef: "./node_modules/@wastech-mdlint/cli/schema.json",
      addedRuleCount: 2,
      totalRuleCount: 2,
      wroteEmptyInclude: false,
      ...overrides,
    };
  }

  it("reports a fresh write with its rule count and schema ref, and no schema/workflow lines by default", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult(),
      configPath: CONFIG_FILE,
      commentsDropped: false,
    });

    expect(summary).toContain(`Wrote ${CONFIG_FILE} with 2 rule(s).`);
    expect(summary).toContain(
      "Schema: ./node_modules/@wastech-mdlint/cli/schema.json",
    );
    expect(summary).not.toContain("Wrote project-local schema");
    expect(summary).not.toContain("Wrote CI workflow");
  });

  it("reports a merge's added-vs-total rule counts with distinct wording from a fresh write", () => {
    const summary = formatWriteSummary({
      action: "merge",
      result: buildResult({ addedRuleCount: 1, totalRuleCount: 3 }),
      configPath: CONFIG_FILE,
      commentsDropped: false,
    });

    expect(summary).toContain(
      `Merged ${CONFIG_FILE}: 1 new rule(s) appended (3 total).`,
    );
  });

  it("mentions the project-local schema and CI workflow only when their paths are actually passed", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult({ schemaRef: "./schema.json" }),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      schema: { kind: "written", path: "schema.json", reason: "custom-rules" },
      ciWorkflow: {
        kind: "written",
        path: ".github/workflows/wastech-mdlint.yml",
      },
    });

    expect(summary).toContain(
      "Wrote project-local schema schema.json (custom rules present).",
    );
    expect(summary).toContain(
      "Wrote CI workflow .github/workflows/wastech-mdlint.yml.",
    );
  });

  it("reports a kept existing schema.json without claiming a write happened", () => {
    const summary = formatWriteSummary({
      action: "merge",
      result: buildResult({ schemaRef: "./schema.json" }),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      schema: { kind: "kept", path: "schema.json", reason: "custom-rules" },
    });

    expect(summary).toContain("Kept existing schema.json at schema.json");
    expect(summary).not.toContain("Wrote project-local schema");
    // H-4 follow-up: the config's $schema still points at the pre-existing file even though the
    // write was skipped, and the only working regeneration route is --on-existing merge — a real
    // --on-existing overwrite run always discards the custom rules this write depends on, so it
    // can never reach this branch and must not be advertised as a fix.
    expect(summary).toContain("The config's $schema still points at it");
    expect(summary).toContain("--on-existing merge");
    expect(summary).not.toContain("run again with --on-existing overwrite");
  });

  // Under the npx fallback the kept file is somebody else's `schema.json`, not a stale copy of
  // init's own — so the advice must be "repoint or move it", never "re-run to regenerate over it".
  it("tells the npx-fallback case that $schema now names a file init did not generate", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult({ schemaRef: "./schema.json" }),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      schema: {
        kind: "kept",
        path: "schema.json",
        reason: "no-installed-package",
      },
    });

    expect(summary).toContain(
      "The config's $schema points at it even though init did not generate it",
    );
    expect(summary).toContain("Repoint $schema by hand");
    expect(summary).not.toContain("--on-existing merge");
    expect(summary).not.toContain("custom rules present");
  });

  it("reports an up-to-date project-local schema without claiming a write happened", () => {
    const summary = formatWriteSummary({
      action: "merge",
      result: buildResult({ schemaRef: "./schema.json" }),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      schema: {
        kind: "unchanged",
        path: "schema.json",
        reason: "custom-rules",
      },
    });

    expect(summary).toContain(
      "Project-local schema schema.json is already up to date",
    );
    expect(summary).not.toContain("Wrote project-local schema");
    expect(summary).not.toContain("Kept existing schema.json");
  });

  it("reports an explicit overwrite of an existing schema.json", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult({ schemaRef: "./schema.json" }),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      schema: {
        kind: "overwritten",
        path: "schema.json",
        reason: "custom-rules",
      },
    });

    expect(summary).toContain("Overwrote schema.json at schema.json");
    expect(summary).toContain("--on-existing overwrite");
  });

  it("reports an unreadable existing schema.json as kept, saying why it could not be compared", () => {
    const summary = formatWriteSummary({
      action: "merge",
      result: buildResult({ schemaRef: "./schema.json" }),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      schema: {
        kind: "unreadable",
        path: "schema.json",
        reason: "custom-rules",
      },
    });

    expect(summary).toContain("Kept existing schema.json at schema.json");
    expect(summary).toContain("exists but could not be read");
    expect(summary).toContain("--on-existing merge");
    expect(summary).not.toContain("Wrote project-local schema");
  });

  it("reports a failed CI-workflow write without implying the config failed too", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult(),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      ciWorkflow: {
        kind: "failed",
        path: ".github/workflows/wastech-mdlint.yml",
        code: "EACCES",
      },
    });

    expect(summary).toContain(`Wrote ${CONFIG_FILE} with 2 rule(s).`);
    expect(summary).toContain(
      "Could not write the CI workflow .github/workflows/wastech-mdlint.yml (EACCES)",
    );
    expect(summary).toContain("the config above was still written");
    expect(summary).not.toContain("Wrote CI workflow");
  });

  it("omits the errno from a failed CI-workflow line when there is none", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult(),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      ciWorkflow: {
        kind: "failed",
        path: ".github/workflows/wastech-mdlint.yml",
      },
    });

    expect(summary).toContain(
      "Could not write the CI workflow .github/workflows/wastech-mdlint.yml —",
    );
    expect(summary).not.toContain("()");
  });

  // Audit L-11: both of these used to be silent — the summary simply had no workflow line, which
  // reads identically to a run that never offered one.
  it("reports a pre-existing CI workflow as kept rather than saying nothing", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult(),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      ciWorkflow: {
        kind: "kept",
        path: ".github/workflows/wastech-mdlint.yml",
      },
    });

    expect(summary).toContain(
      "Kept the existing CI workflow .github/workflows/wastech-mdlint.yml",
    );
    expect(summary).toContain("init never overwrites it");
    expect(summary).not.toContain("Wrote CI workflow");
  });

  it("explains a CI workflow skipped because the config path is unrepresentable", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult(),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      ciWorkflow: {
        kind: "unsafe-config-path",
        path: ".github/workflows/wastech-mdlint.yml",
      },
    });

    expect(summary).toContain(
      "Skipped the CI workflow .github/workflows/wastech-mdlint.yml",
    );
    expect(summary).toContain("line terminator");
    expect(summary).toContain("The config above was still written");
  });

  // Audit L-8: the merge presents itself as non-destructive, so the one thing it does destroy has to
  // be said out loud.
  it("reports dropped JSONC comments on a merge", () => {
    const summary = formatWriteSummary({
      action: "merge",
      result: buildResult({ addedRuleCount: 1, totalRuleCount: 3 }),
      configPath: CONFIG_FILE,
      commentsDropped: true,
    });

    expect(summary).toContain(
      "Note: merge rebuilds the config from its parsed values, so the JSONC comments in the " +
        "existing file are not preserved.",
    );
  });

  it("says nothing about comments when the previous config had none", () => {
    const summary = formatWriteSummary({
      action: "merge",
      result: buildResult(),
      configPath: CONFIG_FILE,
      commentsDropped: false,
    });

    expect(summary).not.toContain("JSONC comments");
  });

  // Audit L-9: a config that lints zero files is a legitimate outcome, but an unannounced one looks
  // exactly like a broken install the first time `lint` reports nothing.
  it("flags an empty include so a zero-file config is not a silent surprise", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult({ wroteEmptyInclude: true }),
      configPath: CONFIG_FILE,
      commentsDropped: false,
    });

    expect(summary).toContain(
      '"include" was written as an empty list, because no doc cluster was selected',
    );
    expect(summary).toContain("no files will be linted");
  });

  it("does not flag include when a real one was written", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult(),
      configPath: CONFIG_FILE,
      commentsDropped: false,
    });

    expect(summary).not.toContain("empty list");
  });

  it("names the npx fallback as the reason for a project-local schema, not custom rules", () => {
    const summary = formatWriteSummary({
      action: "fresh",
      result: buildResult({ schemaRef: "./schema.json" }),
      configPath: CONFIG_FILE,
      commentsDropped: false,
      schema: {
        kind: "written",
        path: "schema.json",
        reason: "no-installed-package",
      },
    });

    expect(summary).toContain(
      "Wrote project-local schema schema.json (no installed package schema to point at).",
    );
    expect(summary).not.toContain("custom rules present");
  });
});

describe("resolveSchemaWriteOutcome", () => {
  const generatedSchemaText = '{"generated":true}\n';

  it("writes fresh when no schema.json exists yet, regardless of the existing-config action", () => {
    expect(
      resolveSchemaWriteOutcome({
        existingConfigAction: "merge",
        existingSchemaText: undefined,
        existingSchemaUnreadable: false,
        generatedSchemaText,
        reason: "custom-rules",
      }),
    ).toEqual({ shouldWrite: true, kind: "written" });
    expect(
      resolveSchemaWriteOutcome({
        existingConfigAction: "none",
        existingSchemaText: undefined,
        existingSchemaUnreadable: false,
        generatedSchemaText,
        reason: "no-installed-package",
      }),
    ).toEqual({ shouldWrite: true, kind: "written" });
  });

  it("reports an existing schema.json as already up to date when its bytes match exactly, even under overwrite", () => {
    expect(
      resolveSchemaWriteOutcome({
        existingConfigAction: "merge",
        existingSchemaText: generatedSchemaText,
        existingSchemaUnreadable: false,
        generatedSchemaText,
        reason: "custom-rules",
      }),
    ).toEqual({ shouldWrite: false, kind: "unchanged" });
    expect(
      resolveSchemaWriteOutcome({
        existingConfigAction: "overwrite",
        existingSchemaText: generatedSchemaText,
        existingSchemaUnreadable: false,
        generatedSchemaText,
        reason: "custom-rules",
      }),
    ).toEqual({ shouldWrite: false, kind: "unchanged" });
  });

  it("overwrites an existing schema.json that differs, only under an explicit overwrite action", () => {
    expect(
      resolveSchemaWriteOutcome({
        existingConfigAction: "overwrite",
        existingSchemaText: '{"hand-written":true}\n',
        existingSchemaUnreadable: false,
        generatedSchemaText,
        reason: "custom-rules",
      }),
    ).toEqual({ shouldWrite: true, kind: "overwritten" });
  });

  // The guard on the one destructive outcome: `--on-existing overwrite` says what to do with the
  // *config*. Only the custom-rules reason ties the schema's contents to that config; the npx
  // fallback just needs a resolvable target, so an unrelated `schema.json` — a name that collides
  // easily — is kept even here.
  it("keeps a differing schema.json under overwrite when the project schema is only the npx fallback", () => {
    expect(
      resolveSchemaWriteOutcome({
        existingConfigAction: "overwrite",
        existingSchemaText: '{"openapi":"3.1.0"}\n',
        existingSchemaUnreadable: false,
        generatedSchemaText,
        reason: "no-installed-package",
      }),
    ).toEqual({ shouldWrite: false, kind: "kept" });
  });

  it("keeps a differing existing schema.json on a merge", () => {
    expect(
      resolveSchemaWriteOutcome({
        existingConfigAction: "merge",
        existingSchemaText: '{"hand-written":true}\n',
        existingSchemaUnreadable: false,
        generatedSchemaText,
        reason: "custom-rules",
      }),
    ).toEqual({ shouldWrite: false, kind: "kept" });
  });

  it("keeps a differing existing schema.json when there is no existing-config action at all", () => {
    expect(
      resolveSchemaWriteOutcome({
        existingConfigAction: "none",
        existingSchemaText: '{"hand-written":true}\n',
        existingSchemaUnreadable: false,
        generatedSchemaText,
        reason: "custom-rules",
      }),
    ).toEqual({ shouldWrite: false, kind: "kept" });
  });

  // P11.09: `rename` only needs write permission on the *directory*, so an unreadable target no
  // longer blocks the write the way a truncating `writeFile` did. This branch must therefore win
  // ahead of everything else — including an explicit `overwrite`, which cannot be an informed
  // instruction about a file nobody could read.
  it("refuses to touch a present-but-unreadable schema.json, ahead of every other check", () => {
    for (const existingConfigAction of [
      "overwrite",
      "merge",
      "none",
    ] as const) {
      for (const reason of ["custom-rules", "no-installed-package"] as const) {
        expect(
          resolveSchemaWriteOutcome({
            existingConfigAction,
            existingSchemaText: undefined,
            existingSchemaUnreadable: true,
            generatedSchemaText,
            reason,
          }),
        ).toEqual({ shouldWrite: false, kind: "unreadable" });
      }
    }
  });
});

describe("formatWriteFailureSummary", () => {
  it("reports a failure before anything was committed, with the errno and the byte-unchanged guarantee", () => {
    const summary = formatWriteFailureSummary({
      written: [],
      notWritten: ["schema.json", CONFIG_FILE],
      failedPath: "schema.json",
      code: "EISDIR",
    });

    expect(summary).toContain(
      "Write failed: could not replace schema.json (EISDIR).",
    );
    expect(summary).toContain("Written: nothing.");
    expect(summary).toContain(
      `Not written: schema.json, ${CONFIG_FILE}. Every file listed as not written is byte-unchanged on disk`,
    );
    expect(summary).toContain("Fix the cause and re-run init.");
  });

  it("names the committed prefix on a partial write and sorts both lists", () => {
    const summary = formatWriteFailureSummary({
      written: ["schema.json", "docs/schema.json"],
      notWritten: [CONFIG_FILE],
      failedPath: CONFIG_FILE,
    });

    expect(summary).toContain("Written: docs/schema.json, schema.json.");
    expect(summary).toContain(`Not written: ${CONFIG_FILE}.`);
    // No errno available (e.g. a failed mkdir) must not render an empty "()" placeholder.
    expect(summary).toContain(`could not replace ${CONFIG_FILE}.`);
    expect(summary).not.toContain("()");
  });
});

describe("formatNotWrittenSummary", () => {
  it("names the unreadable existing config's path and tells the user how to recover", () => {
    const summary = formatNotWrittenSummary("docs/wastech-mdlint.config.json");
    expect(summary).toContain(
      "Not written: the existing config at docs/wastech-mdlint.config.json",
    );
    expect(summary).toContain("Fix or remove it, then re-run init.");
  });

  it("falls back to the canonical filename when no config path is known", () => {
    const summary = formatNotWrittenSummary(undefined);
    expect(summary).toContain(
      `Not written: the existing config at ${CONFIG_FILE}`,
    );
  });
});

// The production read path (audit L-11 retired `readExistingRuleIds`, an exported wrapper with no
// caller): `readExistingConfigDocument` parses the file once and `extractExistingRuleIds` derives
// the merge identity from that snapshot. These are the two functions `runInitCommand` actually
// calls, so the coverage below follows them rather than a parallel convenience wrapper.
describe("readExistingConfigDocument + extractExistingRuleIds", () => {
  async function readIds(cwd: string, fileName: string) {
    const document = await readExistingConfigDocument(
      cwd,
      path.join(cwd, fileName),
    );
    const { ruleIds, mergeable } = extractExistingRuleIds(document.raw);
    // `parsed` here means "readable AND additively mergeable" — the single signal the merge path
    // gates on, which is what the retired wrapper used to return.
    return { ruleIds, parsed: document.parsed && mergeable };
  }

  it("returns parsed: false and no ids rather than throwing on a malformed config", async () => {
    const cwd = await fixtureRepo({ "broken.json": "{ not json" });
    expect(await readIds(cwd, "broken.json")).toEqual({
      ruleIds: [],
      parsed: false,
    });
  });

  it("returns parsed: false for a missing file rather than throwing", async () => {
    const cwd = await fixtureRepo({});
    expect(await readIds(cwd, "does-not-exist.json")).toEqual({
      ruleIds: [],
      parsed: false,
    });
  });

  it("returns parsed: true with [] for a validly-parsed config with no rules[]", async () => {
    const cwd = await fixtureRepo({
      [CONFIG_FILE]: JSON.stringify({ include: ["**/*.md"] }),
    });
    expect(await readIds(cwd, CONFIG_FILE)).toEqual({
      ruleIds: [],
      parsed: true,
    });
  });

  it("returns parsed: false for a JSONC-valid config whose rules key isn't an array", async () => {
    for (const rules of [{}, "REF-001"]) {
      const cwd = await fixtureRepo({
        [CONFIG_FILE]: JSON.stringify({ rules }),
      });
      expect(await readIds(cwd, CONFIG_FILE)).toEqual({
        ruleIds: [],
        parsed: false,
      });
    }
  });

  it("returns parsed: false for a rules[] entry the merge cannot identify", async () => {
    // A bare string looks array-shaped but carries no `{ rule }` to canonically diff, so a merge
    // could not prove it a duplicate; a non-string `rule` and a custom entry with a missing or
    // non-string `id` fail the same way. Non-mergeable, not silently kept.
    for (const rules of [
      ["REF-001"],
      [{ rule: 1 }],
      [{ rule: "custom" }],
      [{ rule: "custom", id: 1 }],
    ]) {
      const cwd = await fixtureRepo({
        [CONFIG_FILE]: JSON.stringify({ rules }),
      });
      expect(await readIds(cwd, CONFIG_FILE)).toEqual({
        ruleIds: [],
        parsed: false,
      });
    }
  });

  it('identifies a custom entry by its canonical id, not the literal "custom"', async () => {
    const cwd = await fixtureRepo({
      [CONFIG_FILE]: JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "req-100",
            options: { assert: { kind: "sectionPresent", sections: ["X"] } },
          },
        ],
      }),
    });
    expect(await readIds(cwd, CONFIG_FILE)).toEqual({
      ruleIds: ["REQ-100"],
      parsed: true,
    });
  });

  it("parses JSONC (comments + trailing commas), canonicalizing every rule id", async () => {
    const cwd = await fixtureRepo({
      [CONFIG_FILE]: [
        "{",
        "  // rationale: link integrity",
        '  "rules": [',
        '    { "rule": "ref001" },',
        '    { "rule": "TBL-002" },',
        "  ],",
        "}",
      ].join("\n"),
    });

    expect(await readIds(cwd, CONFIG_FILE)).toEqual({
      ruleIds: ["REF-001", "TBL-002"],
      parsed: true,
    });
  });

  // Audit L-8: the merge rebuilds the file, so this flag is what lets the summaries admit the loss.
  it("reports whether the file on disk carries JSONC comments", async () => {
    const withComments = await fixtureRepo({
      [CONFIG_FILE]: '{\n  // link integrity\n  "rules": []\n}\n',
    });
    await expect(
      readExistingConfigDocument(
        withComments,
        path.join(withComments, CONFIG_FILE),
      ),
    ).resolves.toMatchObject({ parsed: true, hasComments: true });

    const withoutComments = await fixtureRepo({
      [CONFIG_FILE]: JSON.stringify({ rules: [], include: ["docs/**/*.md"] }),
    });
    await expect(
      readExistingConfigDocument(
        withoutComments,
        path.join(withoutComments, CONFIG_FILE),
      ),
    ).resolves.toMatchObject({ parsed: true, hasComments: false });
  });

  it("reports no comments for a file it could not parse", async () => {
    // Nothing is known to be lost when the file cannot be read, and that case aborts the merge
    // anyway — claiming comment loss there would be a second, misleading warning.
    const cwd = await fixtureRepo({ "broken.json": "{ // c\n not json" });
    await expect(
      readExistingConfigDocument(cwd, path.join(cwd, "broken.json")),
    ).resolves.toEqual({ raw: undefined, parsed: false, hasComments: false });
  });
});

// Real `@inquirer/prompts` calls hang without a live TTY (confirmed elsewhere in this suite: even
// a redirected /dev/null stdin never resolves), so these assert the exact `default` handed to the
// real `select()` call — the config that decides what plain Enter resolves to — as a stand-in for
// actually driving the prompt. That default must never silently diverge from what `--yes` does.
describe("interactive prompt defaults match --yes", () => {
  it("resolveExistingConfigAction's prompt defaults to the same action --yes falls back to", () => {
    const config = buildExistingConfigActionPromptConfig(
      "wastech-mdlint.config.json",
    );
    expect(config.default).toBe(DEFAULT_EXISTING_CONFIG_ACTION);
    expect(config.default).toBe("skip");
    // The default must also be one of the real offered choices, not a dangling value.
    expect(config.choices.map((choice) => choice.value)).toContain(
      config.default,
    );
  });

  it('choosePackageManager\'s prompt defaults to "not detected", not the first listed manager', () => {
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
    const cwdOne = await fixtureRepo(
      withInstalledSchema(CUSTOM_LAYOUT_FIXTURE),
    );
    const cwdTwo = await fixtureRepo(
      withInstalledSchema(CUSTOM_LAYOUT_FIXTURE),
    );

    const first = await run(["init", cwdOne, "--yes"], cwdOne);
    const second = await run(["init", cwdTwo, "--yes"], cwdTwo);

    expect(first.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(first.stdout).toBe(second.stdout);

    const written = readConfig(
      await readFile(path.join(cwdOne, CONFIG_FILE), "utf8"),
    );
    expect(written.include).toContain("specs/**/*.{md,mdx}");
    expect(written.include).toContain("adr/**/*.{md,mdx}");
    const ruleIds = (written.rules as { rule: string }[])
      .map((entry) => entry.rule)
      .sort();
    expect(ruleIds).toEqual([
      "CTX-002",
      "GRP-001",
      "REF-001",
      "SEC-001",
      "TBL-002",
    ]);
    // Local, version-matched schema ref — never a remote URL (architecture invariant / C9).
    expect(written.$schema).toBe(
      "./node_modules/@wastech-mdlint/cli/schema.json",
    );
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

    const written = readConfig(
      await readFile(path.join(cwdOne, CONFIG_FILE), "utf8"),
    );
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
    { lockfile: "package-lock.json", expected: "npm" },
  ];

  for (const { lockfile, expected } of lockfileCases) {
    it(`reports "${expected}" from a ${lockfile} lockfile`, async () => {
      const cwd = await fixtureRepo({
        ...CROSS_LINKED_DOCS_FIXTURE,
        [lockfile]: "",
      });

      const result = await run(["init", cwd, "--yes"], cwd);

      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain(`Package manager: ${expected}.`);
    });
  }

  it('reports "not detected" when no lockfile is present', async () => {
    // The `.git` marker bounds the ancestor walk to the fixture (audit L-11): without it, "no
    // lockfile" would be a claim about every directory above the temp dir on the host.
    const cwd = await fixtureRepo({
      ...CROSS_LINKED_DOCS_FIXTURE,
      ".git/HEAD": "ref: refs/heads/main\n",
    });

    const result = await run(["init", cwd, "--yes"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("Package manager: not detected.");
  });

  // P9.07 (L-7): the detected manager is surfaced in the draft summary above, but the opt-in CI
  // workflow is npm-universal BY DESIGN (buildCiWorkflowYaml's own comment explains why) — a
  // bun/pnpm/yarn repo must still get the same npm-based workflow, not have its detection leak in.
  for (const { lockfile, expected } of lockfileCases) {
    it(`still writes an npm-based CI workflow for a detected "${expected}" manager (${lockfile})`, async () => {
      const cwd = await fixtureRepo({
        ...CROSS_LINKED_DOCS_FIXTURE,
        [lockfile]: "",
      });

      const result = await run(
        ["init", cwd, "--yes", "--with-ci-workflow"],
        cwd,
      );

      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
      expect(result.stdout).toContain(`Package manager: ${expected}.`);
      const workflow = await readFile(
        path.join(cwd, ".github", "workflows", "wastech-mdlint.yml"),
        "utf8",
      );
      expect(workflow).toContain("npm install --no-save @wastech-mdlint/cli");
      expect(workflow).toContain("npx wastech-mdlint lint --fail-on error");
    });
  }
});
