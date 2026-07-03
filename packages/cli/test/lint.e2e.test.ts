import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODE_RUNTIME_ERROR, EXIT_CODE_SUCCESS, EXIT_CODE_USAGE_ERROR } from "../src/commands.js";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-lint-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(path.join(root, relativePath), content, "utf8");
  }
  return root;
}

async function run(args: string[], cwd: string) {
  const stdout = createMemoryWriter();
  const stderr = createMemoryWriter();
  const exitCode = await runCli(args, { cwd, stdout: stdout.stream, stderr: stderr.stream });
  return { exitCode, stdout: stdout.read(), stderr: stderr.read() };
}

describe("lint command", () => {
  it("reports findings and exits 1 under the default fail-on error", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[broken](missing.md)\n",
      "wastech-mdlint.config.json": JSON.stringify({ rules: [{ rule: "REF-001" }] })
    });

    const result = await run(["lint", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_RUNTIME_ERROR);
    expect(result.stdout).toContain("REF-001");
    expect(result.stdout).toContain("missing.md");
  });

  it("passes cleanly (exit 0) when no rules fire", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[ok](b.md)\n",
      "b.md": "# B\n",
      "wastech-mdlint.config.json": JSON.stringify({ rules: [{ rule: "REF-001" }] })
    });

    const result = await run(["lint", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("No problems found.");
  });

  it("emits structured JSON with --format json", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[broken](missing.md)\n",
      "wastech-mdlint.config.json": JSON.stringify({ rules: [{ rule: "REF-001" }] })
    });

    const result = await run(["lint", cwd, "--format", "json", "--fail-on", "off"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    const parsed = JSON.parse(result.stdout) as { summary: { errors: number }; messages: unknown[] };
    expect(parsed.summary.errors).toBe(1);
    expect(parsed.messages).toHaveLength(1);
  });

  it("applies --fix in place then reports what remains", async () => {
    const cwd = await fixtureRepo({
      "a.md": ["| ID | Owner |", "| --- | --- |", "| REQ-1 |  |"].join("\n"),
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "TBL-002", options: { columns: ["Owner"] } }]
      })
    });

    const result = await run(["lint", cwd, "--fix"], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(result.stdout).toContain("No problems found.");
    const written = await readFile(path.join(cwd, "a.md"), "utf8");
    expect(written).toContain("| REQ-1 | TODO |");
  });

  it("maps config errors to exit 2 with a did-you-mean diagnostic", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({ rules: [{ rule: "REF-999" }] })
    });

    const result = await run(["lint", cwd], cwd);
    expect(result.exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(result.stderr).toMatch(/Unknown rule "REF-999"\. Did you mean "REF-001"\?/);
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
    expect(JSON.parse(written)).toHaveProperty("title", "wastech-mdlint configuration");
  });
});
