import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
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

async function createRepoFiles(fileMap: Record<string, string>): Promise<{
  rootPath: string;
  files: MarkdownFile[];
}> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "wastech-ctxlint-llm-imports-"));
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
  return { rootPath, files };
}

function createConfig(entrypoints: string[] = ["CLAUDE.md"]): AuditConfig {
  return {
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      entrypoints
    }
  };
}

describe("analyzeLlmImports", () => {
  it("discovers configured entrypoints and resolves transitive imports", async () => {
    const repo = await createRepoFiles({
      "CLAUDE.md": "@docs/context.md\n",
      "docs/context.md": "@../shared/base.md\n",
      "shared/base.md": "# Base\n",
      "README.md": "@shared/ignored.md\n"
    });
    const parsed = await parseMarkdownFiles(repo.files);

    const result = analyzeLlmImports({
      files: parsed.files,
      config: createConfig(["CLAUDE.md"])
    });

    expect(result.importGraph.entrypoints).toEqual(["CLAUDE.md"]);
    expect(result.importGraph.edges).toEqual([
      { from: "CLAUDE.md", to: "docs/context.md", kind: "eager-import" },
      { from: "docs/context.md", to: "shared/base.md", kind: "eager-import" }
    ]);
    expect(result.importGraph.traversals).toEqual([
      {
        entrypointPath: "CLAUDE.md",
        importedPaths: ["docs/context.md", "shared/base.md"],
        missingImports: [],
        cycles: []
      }
    ]);
    expect(result.findings).toEqual([]);
  });

  it("resolves nested imports relative to the importing file", async () => {
    const repo = await createRepoFiles({
      "CLAUDE.md": "@docs/prompts/system.md\n",
      "docs/prompts/system.md": "@partials/rules.md\n",
      "docs/prompts/partials/rules.md": "# Rules\n"
    });
    const parsed = await parseMarkdownFiles(repo.files);

    const result = analyzeLlmImports({
      files: parsed.files,
      config: createConfig()
    });

    expect(result.importGraph.traversals[0]).toEqual({
      entrypointPath: "CLAUDE.md",
      importedPaths: ["docs/prompts/partials/rules.md", "docs/prompts/system.md"],
      missingImports: [],
      cycles: []
    });
  });

  it("resolves root-relative imports from the scan root", async () => {
    const repo = await createRepoFiles({
      "CLAUDE.md": "@/docs/context.md\n",
      "docs/context.md": "# Context\n"
    });
    const parsed = await parseMarkdownFiles(repo.files);

    const result = analyzeLlmImports({
      files: parsed.files,
      config: createConfig()
    });

    expect(result.importGraph.imports).toEqual([
      {
        sourcePath: "CLAUDE.md",
        rawTarget: "@/docs/context.md",
        targetPath: "docs/context.md",
        line: 1,
        column: 1
      }
    ]);
  });

  it("reports missing imports as warnings", async () => {
    const repo = await createRepoFiles({
      "CLAUDE.md": "@docs/missing.md\n"
    });
    const parsed = await parseMarkdownFiles(repo.files);

    const result = analyzeLlmImports({
      files: parsed.files,
      config: createConfig()
    });

    expect(result.findings).toEqual([
      {
        ruleId: "llm/eager-imports",
        severity: "warning",
        path: "CLAUDE.md",
        line: 1,
        column: 1,
        message: "Missing eager import @docs/missing.md; resolved to docs/missing.md."
      }
    ]);
  });

  it("reports deterministic cycles and stops recursion", async () => {
    const repo = await createRepoFiles({
      "CLAUDE.md": "@docs/a.md\n",
      "docs/a.md": "@b.md\n",
      "docs/b.md": "@a.md\n"
    });
    const parsed = await parseMarkdownFiles(repo.files);

    const result = analyzeLlmImports({
      files: parsed.files,
      config: createConfig()
    });

    expect(result.findings).toEqual([
      {
        ruleId: "llm/eager-imports",
        severity: "warning",
        path: "docs/b.md",
        line: 1,
        column: 1,
        message: "Eager import cycle detected: docs/a.md -> docs/b.md -> docs/a.md."
      }
    ]);
    expect(result.importGraph.traversals[0]).toEqual({
      entrypointPath: "CLAUDE.md",
      importedPaths: ["docs/a.md", "docs/b.md"],
      missingImports: [],
      cycles: [
        {
          paths: ["docs/a.md", "docs/b.md", "docs/a.md"],
          sourcePath: "docs/b.md",
          line: 1,
          column: 1
        }
      ]
    });
  });

  it("ignores import-like text in fenced and inline code", async () => {
    const repo = await createRepoFiles({
      "CLAUDE.md": [
        "`@docs/inline.md`",
        "```md",
        "@docs/fenced.md",
        "```",
        "@docs/used.md"
      ].join("\n"),
      "docs/used.md": "# Used\n"
    });
    const parsed = await parseMarkdownFiles(repo.files);

    const result = analyzeLlmImports({
      files: parsed.files,
      config: createConfig()
    });

    expect(result.importGraph.imports).toEqual([
      {
        sourcePath: "CLAUDE.md",
        rawTarget: "@docs/used.md",
        targetPath: "docs/used.md",
        line: 5,
        column: 1
      }
    ]);
  });

  it("counts duplicate reachable imports once per entrypoint traversal", async () => {
    const repo = await createRepoFiles({
      "CLAUDE.md": "@docs/a.md\n@docs/b.md\n",
      "docs/a.md": "@../shared/common.md\n",
      "docs/b.md": "@../shared/common.md\n",
      "shared/common.md": "# Common\n"
    });
    const parsed = await parseMarkdownFiles(repo.files);

    const result = analyzeLlmImports({
      files: parsed.files,
      config: createConfig()
    });

    expect(result.importGraph.traversals[0]?.importedPaths).toEqual([
      "docs/a.md",
      "docs/b.md",
      "shared/common.md"
    ]);
  });
});
