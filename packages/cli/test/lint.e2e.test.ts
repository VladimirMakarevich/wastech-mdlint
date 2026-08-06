import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXIT_CODE_FINDINGS,
  EXIT_CODE_SUCCESS,
  EXIT_CODE_USAGE_ERROR,
} from "../src/commands.js";
import { runCli } from "../src/program.js";

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
    path.join(os.tmpdir(), "wastech-mdlint-cli-lint-"),
  );
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    // Nested fixtures let a scenario exercise directory globs such as `drafts/**`; without this the
    // write ENOENTs.
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

async function run(args: string[], cwd: string) {
  const stdout = createMemoryWriter();
  const stderr = createMemoryWriter();
  const exitCode = await runCli(args, {
    cwd,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });
  return { exitCode, stdout: stdout.read(), stderr: stderr.read() };
}

describe("lint command", () => {
  it("reports findings and exits 1 under the default fail-on error", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[broken](missing.md)\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "REF-001" }],
      }),
    });

    const result = await run(["lint", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_FINDINGS);
    expect(result.stdout).toContain("REF-001");
    expect(result.stdout).toContain("missing.md");
  });

  it("passes cleanly (exit 0) when no rules fire", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[ok](b.md)\n",
      "b.md": "# B\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "REF-001" }],
      }),
    });

    const result = await run(["lint", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("No problems found.");
  });

  it("passes when a required non-Markdown file is present on disk (audit BL-1)", async () => {
    // The user-visible symptom: a repository that really ships a `LICENSE` used to exit 1, because
    // STR-001 could only see the Markdown corpus.
    const cwd = await fixtureRepo({
      "README.md": "# Readme\n",
      LICENSE: "MIT\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          { rule: "STR-001", options: { files: ["README.md", "LICENSE"] } },
        ],
      }),
    });

    const result = await run(["lint", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("No problems found.");
  });

  // Audit L-4: the per-rule `exclude` had no coverage past the engine. This proves it survives the
  // whole path — JSONC parse → `resolveRule` → `lintFiles` → report — rather than being dropped at
  // the config boundary, where a silent loss would look exactly like a clean repository.
  it("honors a per-rule exclude written in the config file", async () => {
    const table = ["| ID | Owner |", "| --- | --- |", "| REQ-1 |  |"].join(
      "\n",
    );
    const cwd = await fixtureRepo({
      "docs/a.md": table.replace("| REQ-1 |  |", "| REQ-1 | Ann |"),
      "drafts/b.md": table,
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "TBL-002",
            options: { columns: ["Owner"], exclude: ["drafts/**"] },
          },
        ],
      }),
    });

    const result = await run(["lint", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("No problems found.");
    expect(result.stdout).not.toContain("drafts");
  });

  // W-01's user-visible half: the wrong answer was an *exit code*. A negated `exclude` matched every
  // path through the old first-truthy OR, so the corpus was empty, the report said "No problems
  // found." and the command exited 0 on a repository that has a finding — a green CI leg for a
  // one-character config edit. Asserted at the host boundary because that is where the 0 was believed.
  it("exits non-zero when a negated exclude no longer empties the corpus", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[broken](missing.md)\n",
      "docs/private/secret.md": "# Secret\n",
      "wastech-mdlint.config.json": JSON.stringify({
        exclude: ["docs/private/**", "!docs/private/keepme.md"],
        rules: [{ rule: "REF-001" }],
      }),
    });

    const result = await run(["lint", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_FINDINGS);
    expect(result.stdout).toContain("a.md");
    expect(result.stdout).not.toContain("secret.md");
  });

  // @boundary-guard shared-exclude
  // W-02 / P13.02: the zero-config first run must prune the noise trees before it parses them. The
  // *nested* copy is the half an in-repo fixture never had — the field test measured 2740 files
  // under a `mobile/node_modules/` reaching the parser, at exit `0` with zero findings, so the
  // blow-up was silent in every direction. Asserted at the host boundary because that is where a
  // user meets it, and with no config file at all because that is the path being fixed.
  it("prunes node_modules at every depth with no config file (P13.02)", async () => {
    const cwd = await fixtureRepo({
      "docs/a.md": "# A\n",
      "mobile/node_modules/leftpad/README.md": "# leftpad\n",
      "node_modules/rightpad/README.md": "# rightpad\n",
    });

    const result = await run(["lint", cwd, "--format", "json"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    const parsed = JSON.parse(result.stdout) as {
      summary: { files: number };
      files: string[];
    };
    expect(parsed.files).toEqual(["docs/a.md"]);
    expect(parsed.summary.files).toBe(1);
  });

  // W-15 / P14.03, at the boundary where the behavior changed: a zero-config run now reads Markdown
  // under a dot-directory that is not a dependency or build tree, while still pruning the ones that
  // are. The two halves have to be asserted together — dropping `**/.*/**` would be a regression on
  // W-02 if it also re-opened `.venv`, and keeping it was 31% of the field-test target's corpus.
  it("reads a dot-directory but not a hidden dependency tree with no config file", async () => {
    const cwd = await fixtureRepo({
      "docs/a.md": "# A\n",
      ".github/NOTES.md": "# Notes\n",
      ".agents/rules/testing.md": "# Testing\n",
      ".venv/lib/site-packages/pkg/README.md": "# Vendored\n",
      "mobile/node_modules/leftpad/README.md": "# leftpad\n",
    });

    const result = await run(["lint", cwd, "--format", "json"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    const parsed = JSON.parse(result.stdout) as { files: string[] };
    expect(parsed.files).toEqual([
      ".agents/rules/testing.md",
      ".github/NOTES.md",
      "docs/a.md",
    ]);
  });

  it("emits structured JSON with --format json", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[broken](missing.md)\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "REF-001" }],
      }),
    });

    const result = await run(
      ["lint", cwd, "--format", "json", "--fail-on", "off"],
      cwd,
    );
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    const parsed = JSON.parse(result.stdout) as {
      summary: { errors: number };
      messages: unknown[];
    };
    expect(parsed.summary.errors).toBe(1);
    expect(parsed.messages).toHaveLength(1);
  });

  // W-24/W-35: the shape and the message keys `docs/guide/output.md` documents, asserted through the
  // command a consumer actually runs. The guide's table is the contract; this is what pins it.
  it("serializes the documented top-level keys, summary keys, and message keys", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[broken](missing.md)\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "REF-001" }],
      }),
    });

    const result = await run(
      ["lint", cwd, "--format", "json", "--fail-on", "off"],
      cwd,
    );
    const parsed = JSON.parse(result.stdout) as {
      summary: Record<string, unknown>;
      messages: Record<string, unknown>[];
    };

    expect(Object.keys(parsed).sort()).toEqual([
      "files",
      "messages",
      "summary",
    ]);
    // No `pass`/`ok` field — the exit code is that signal, which the guide used to promise here.
    expect(Object.keys(parsed.summary).sort()).toEqual([
      "errors",
      "files",
      "warnings",
    ]);
    // `endLine` and `fixable` are absent on a REF-001 finding: the guide's table marks which keys are
    // always present, and these two are not among them.
    expect(Object.keys(parsed.messages[0]!).sort()).toEqual([
      "column",
      "data",
      "filePath",
      "helpUri",
      "line",
      "message",
      "ruleId",
      "severity",
    ]);
    // `helpUri` resolves to a page rather than restating `ruleId`, which is what it held before.
    expect(parsed.messages[0]!.helpUri).toBe(
      "https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/rules/REF-001.md",
    );
  });

  it("applies --fix in place then reports what remains", async () => {
    const cwd = await fixtureRepo({
      "a.md": ["| ID | Owner |", "| --- | --- |", "| REQ-1 |  |"].join("\n"),
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "TBL-002", options: { columns: ["Owner"] } }],
      }),
    });

    const result = await run(["lint", cwd, "--fix"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("No problems found.");
    const written = await readFile(path.join(cwd, "a.md"), "utf8");
    expect(written).toContain("| REQ-1 | TODO |");
  });

  // Audit L-6 end to end: the CRLF fixture is built at runtime (`.gitattributes` forces `eol=lf` on
  // committed files, so a checked-in CRLF fixture would be silently converted).
  it("keeps a CRLF document's line endings when --fix rewrites it", async () => {
    const crlfDocument = [
      "# Title",
      "",
      "## Intro",
      "",
      "| ID | Owner |",
      "| --- | --- |",
      "| REQ-1 |  |",
      "",
    ].join("\r\n");
    const cwd = await fixtureRepo({
      "a.md": crlfDocument,
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          { rule: "TBL-002", options: { columns: ["Owner"] } },
          { rule: "SEC-001", options: { sections: ["Intro", "Summary"] } },
        ],
      }),
    });

    const result = await run(["lint", cwd, "--fix"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("No problems found.");
    const written = await readFile(path.join(cwd, "a.md"), "utf8");
    expect(written).toContain("| REQ-1 | TODO |");
    expect(written).toContain("## Summary");
    // Both fix hooks ran on the same document, so a single lone LF anywhere means one of them forced
    // its own terminator into the file.
    expect(written.replace(/\r\n/g, "")).not.toContain("\n");
    expect(written).not.toContain("\r\r");
  });

  // P11.10 / audit M-6 + M-7: an operational failure must be distinguishable from findings (exit 2,
  // not 1) and must never print an absolute host path. `not.toContain(cwd)` is the portable form of
  // that second assertion — matching an absolute prefix would be platform-specific.
  it("exits 2 for a nonexistent [path] instead of reporting a clean corpus", async () => {
    const cwd = await fixtureRepo({ "a.md": "# A\n" });

    const result = await run(["lint", "./nope-missing"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stdout).not.toContain("No problems found.");
    expect(result.stderr).toContain("Target path does not exist: nope-missing");
    expect(result.stderr).not.toContain(cwd);
  });

  it("exits 2 when [path] is a file rather than a directory", async () => {
    const cwd = await fixtureRepo({ "a.md": "# A\n" });

    const result = await run(["lint", "a.md"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stdout).not.toContain("No problems found.");
    expect(result.stderr).toContain("Target path is not a directory: a.md");
    expect(result.stderr).not.toContain(cwd);
  });

  it("resolves a relative [path] against the injected cwd, not process.cwd()", async () => {
    const cwd = await fixtureRepo({
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "REF-001" }],
      }),
    });
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(
      path.join(cwd, "docs", "a.md"),
      "[broken](missing.md)\n",
      "utf8",
    );
    // A sibling that must stay out of the report, proving the corpus really was narrowed to `docs`.
    await writeFile(path.join(cwd, "outside.md"), "[gone](nope.md)\n", "utf8");

    // The generated CI workflow emits exactly this shape (`lint 'docs' --config …`), so a relative
    // argument silently resolving against the server/runner process cwd would break real jobs.
    const result = await run(["lint", "docs"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_FINDINGS);
    expect(result.stdout).toContain("a.md");
    expect(result.stdout).not.toContain("outside.md");
  });

  it("exits 2 with a repo-relative path when --config points at a missing file", async () => {
    const cwd = await fixtureRepo({ "a.md": "# A\n" });

    const result = await run(
      ["lint", cwd, "--config", path.join(cwd, "missing.json")],
      cwd,
    );
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain("Config file not found: missing.json");
    expect(result.stderr).not.toContain(cwd);
  });

  it("maps config errors to exit 2 with a did-you-mean diagnostic", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "REF-999" }],
      }),
    });

    const result = await run(["lint", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toMatch(
      /Unknown rule "REF-999"\. Did you mean "REF-001"\?/,
    );
  });

  it("prints a severity typo as the config file plus the offending key (P13.06)", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "REF-001", severity: "warn" }],
      }),
    });

    // The likeliest first-time typo used to reach the user as `config.rules.0: Invalid input`. What
    // the CLI actually writes to stderr is the contract, so assert it at the host boundary too.
    const result = await run(["lint", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain(
      "Invalid config at wastech-mdlint.config.json:",
    );
    expect(result.stderr).toContain("config.rules[0].severity");
    expect(result.stderr).toMatch(/error.*warning.*off/);
  });
});

describe("schema command", () => {
  it("writes a local schema file with no remote URL", async () => {
    const cwd = await fixtureRepo({});
    const outPath = path.join(cwd, "schema.json");

    const result = await run(["schema", "--out", outPath], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const written = await readFile(outPath, "utf8");
    expect(written).not.toMatch(/raw\.githubusercontent|https:\/\/github/);
    expect(JSON.parse(written)).toHaveProperty(
      "title",
      "wastech-mdlint configuration",
    );
  });

  // Audit L-11: a relative `--out` used to resolve against the real `process.cwd()`, so a run with
  // an injected cwd wrote the schema into whatever directory the process happened to start in —
  // the class of bug `handleCompile` already fixed for `--outdir`.
  it("resolves a relative --out against the run's cwd, not process.cwd()", async () => {
    const cwd = await fixtureRepo({});

    const result = await run(["schema", "--out", "generated/schema.json"], cwd);

    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    // Echoed as typed (the documented `--out` contract), but written under the injected cwd.
    expect(result.stdout).toContain("schema written to generated/schema.json");
    await expect(
      readFile(path.join(cwd, "generated", "schema.json"), "utf8"),
    ).resolves.toContain("wastech-mdlint configuration");
    // Nothing landed beside the process's own working directory.
    await expect(
      readFile(path.resolve("generated/schema.json"), "utf8"),
    ).rejects.toThrow();
  });

  // Root ignores directory permissions and Windows has no equivalent model, so the fault this relies
  // on only exists for an unprivileged POSIX user (same precondition as init's staging-failure test).
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "exits 2 echoing --out as typed when the write fails",
    async () => {
      const cwd = await fixtureRepo({});
      // Absolute here so the assertion below can pin the exact string `--out` echoes back; the
      // relative form is covered by its own test above.
      const outPath = path.join(cwd, "schema.json");
      // `r-x`: the directory is readable, but no new file can be created in it, so the atomic write's
      // temp file fails. That is an operational failure (exit 2), not a crash.
      await chmod(cwd, 0o555);

      try {
        const result = await run(["schema", "--out", outPath], cwd);
        expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
        // `--out` is echoed back exactly as typed, the same contract as the `schema written to …`
        // success line and the directory-path guard above it — the documented exception to naming
        // paths relative to the working directory (docs/guide/cli.md §Exit codes), since the tool
        // must not silently rewrite an argument the caller chose to spell absolutely.
        expect(result.stderr).toContain(`Could not write ${outPath} (EACCES).`);
        // What the guard is actually for: none of the raw fs message survives — neither its own
        // absolute path phrasing nor the staged temp file's random name, which means nothing to the
        // user.
        expect(result.stderr).not.toContain("permission denied");
        expect(result.stderr).not.toContain(".tmp");
      } finally {
        // Without this the shared afterEach `rm(..., { recursive: true })` fails with EACCES.
        await chmod(cwd, 0o755);
      }
    },
  );
});
