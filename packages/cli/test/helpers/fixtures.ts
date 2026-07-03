import { cp, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach } from "vitest";

import { executeCommand } from "../../src/commands.js";
import { runCli } from "../../src/program.js";

// Resolved from this module's own location rather than process.cwd(): the root aggregator
// (npm test at the repo root) runs vitest with cwd = repo root, not packages/cli, so a
// cwd-relative "test/fixtures" path would silently miss this package's fixtures.
const FIXTURES_ROOT = fileURLToPath(new URL("../fixtures", import.meta.url));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (tempDir) => {
      const fs = await import("node:fs/promises");
      await fs.rm(tempDir, { recursive: true, force: true });
    })
  );
});

export async function copyFixture(fixtureName: string): Promise<string> {
  const sourceDir = path.join(FIXTURES_ROOT, fixtureName);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-fixture-"));
  tempDirs.push(tempDir);
  await cp(sourceDir, tempDir, { recursive: true });
  return tempDir;
}

export function normalizeFixtureOutput(output: string, rootPath: string): string {
  const collapseSlashes = (value: string): string => value.replaceAll("\\", "/").replace(/\/+/g, "/");
  const normalizedRootPath = collapseSlashes(rootPath);

  return collapseSlashes(output)
    .replaceAll(normalizedRootPath, "<ROOT>")
    .replaceAll(rootPath, "<ROOT>");
}

export async function runFixtureCli(params: {
  fixtureName: string;
  argv: string[];
}): Promise<{
  rootPath: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const rootPath = await copyFixture(params.fixtureName);
  let stdout = "";
  let stderr = "";

  const exitCode = await runCli(
    params.argv.map((token) => token.replaceAll("<ROOT>", rootPath)),
    {
      stdout: {
        write(chunk: string) {
          stdout += chunk;
          return true;
        }
      },
      stderr: {
        write(chunk: string) {
          stderr += chunk;
          return true;
        }
      }
    }
  );

  return { rootPath, stdout, stderr, exitCode };
}

export async function runFixtureScanJson(fixtureName: string): Promise<{
  rootPath: string;
  payload: unknown;
  exitCode: number;
}> {
  const rootPath = await copyFixture(fixtureName);
  const result = await executeCommand({
    kind: "scan",
    path: rootPath,
    format: "json",
    failOn: "error"
  });

  return {
    rootPath,
    payload: JSON.parse(result.output) as unknown,
    exitCode: result.exitCode
  };
}

export async function runFixtureGraph(fixtureName: string, outRelativePath = "graph.json"): Promise<{
  rootPath: string;
  outputPath: string;
  output: string;
}> {
  const rootPath = await copyFixture(fixtureName);
  const outputPath = path.join(rootPath, outRelativePath);
  await executeCommand({
    kind: "graph",
    path: rootPath,
    out: outputPath
  });

  return {
    rootPath,
    outputPath,
    output: await readFile(outputPath, "utf8")
  };
}
