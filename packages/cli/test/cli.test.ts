import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EXIT_CODE_RUNTIME_ERROR,
  EXIT_CODE_SUCCESS,
  EXIT_CODE_USAGE_ERROR,
  executeCommand,
  resolveScanExitCode
} from "../src/commands.js";
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
  await Promise.all(
    tempDirs.splice(0).map(async (tempDir) => {
      const fs = await import("node:fs/promises");
      await fs.rm(tempDir, { recursive: true, force: true });
    })
  );
});

describe("argument parsing", () => {
  it("scans the injected cwd when no path argument is given", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-"));
    tempDirs.push(tempDir);
    await writeFile(path.join(tempDir, "README.md"), "# Root\n", "utf8");

    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const exitCode = await runCli(["scan"], {
      cwd: tempDir,
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(stdout.read()).toContain(`Root: ${tempDir}`);
    expect(stderr.read()).toBe("");
  });

  it("writes the graph for the injected cwd when no path argument is given", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-"));
    tempDirs.push(tempDir);
    await writeFile(path.join(tempDir, "README.md"), "# Root\n", "utf8");
    const outFile = path.join(tempDir, "graph.json");

    const exitCode = await runCli(["graph", "--out", outFile], {
      cwd: tempDir,
      stdout: { write: () => true },
      stderr: { write: () => true }
    });

    expect(exitCode).toBe(EXIT_CODE_SUCCESS);
    const graphJson = JSON.parse(await readFile(outFile, "utf8")) as { root: string };
    expect(graphJson.root).toBe(tempDir);
  });

  it("rejects invalid --format values with a usage error", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const exitCode = await runCli(["scan", "--format", "yaml"], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(stdout.read()).toBe("");
  });

  it("rejects invalid --fail-on values with a usage error", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const exitCode = await runCli(["scan", "--fail-on", "fatal"], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(stdout.read()).toBe("");
  });

  it("requires --out for graph", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const exitCode = await runCli(["graph"], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(stdout.read()).toBe("");
  });
});

describe("CLI smoke", () => {
  it("prints help", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const exitCode = await runCli(["--help"], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(stdout.read()).toContain("scan");
    expect(stdout.read()).toContain("graph");
    expect(stderr.read()).toBe("");
  });

  it("prints version", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const exitCode = await runCli(["--version"], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(stdout.read()).toBe("0.0.0\n");
    expect(stderr.read()).toBe("");
  });

  it("returns a usage error for an invalid config file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-"));
    tempDirs.push(tempDir);
    const configPath = path.join(tempDir, "wastech-mdlint.config.json");
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    await writeFile(configPath, JSON.stringify({ links: { checkExternal: "false" } }), "utf8");

    const exitCode = await runCli(["scan", tempDir], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toContain("Invalid config:");
  });

  it("returns a usage error for an unknown command", async () => {
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    const exitCode = await runCli(["unknown"], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(stdout.read()).toBe("");
  });

  it("writes the graph file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-"));
    tempDirs.push(tempDir);
    const outFile = path.join(tempDir, "nested", "graph.json");
    await writeFile(path.join(tempDir, "README.md"), "# Root\n", "utf8");

    const output = await executeCommand({
      kind: "graph",
      path: tempDir,
      out: outFile
    });

    const graphJson = await readFile(outFile, "utf8");

    expect(output).toEqual({
      output: `graph written to ${outFile}\n`,
      exitCode: EXIT_CODE_SUCCESS
    });
    expect(graphJson).toBe(
      `{\n  "root": "${tempDir.replaceAll("\\", "\\\\")}",\n  "configPath": null,\n  "graph": {\n    "nodes": [\n      {\n        "path": "README.md",\n        "bytes": 7\n      }\n    ],\n    "edges": []\n  }\n}\n`
    );
  });

  it("refuses to overwrite a directory path for graph output", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-"));
    tempDirs.push(tempDir);
    const outDir = path.join(tempDir, "output-dir");
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    await writeFile(path.join(tempDir, "README.md"), "# Root\n", "utf8");
    await (await import("node:fs/promises")).mkdir(outDir, { recursive: true });

    const exitCode = await runCli(["graph", tempDir, "--out", outDir], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_USAGE_ERROR);
    expect(stdout.read()).toBe("");
    expect(stderr.read()).toContain("Cannot write graph output to directory path:");
  });

  it("includes llm budgets in json scan output", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-"));
    tempDirs.push(tempDir);

    await writeFile(path.join(tempDir, "CLAUDE.md"), "@docs/context.md\n", "utf8");
    await (await import("node:fs/promises")).mkdir(path.join(tempDir, "docs"), { recursive: true });
    await writeFile(path.join(tempDir, "docs", "context.md"), "abcdefgh", "utf8");
    await writeFile(
      path.join(tempDir, "wastech-mdlint.config.json"),
      JSON.stringify({ structure: { orphanDocs: "off" } }),
      "utf8"
    );

    const output = await executeCommand({
      kind: "scan",
      path: tempDir,
      format: "json",
      failOn: "error"
    });
    const payload = JSON.parse(output.output) as {
      summary: {
        root: string;
        files: number;
        findings: { error: number; warning: number; info: number };
      };
      files: Array<{ path: string; bytes: number }>;
      budgets: Array<{
        entrypoint: string;
        ownBytes: number;
        ownEstimatedTokens: number;
        importedFiles: Array<{ path: string; bytes: number; estimatedTokens: number }>;
        totalBytes: number;
        totalEstimatedTokens: number;
        maxTokens: number;
        overLimit: boolean;
        cycles: unknown[];
        missingImports: unknown[];
      }>;
    };

    expect(payload.summary.files).toBe(2);
    expect(payload.summary.findings).toEqual({ error: 0, warning: 0, info: 0 });
    expect(payload.files).toEqual([
      { path: "CLAUDE.md", bytes: 17 },
      { path: "docs/context.md", bytes: 8 }
    ]);
    expect(payload.budgets).toEqual([
      {
        entrypoint: "CLAUDE.md",
        ownBytes: 17,
        ownEstimatedTokens: 5,
        importedFiles: [{ path: "docs/context.md", bytes: 8, estimatedTokens: 2 }],
        totalBytes: 25,
        totalEstimatedTokens: 7,
        maxTokens: 5000,
        overLimit: false,
        cycles: [],
        missingImports: []
      }
    ]);
    expect(output.exitCode).toBe(EXIT_CODE_SUCCESS);
  });

  it("exits 0 for completed scans when --fail-on off", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-"));
    tempDirs.push(tempDir);
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    await writeFile(path.join(tempDir, "README.md"), "[Missing](docs/missing.md)\n", "utf8");

    const exitCode = await runCli(["scan", tempDir, "--fail-on", "off"], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(stdout.read()).toContain('Broken local link "docs/missing.md": target file not found.');
    expect(stderr.read()).toBe("");
  });

  it("exits 1 for warnings when --fail-on warning", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-"));
    tempDirs.push(tempDir);
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    await writeFile(path.join(tempDir, "README.md"), "[Missing](docs/missing.md)\n", "utf8");

    const exitCode = await runCli(["scan", tempDir, "--fail-on", "warning"], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_RUNTIME_ERROR);
    expect(stdout.read()).toContain('Broken local link "docs/missing.md": target file not found.');
    expect(stderr.read()).toBe("");
  });

  it("exits 0 for warning-only scans when --fail-on error", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-"));
    tempDirs.push(tempDir);
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    await writeFile(path.join(tempDir, "README.md"), "[Missing](docs/missing.md)\n", "utf8");

    const exitCode = await runCli(["scan", tempDir, "--fail-on", "error"], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_SUCCESS);
    expect(stdout.read()).toContain('Broken local link "docs/missing.md": target file not found.');
    expect(stderr.read()).toBe("");
  });

  it("exits 1 by default when scan finds orphan-doc errors", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-cli-"));
    tempDirs.push(tempDir);
    const stdout = createMemoryWriter();
    const stderr = createMemoryWriter();

    await writeFile(path.join(tempDir, "docs.md"), "# Orphan\n", "utf8");

    const exitCode = await runCli(["scan", tempDir], {
      stdout: stdout.stream,
      stderr: stderr.stream
    });

    expect(exitCode).toBe(EXIT_CODE_RUNTIME_ERROR);
    expect(stdout.read()).toContain("structure/orphan-docs");
    expect(stderr.read()).toBe("");
  });
});

describe("resolveScanExitCode", () => {
  it("returns 1 for error fail-on when error findings exist", () => {
    expect(
      resolveScanExitCode({
        failOn: "error",
        result: {
          summary: {
            root: "/repo",
            files: 1,
            findings: { error: 1, warning: 0, info: 0 }
          },
          findings: [
            {
              ruleId: "structure/orphan-docs",
              severity: "error",
              path: "README.md",
              message: "Orphan."
            }
          ],
          files: [{ path: "README.md", bytes: 1 }],
          graph: { nodes: [], edges: [] },
          budgets: []
        }
      })
    ).toBe(EXIT_CODE_RUNTIME_ERROR);
  });
});
