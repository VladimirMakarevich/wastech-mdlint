import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXIT_CODE_FINDINGS,
  EXIT_CODE_SUCCESS,
  EXIT_CODE_USAGE_ERROR,
} from "../src/commands.js";
import { runCli } from "../src/program.js";

/**
 * `--config` has one resolution base across every handler that accepts it: a relative
 * path is resolved against the directory the command analyzes, never the shell the process was
 * launched from.
 *
 * Every case here injects an `io.cwd` that differs from the real `process.cwd()` (the repo root),
 * which is the only shape in which the two bases can be told apart. Four of the five rows below were
 * red before the change; `compile` is the control that a local workaround had already made correct.
 */

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
    path.join(os.tmpdir(), "wastech-mdlint-config-base-"),
  );
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
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

// `--help` writes through commander's own output hooks, so both streams are captured together.
async function help(args: string[]): Promise<string> {
  const sink = createMemoryWriter();
  await runCli(args, { stdout: sink.stream, stderr: sink.stream });
  return sink.read();
}

/**
 * The CLI commands that advertise `--config <file>`, derived from the live program rather than
 * hand-listed.
 *
 * That derivation is the point: the finding this task closes was an inconsistency *across* call
 * sites, so a table someone maintains by hand would keep passing when a sixth command grows the flag
 * and resolves it somewhere else. Root help lists each command name at a two-space indent (its
 * wrapped description continues at a much deeper one), and commander renders every option as
 * `--config <file>` in the command's own help.
 *
 * The hidden `scan` alias is deliberately absent — it is not in root help, and it is registered by
 * the same `addLintCommand` builder and dispatches to `handleLint`, so `lint`'s row covers it.
 */
async function commandsAcceptingConfig(): Promise<string[]> {
  const rootHelp = await help(["--help"]);
  const commandsBlock = rootHelp.slice(rootHelp.indexOf("Commands:"));
  const names = [...commandsBlock.matchAll(/^ {2}(\S+)/gm)].map(
    (match) => match[1] as string,
  );
  expect(names.length).toBeGreaterThan(0);

  const accepting: string[] = [];
  for (const name of names) {
    if ((await help([name, "--help"])).includes("--config <file>")) {
      accepting.push(name);
    }
  }
  return accepting.sort();
}

// A config with no rules (every row must exit `0` on the merits) and a `compile` section, so the
// `compile` row has something to generate. It lives at `proj/cfg.json` and nowhere else, so a lookup
// against any base but the analyzed directory misses it.
const CONFIG = JSON.stringify({
  compile: { skill: { name: "docs-skill", description: "Docs skill" } },
});

type Row = { command: string; argv: string[]; cwdSuffix: string };

// `cwdSuffix` is the injected cwd relative to the fixture root: `lint`/`graph` take the analyzed
// directory as `[path]`, `compile` as `--cwd`, while `slice`/`impact` have no such argument and
// analyze the CLI's own cwd — so for those two the caller has to stand inside `proj` instead.
const ROWS: Row[] = [
  {
    command: "lint",
    argv: ["lint", "proj", "--config", "cfg.json"],
    cwdSuffix: "",
  },
  {
    command: "graph",
    argv: ["graph", "proj", "--config", "cfg.json"],
    cwdSuffix: "",
  },
  {
    command: "slice",
    argv: ["slice", "a.md", "--config", "cfg.json"],
    cwdSuffix: "proj",
  },
  {
    command: "impact",
    argv: ["impact", "a.md", "--config", "cfg.json"],
    cwdSuffix: "proj",
  },
  {
    command: "compile",
    argv: ["compile", "--cwd", "proj", "--config", "cfg.json", "--dry-run"],
    cwdSuffix: "",
  },
];

describe("--config resolution base", () => {
  it("covers exactly the commands that accept --config", async () => {
    expect(await commandsAcceptingConfig()).toEqual(
      ROWS.map((row) => row.command).sort(),
    );
  });

  it.each(ROWS)(
    "$command resolves a relative --config against the analyzed directory",
    async ({ argv, cwdSuffix }) => {
      const root = await fixtureRepo({
        "proj/cfg.json": CONFIG,
        "proj/a.md": "# A\n",
      });

      const result = await run(argv, path.join(root, cwdSuffix));

      expect(result.stderr).not.toContain("Config file not found");
      expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    },
  );

  it("loads — not merely finds — the config named relative to [path]", async () => {
    // The reproduced case from the finding, strengthened: a `--config` that resolved but was not
    // applied would still exit `0` here, so the assertion is that the config's own rule fired.
    const root = await fixtureRepo({
      "proj/cfg.json": JSON.stringify({ rules: [{ rule: "REF-001" }] }),
      "proj/a.md": "[broken](missing.md)\n",
    });

    const result = await run(["lint", "proj", "--config", "cfg.json"], root);

    expect(result.exitCode).toBe(EXIT_CODE_FINDINGS);
    expect(result.stdout).toContain("REF-001");
  });

  it("names a missing relative --config exactly as typed", async () => {
    const root = await fixtureRepo({ "proj/a.md": "# A\n" });

    const result = await run(["lint", "proj", "--config", "nope.json"], root);

    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    // Resolution and rendering share the analyzed directory, so the message quotes the argument
    // back. While they disagreed this read `Config file not found: ../nope.json`.
    expect(result.stderr).toContain("Config file not found: nope.json");
    expect(result.stderr).not.toContain("../");
  });
});
