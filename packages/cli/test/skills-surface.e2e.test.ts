import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODE_SUCCESS } from "../src/commands.js";
import { runCli } from "../src/program.js";

// Drift guard (deliverable 3, CLI half): every CLI command and flag the shipped skills instruct users
// to run must still exist in the real program. A renamed/removed command makes `--help` exit 2 here;
// a renamed flag makes the flag assertion fail — either way CI catches skill-vs-product drift.
const skillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../skills");

function readSkill(id: string): string {
  return readFileSync(path.join(skillsDir, id, "SKILL.md"), "utf8");
}

const fixSkill = readSkill("wastech-mdlint-fix");
const impactSkill = readSkill("wastech-mdlint-impact");
const skillBodies = [fixSkill, impactSkill, readSkill("wastech-mdlint-init")];
const allSkillText = skillBodies.join("\n");

function referencedInAnySkill(needle: string): boolean {
  return skillBodies.some((body) => body.includes(needle));
}

// Extract the CLI invocations the skills actually document — every `[npx] wastech-mdlint <cmd> …` run,
// capturing the command and the flags on the same invocation (up to a line break or the closing
// backtick of an inline code span). Deriving the surface from the skill text — rather than trusting a
// hand-kept list — is what makes this an honest drift guard: a skill that adds/renames a CLI command
// reference, or moves a flag onto a different command, changes this parse and fails the match below.
function parseCliInvocations(): Map<string, Set<string>> {
  const invocations = new Map<string, Set<string>>();
  // Anchor on a package runner (`npx`/`pnpm exec`/`yarn`/`bunx`) so prose mentions like
  // "wastech-mdlint findings" are not mistaken for command invocations — only real run lines count.
  const pattern = /(?:npx|exec|yarn|bunx) wastech-mdlint (\w[\w-]*)([^\n`]*)/g;
  for (const match of allSkillText.matchAll(pattern)) {
    const command = match[1]!;
    const flags = match[2]!.match(/--[a-z][a-z-]+/g) ?? [];
    const seen = invocations.get(command) ?? new Set<string>();
    for (const flag of flags) {
      seen.add(flag);
    }
    invocations.set(command, seen);
  }
  return invocations;
}

async function help(command: string): Promise<{ exitCode: number; text: string }> {
  let text = "";
  const sink = {
    write(chunk: string) {
      text += chunk;
      return true;
    }
  };
  const exitCode = await runCli([command, "--help"], { stdout: sink, stderr: sink });
  return { exitCode, text };
}

// Each command mapped to the flags AND the concrete choice values the skills instruct users to pass.
// Each choice carries an `evidence` regex that proves the value is documented *for this command* in
// the skill text (an invocation of that command carrying the value, or the command's own prose), so
// the check is command-scoped rather than a repo-wide "value appears somewhere" match. Values are also
// asserted against the live `--help` surface (commander advertises `.choices()` as quoted strings), so
// dropping `--fail-on off` or `--format dot` on the CLI, or the skill ceasing to document it for that
// command, fails here even though the option name survives.
interface Choice {
  value: string;
  evidence: RegExp;
}
const COMMANDS: { command: string; usage: string; flags: string[]; choices: Choice[] }[] = [
  {
    command: "init",
    usage: "wastech-mdlint init",
    flags: ["--yes", "--on-existing", "--with-ci-workflow"],
    // The init skill documents `--on-existing <overwrite|merge|skip>`; each value must sit in that list.
    choices: [
      { value: "overwrite", evidence: /--on-existing <[^>]*\boverwrite\b/ },
      { value: "merge", evidence: /--on-existing <[^>]*\bmerge\b/ },
      { value: "skip", evidence: /--on-existing <[^>]*\bskip\b/ }
    ]
  },
  {
    command: "lint",
    usage: "wastech-mdlint lint",
    flags: ["--fix", "--fail-on", "--format", "--config"],
    // The fix skill runs `lint … --format json --fail-on off` and contrasts the `--fail-on error` default.
    choices: [
      { value: "json", evidence: /wastech-mdlint lint[^\n`]*--format json/ },
      { value: "off", evidence: /--fail-on off/ },
      { value: "error", evidence: /--fail-on error/ }
    ]
  },
  {
    command: "impact",
    usage: "wastech-mdlint impact",
    flags: ["--format"],
    choices: [{ value: "json", evidence: /wastech-mdlint impact[^\n`]*--format json/ }]
  },
  {
    command: "slice",
    usage: "wastech-mdlint slice",
    flags: ["--format"],
    choices: [{ value: "json", evidence: /wastech-mdlint slice[^\n`]*--format json/ }]
  },
  {
    command: "graph",
    usage: "wastech-mdlint graph",
    flags: ["--format"],
    // The impact skill lists `graph`'s non-default renders in one clause: `--format json|mermaid|dot`.
    // `json` is tied to `graph` by proximity; `mermaid`/`dot` appear only in that clause.
    choices: [
      { value: "json", evidence: /wastech-mdlint graph[\s\S]{0,160}--format json/ },
      { value: "mermaid", evidence: /--format mermaid/ },
      { value: "dot", evidence: /--format dot/ }
    ]
  }
];

describe("skills reference a live CLI surface", () => {
  // Before the live `--help` checks, prove the hand-kept matrix still mirrors what the skills actually
  // document. If a skill invocation adds/renames a command or moves a flag onto a different command,
  // the derived parse diverges from COMMANDS and this fails — closing the "stale matrix" gap.
  it("COMMANDS matches the CLI invocations documented in the skills", () => {
    const parsed = parseCliInvocations();

    expect([...parsed.keys()].sort()).toEqual(COMMANDS.map((c) => c.command).sort());

    for (const { command, flags } of COMMANDS) {
      const documentedFlags = [...(parsed.get(command) ?? new Set<string>())].sort();
      // Every flag the skills attach to this command's invocations must be declared for it in the
      // matrix (the matrix may list extra flags documented only in prose, e.g. `--config`).
      for (const flag of documentedFlags) {
        expect(flags, `${command} invocation uses ${flag}, absent from its matrix flags`).toContain(flag);
      }
    }
  });

  it("validates every referenced CLI flag against a specific owning command's help", async () => {
    // Completeness guard, made command-aware: invocation-line parsing alone misses flags mentioned only
    // in prose (e.g. the init skill discusses `lint`'s `--config` in a sentence). For EVERY `--flag`
    // token anywhere in the skills, require the matrix to name the owning command(s) and then verify the
    // flag against THAT command's live `--help` — never against a repo-wide flag set, so a prose flag
    // cannot pass just because some unrelated command happens to expose it.
    //
    // Flags that are real skill references but not `wastech-mdlint` subcommand options:
    //  - `--version` is the root flag, verified in its own test below;
    //  - `--pin` belongs to the `gh skill install` example, not this CLI.
    const nonCommandFlags = new Set(["--version", "--pin"]);

    const referencedFlags = new Set([...allSkillText.matchAll(/--[a-z][a-z-]+/g)].map((m) => m[0]));
    for (const flag of referencedFlags) {
      if (nonCommandFlags.has(flag)) {
        continue;
      }
      const owners = COMMANDS.filter((c) => c.flags.includes(flag));
      expect(owners.length, `skill references ${flag} but no command matrix owns it`).toBeGreaterThan(0);
      for (const owner of owners) {
        const { text } = await help(owner.command);
        expect(text, `${owner.command} --help is missing referenced flag ${flag}`).toContain(flag);
      }
    }
  });

  it.each(COMMANDS)(
    "$command is referenced and exposes its documented flags and choices",
    async ({ command, usage, flags, choices }) => {
      expect(referencedInAnySkill(usage)).toBe(true);

      const { exitCode, text } = await help(command);
      // --help resolves to exit 0; an unknown/renamed command would surface as usage error 2.
      expect(exitCode).toBe(EXIT_CODE_SUCCESS);

      for (const flag of flags) {
        expect(referencedInAnySkill(flag)).toBe(true);
        expect(text).toContain(flag);
      }

      for (const { value, evidence } of choices) {
        // Command-scoped: the value must be documented for THIS command (not merely appear somewhere),
        // and commander must still advertise it as a quoted choice in this command's help.
        expect(evidence.test(allSkillText), `${command} choice ${value} not documented for it`).toBe(true);
        expect(text).toContain(`"${value}"`);
      }
    }
  );

  it("supports the root --version flag the fix skill documents", async () => {
    expect(referencedInAnySkill("--version")).toBe(true);
    let text = "";
    const sink = {
      write(chunk: string) {
        text += chunk;
        return true;
      }
    };
    // `--version` resolves inside commander with exit 0 (never the usage-error path) and prints a
    // version string; a removed root version flag would surface as usage error 2.
    const exitCode = await runCli(["--version"], { stdout: sink, stderr: sink });
    expect(exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(text.trim()).not.toBe("");
  });
});

// Deliverable 3 goes beyond `--help`: the skills tell agents to consume the CLI's `--format json`
// payloads by specific key. A guard that only checks help text would not fail if those payload keys
// drifted, so run each documented JSON command against a tiny fixture repo and assert every
// skill-mentioned field exists on BOTH sides — documented in the skill AND present in the real payload.
describe("skills reference the real CLI JSON contract", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  // `a.md` references `b.md` (a graph edge, so impact/slice resolve a non-empty neighborhood) and also
  // carries a broken link so `lint` emits at least one REF-001 message to exercise message fields.
  async function fixtureRepo(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-skills-"));
    tempDirs.push(root);
    await writeFile(path.join(root, "a.md"), "# A\n\n[to b](b.md)\n[broken](missing.md)\n", "utf8");
    await writeFile(path.join(root, "b.md"), "# B\n", "utf8");
    await writeFile(
      path.join(root, "wastech-mdlint.config.json"),
      JSON.stringify({ rules: [{ rule: "REF-001" }] }),
      "utf8"
    );
    return root;
  }

  async function runJson(argv: string[], cwd: string): Promise<Record<string, unknown>> {
    let text = "";
    const sink = {
      write(chunk: string) {
        text += chunk;
        return true;
      }
    };
    const exitCode = await runCli(argv, { cwd, stdout: sink, stderr: sink });
    expect(exitCode, `${argv.join(" ")} failed: ${text}`).toBe(EXIT_CODE_SUCCESS);
    return JSON.parse(text) as Record<string, unknown>;
  }

  // Assert a skill documents each field (by name) and the live payload actually carries it.
  function expectContract(skill: string, payload: Record<string, unknown>, fields: string[]): void {
    for (const field of fields) {
      expect(skill, `skill no longer documents field '${field}'`).toContain(field);
      expect(payload, `CLI payload missing field '${field}'`).toHaveProperty(field);
    }
  }

  it("lint --format json emits the summary/messages/files shape the fix skill reads", async () => {
    const cwd = await fixtureRepo();
    const payload = await runJson(["lint", cwd, "--format", "json", "--fail-on", "off"], cwd);

    expectContract(fixSkill, payload, ["summary", "messages", "files"]);
    expectContract(fixSkill, payload.summary as Record<string, unknown>, ["files", "errors", "warnings"]);

    const messages = payload.messages as Record<string, unknown>[];
    expect(messages.length, "fixture should surface at least one REF-001 message").toBeGreaterThan(0);
    // The fix skill groups by `ruleId` and reports `severity`/`filePath` per message.
    expectContract(fixSkill, messages[0]!, ["ruleId", "severity", "filePath"]);
  });

  it("slice --format json emits the matchKind/starts/files/visited shape the impact skill reads", async () => {
    const cwd = await fixtureRepo();
    const payload = await runJson(["slice", "b.md", "--format", "json"], cwd);

    expectContract(impactSkill, payload, ["query", "matchKind", "starts", "files", "visited"]);
    // The skill instructs reading the resolved target from `starts` (not `files`).
    expect(payload.starts).toContain("b.md");
  });

  it("impact --format json emits the field set the impact skill's table enumerates", async () => {
    const cwd = await fixtureRepo();
    const payload = await runJson(["impact", "b.md", "--format", "json"], cwd);

    expectContract(impactSkill, payload, [
      "changedFile",
      "directlyAffected",
      "transitivelyAffected",
      "readingOrder",
      "excluded",
      "lint"
    ]);
    expect(payload.changedFile).toBe("b.md");

    const directly = payload.directlyAffected as Record<string, unknown>[];
    expect(directly.length, "a.md directly references b.md").toBeGreaterThan(0);
    // The skill presents each directly-affected entry as `{ path, references }`.
    expectContract(impactSkill, directly[0]!, ["path", "references"]);
  });
});
