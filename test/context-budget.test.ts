import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { buildEntrypointBudgets } from "../src/llm/budget.js";
import { analyzeLlmImports } from "../src/llm/imports.js";
import { parseMarkdownFiles } from "../src/markdown/parse.js";
import type { AuditConfig, MarkdownFile } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (tempDir) => {
      const fs = await import("node:fs/promises");
      await fs.rm(tempDir, { recursive: true, force: true });
    })
  );
});

async function createRepoFiles(fileMap: Record<string, string>): Promise<MarkdownFile[]> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "wastech-ctxlint-context-budget-"));
  tempDirs.push(rootPath);

  const files: MarkdownFile[] = [];

  for (const [relativePath, text] of Object.entries(fileMap)) {
    const absolutePath = path.join(rootPath, relativePath);
    await (await import("node:fs/promises")).mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, text, "utf8");
    files.push({
      path: relativePath.replaceAll("\\", "/"),
      absolutePath,
      bytes: Buffer.byteLength(text)
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function createConfig(params: {
  entrypoints?: string[];
  maxTokensPerEntrypoint?: number;
} = {}): AuditConfig {
  return {
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      entrypoints: params.entrypoints ?? ["CLAUDE.md"],
      maxTokensPerEntrypoint:
        params.maxTokensPerEntrypoint ?? DEFAULT_CONFIG.llm.maxTokensPerEntrypoint
    }
  };
}

describe("buildEntrypointBudgets", () => {
  it("creates a budget for an entrypoint without imports", async () => {
    const files = await createRepoFiles({
      "CLAUDE.md": "abcd"
    });
    const parsed = await parseMarkdownFiles(files);
    const imports = analyzeLlmImports({
      files: parsed.files,
      config: createConfig()
    });

    const result = buildEntrypointBudgets({
      files: parsed.files,
      config: createConfig(),
      importGraph: imports.importGraph
    });

    expect(result.budgets).toEqual([
      {
        entrypoint: "CLAUDE.md",
        ownBytes: 4,
        ownEstimatedTokens: 1,
        importedFiles: [],
        totalBytes: 4,
        totalEstimatedTokens: 1,
        maxTokens: 5000,
        overLimit: false,
        cycles: [],
        missingImports: []
      }
    ]);
    expect(result.findings).toEqual([]);
  });

  it("includes direct and transitive imports once each", async () => {
    const files = await createRepoFiles({
      "CLAUDE.md": "@docs/a.md\n@docs/b.md\n",
      "docs/a.md": "@../shared/common.md\n",
      "docs/b.md": "@../shared/common.md\n",
      "shared/common.md": "abcdefgh",
      "unused.md": "ignored"
    });
    const parsed = await parseMarkdownFiles(files);
    const imports = analyzeLlmImports({
      files: parsed.files,
      config: createConfig()
    });

    const result = buildEntrypointBudgets({
      files: parsed.files,
      config: createConfig(),
      importGraph: imports.importGraph
    });

    expect(result.budgets[0]).toEqual({
      entrypoint: "CLAUDE.md",
      ownBytes: 22,
      ownEstimatedTokens: 6,
      importedFiles: [
        { path: "docs/a.md", bytes: 21, estimatedTokens: 6 },
        { path: "docs/b.md", bytes: 21, estimatedTokens: 6 },
        { path: "shared/common.md", bytes: 8, estimatedTokens: 2 }
      ],
      totalBytes: 72,
      totalEstimatedTokens: 20,
      maxTokens: 5000,
      overLimit: false,
      cycles: [],
      missingImports: []
    });
  });

  it("does not inflate totals on cycles and carries cycle metadata", async () => {
    const files = await createRepoFiles({
      "CLAUDE.md": "@docs/a.md\n",
      "docs/a.md": "@b.md\n",
      "docs/b.md": "@a.md\n"
    });
    const parsed = await parseMarkdownFiles(files);
    const imports = analyzeLlmImports({
      files: parsed.files,
      config: createConfig()
    });

    const result = buildEntrypointBudgets({
      files: parsed.files,
      config: createConfig(),
      importGraph: imports.importGraph
    });

    expect(result.budgets[0]?.importedFiles.map((file) => file.path)).toEqual([
      "docs/a.md",
      "docs/b.md"
    ]);
    expect(result.budgets[0]?.cycles).toEqual([
      {
        paths: ["docs/a.md", "docs/b.md", "docs/a.md"],
        sourcePath: "docs/b.md",
        line: 1,
        column: 1
      }
    ]);
  });

  it("carries missing imports into the budget without counting them", async () => {
    const files = await createRepoFiles({
      "CLAUDE.md": "@docs/missing.md\n"
    });
    const parsed = await parseMarkdownFiles(files);
    const imports = analyzeLlmImports({
      files: parsed.files,
      config: createConfig()
    });

    const result = buildEntrypointBudgets({
      files: parsed.files,
      config: createConfig(),
      importGraph: imports.importGraph
    });

    expect(result.budgets[0]).toEqual({
      entrypoint: "CLAUDE.md",
      ownBytes: 17,
      ownEstimatedTokens: 5,
      importedFiles: [],
      totalBytes: 17,
      totalEstimatedTokens: 5,
      maxTokens: 5000,
      overLimit: false,
      cycles: [],
      missingImports: [
        {
          sourcePath: "CLAUDE.md",
          rawTarget: "@docs/missing.md",
          targetPath: "docs/missing.md",
          line: 1,
          column: 1
        }
      ]
    });
  });

  it("emits a warning when the total estimated tokens exceed the max", async () => {
    const files = await createRepoFiles({
      "CLAUDE.md": "abcdefgh"
    });
    const parsed = await parseMarkdownFiles(files);
    const config = createConfig({ maxTokensPerEntrypoint: 1 });
    const imports = analyzeLlmImports({
      files: parsed.files,
      config
    });

    const result = buildEntrypointBudgets({
      files: parsed.files,
      config,
      importGraph: imports.importGraph
    });

    expect(result.findings).toEqual([
      {
        ruleId: "llm/context-budget",
        severity: "warning",
        path: "CLAUDE.md",
        message:
          "Entrypoint CLAUDE.md is over context budget: 2 estimated tokens exceeds 1 (100.0% over)."
      }
    ]);
    expect(result.budgets[0]?.overLimit).toBe(true);
  });

  it("does not create findings for unmatched entrypoint patterns", async () => {
    const files = await createRepoFiles({
      "README.md": "abcd"
    });
    const parsed = await parseMarkdownFiles(files);
    const config = createConfig({ entrypoints: ["CLAUDE.md"] });
    const imports = analyzeLlmImports({
      files: parsed.files,
      config
    });

    const result = buildEntrypointBudgets({
      files: parsed.files,
      config,
      importGraph: imports.importGraph
    });

    expect(result.budgets).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});
