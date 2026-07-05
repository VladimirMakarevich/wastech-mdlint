import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODE_SUCCESS, EXIT_CODE_USAGE_ERROR } from "../src/commands.js";
import { runCli } from "../src/program.js";

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
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(path.join(root, relativePath), content, "utf8");
  }
  return root;
}

async function run(argv: string[], cwd: string) {
  const stdout = createMemoryWriter();
  const stderr = createMemoryWriter();
  const exitCode = await runCli(argv, { cwd, stdout: stdout.stream, stderr: stderr.stream });
  return { exitCode, stdout: stdout.read(), stderr: stderr.read() };
}

describe("command dispatch", () => {
  it("runs lint as the default command on the injected cwd (D4)", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[broken](missing.md)\n",
      "wastech-mdlint.config.json": JSON.stringify({ rules: [{ rule: "REF-001" }] })
    });

    const result = await run([], cwd);
    expect(result.stdout).toContain("REF-001");
  });

  it("treats scan as a hidden alias of lint", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[broken](missing.md)\n",
      "wastech-mdlint.config.json": JSON.stringify({ rules: [{ rule: "REF-001" }] })
    });

    const asLint = await run(["lint", cwd], cwd);
    const asScan = await run(["scan", cwd], cwd);
    expect(asScan.stdout).toBe(asLint.stdout);
    expect(asScan.exitCode).toBe(asLint.exitCode);
  });

  it("hides the scan alias from --help but still lists lint", async () => {
    const cwd = await fixtureRepo({});
    const help = await run(["--help"], cwd);
    expect(help.stdout).toContain("lint");
    expect(help.stdout).not.toContain("scan");
  });
});

describe("version and errors", () => {
  it("prints the version with -v", async () => {
    const cwd = await fixtureRepo({});
    const result = await run(["-v"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("returns a usage error (exit 2) for an unknown option", async () => {
    // With lint as the default command, a bare positional becomes the lint [path]; an unknown
    // *option* is still a commander parse error → exit 2.
    const cwd = await fixtureRepo({});
    const result = await run(["lint", cwd, "--bogus"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
  });

  it("returns a usage error for an invalid --format choice", async () => {
    const cwd = await fixtureRepo({});
    const result = await run(["lint", cwd, "--format", "xml"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
  });
});

describe("graph command", () => {
  it("prints { nodes, edges, components, readingOrder } as JSON to stdout", async () => {
    const cwd = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });

    const result = await run(["graph", cwd, "--format", "json"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(result.stdout) as {
      nodes: { path: string }[];
      edges: { from: string; to: string }[];
      components: string[][];
      readingOrder: string[];
    };
    expect(payload.nodes.map((node) => node.path)).toEqual(["a.md", "b.md"]);
    expect(payload.edges).toEqual([expect.objectContaining({ from: "a.md", to: "b.md" })]);
    expect(payload.components).toEqual([["a.md", "b.md"]]);
    expect(payload.readingOrder).toEqual(["a.md", "b.md"]);
  });

  it("defaults to human format with clusters, hubs, reading order, and the coverage signal", async () => {
    const cwd = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });

    const result = await run(["graph", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("top hubs:");
    expect(result.stdout).toContain("clusters:");
    expect(result.stdout).toContain("reading order (2): a.md, b.md");
    expect(result.stdout).toContain("coverage:");
  });

  it("renders a Mermaid flowchart", async () => {
    const cwd = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });

    const result = await run(["graph", cwd, "--format", "mermaid"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("flowchart TD");
    expect(result.stdout).toContain('"a.md"');
    expect(result.stdout).toContain('"b.md"');
  });

  it("renders a DOT digraph", async () => {
    const cwd = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });

    const result = await run(["graph", cwd, "--format", "dot"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("digraph ContextGraph {");
  });

  it("rejects an unknown --format choice (exit 2)", async () => {
    const cwd = await fixtureRepo({});

    const result = await run(["graph", cwd, "--format", "xml"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
  });
});

describe("slice command", () => {
  it("resolves a path query and lists files within --depth hops (json)", async () => {
    const cwd = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "[c](c.md)\n", "c.md": "# C\n" });

    const result = await run(["slice", "a.md", "--depth", "1", "--format", "json"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(result.stdout) as { matchKind: string; files: string[] };
    expect(payload.matchKind).toBe("path");
    expect(payload.files).toEqual(["a.md", "b.md"]);
  });

  it("resolves a path query in human format", async () => {
    const cwd = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });

    const result = await run(["slice", "a.md"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("files (2):");
    expect(result.stdout).toContain("a.md");
    expect(result.stdout).toContain("b.md");
  });

  it("returns an honest empty result for an unresolved query (exit 0)", async () => {
    const cwd = await fixtureRepo({ "a.md": "# A\n" });

    const result = await run(["slice", "does-not-exist", "--format", "json"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(result.stdout) as { matchKind: string | null; starts: string[]; files: string[] };
    expect(payload).toMatchObject({ matchKind: null, starts: [], files: [] });
  });

  it("advertises the honest resolution semantics in --help", async () => {
    const cwd = await fixtureRepo({});

    const result = await run(["slice", "--help"], cwd);
    // Commander word-wraps the description, so compare against whitespace-collapsed text rather
    // than risking a false negative on wherever the wrap happens to fall.
    expect(result.stdout.replace(/\s+/g, " ")).toContain("no fuzzy, substring, keyword, or LLM matching");
  });

  it("rejects a non-integer --depth as a usage error (exit 2)", async () => {
    const cwd = await fixtureRepo({ "a.md": "# A\n" });

    const result = await run(["slice", "a.md", "--depth", "1.5"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
  });
});

describe("impact command", () => {
  it("reports the directly affected file and scopes the lint field to the affected subgraph", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# A\n",
      "b.md": "[a](a.md)\n[broken](missing.md)\n",
      "c.md": "[broken](missing2.md)\n",
      "wastech-mdlint.config.json": JSON.stringify({ rules: [{ rule: "REF-001" }] })
    });

    const result = await run(["impact", "a.md", "--format", "json"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(result.stdout) as {
      changedFile: string;
      directlyAffected: { path: string; references: number }[];
      transitivelyAffected: unknown[];
      readingOrder: string[];
      excluded: string[];
      lint: { files: string[]; messages: { filePath: string; ruleId: string }[] };
    };
    expect(Object.keys(payload).sort()).toEqual(
      ["changedFile", "directlyAffected", "transitivelyAffected", "readingOrder", "excluded", "lint"].sort()
    );
    expect(payload.changedFile).toBe("a.md");
    expect(payload.directlyAffected).toEqual([{ path: "b.md", references: 1 }]);
    expect(payload.transitivelyAffected).toEqual([]);
    expect(payload.readingOrder).toEqual(["b.md", "a.md"]);
    // No cycle in this corpus, so nothing is excluded from reading order (audit C parity field).
    expect(payload.excluded).toEqual([]);
    // The corpus-wide lint also flags c.md's broken link, but c.md is outside the affected subgraph.
    expect(payload.lint.files).toEqual(["a.md", "b.md"]);
    expect(payload.lint.messages.some((message) => message.filePath === "c.md")).toBe(false);
    expect(
      payload.lint.messages.some((message) => message.filePath === "b.md" && message.ruleId === "REF-001")
    ).toBe(true);
  });

  it("renders a human summary followed by the scoped lint report", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# A\n",
      "b.md": "[a](a.md)\n"
    });

    const result = await run(["impact", "a.md"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("changed file: a.md");
    expect(result.stdout).toContain("directly affected (1):");
    expect(result.stdout).toContain("No problems found.");
  });

  it("exits 2 with the out-of-corpus hint for an unknown file", async () => {
    const cwd = await fixtureRepo({ "a.md": "# A\n" });

    const result = await run(["impact", "zzz.md"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toContain("must be repository-relative POSIX");
  });
});
