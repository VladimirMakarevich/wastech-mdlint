import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  it("writes a context graph JSON file", async () => {
    const cwd = await fixtureRepo({ "a.md": "[b](b.md)\n", "b.md": "# B\n" });
    const outputPath = path.join(cwd, "graph.json");

    const result = await run(["graph", cwd, "--out", outputPath], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);

    const payload = JSON.parse(await readFile(outputPath, "utf8")) as {
      graph: { nodes: { path: string }[]; edges: { from: string; to: string }[]; cycles: unknown[] };
    };
    expect(payload.graph.nodes.map((node) => node.path).sort()).toEqual(["a.md", "b.md"]);
    expect(payload.graph.edges).toEqual([expect.objectContaining({ from: "a.md", to: "b.md" })]);
    expect(payload.graph.cycles).toEqual([]);
  });
});
