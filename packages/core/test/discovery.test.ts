import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { discoverMarkdownFiles, DiscoveryError } from "../src/discovery/discover.js";
import { matchesConfigGlob, normalizeConfigGlob } from "../src/discovery/globs.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (tempDir) => {
      const fs = await import("node:fs/promises");
      await fs.rm(tempDir, { recursive: true, force: true });
    })
  );
});

async function createTempRepo(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-discovery-"));
  tempDirs.push(tempDir);
  return tempDir;
}

async function tryCreateSymlink(targetPath: string, linkPath: string, type?: "dir" | "file") {
  try {
    await symlink(targetPath, linkPath, type);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      return false;
    }

    throw error;
  }
}

describe("glob helpers", () => {
  it("treats bare filenames as any-depth patterns", () => {
    expect(normalizeConfigGlob("CLAUDE.md")).toBe("**/CLAUDE.md");
    expect(matchesConfigGlob("docs/nested/CLAUDE.md", ["CLAUDE.md"])).toBe(true);
  });
});

describe("discoverMarkdownFiles", () => {
  it("includes all markdown files by default", async () => {
    const repoRoot = await createTempRepo();

    await mkdir(path.join(repoRoot, "docs", "nested"), { recursive: true });
    await writeFile(path.join(repoRoot, "README.md"), "# Root\n", "utf8");
    await writeFile(path.join(repoRoot, "docs", "guide.md"), "# Guide\n", "utf8");
    await writeFile(path.join(repoRoot, "docs", "nested", "deep.md"), "# Deep\n", "utf8");

    const files = await discoverMarkdownFiles({
      rootPath: repoRoot,
      config: DEFAULT_CONFIG
    });

    expect(files.map((file) => file.path)).toEqual([
      "docs/guide.md",
      "docs/nested/deep.md",
      "README.md"
    ]);
  });

  it("excludes node_modules, dist, and .git by default", async () => {
    const repoRoot = await createTempRepo();

    await mkdir(path.join(repoRoot, "node_modules", "pkg"), { recursive: true });
    await mkdir(path.join(repoRoot, "dist"), { recursive: true });
    await mkdir(path.join(repoRoot, ".git"), { recursive: true });
    await writeFile(path.join(repoRoot, "README.md"), "# Root\n", "utf8");
    await writeFile(path.join(repoRoot, "node_modules", "pkg", "ignored.md"), "# Ignore\n", "utf8");
    await writeFile(path.join(repoRoot, "dist", "ignored.md"), "# Ignore\n", "utf8");
    await writeFile(path.join(repoRoot, ".git", "ignored.md"), "# Ignore\n", "utf8");

    const files = await discoverMarkdownFiles({
      rootPath: repoRoot,
      config: DEFAULT_CONFIG
    });

    expect(files.map((file) => file.path)).toEqual(["README.md"]);
  });

  it("honors custom include and exclude arrays", async () => {
    const repoRoot = await createTempRepo();

    await mkdir(path.join(repoRoot, "docs"), { recursive: true });
    await mkdir(path.join(repoRoot, "notes"), { recursive: true });
    await writeFile(path.join(repoRoot, "docs", "keep.md"), "# Keep\n", "utf8");
    await writeFile(path.join(repoRoot, "docs", "skip.md"), "# Skip\n", "utf8");
    await writeFile(path.join(repoRoot, "notes", "ignore.md"), "# Ignore\n", "utf8");

    const files = await discoverMarkdownFiles({
      rootPath: repoRoot,
      config: {
        ...DEFAULT_CONFIG,
        include: ["docs/**/*.md"],
        exclude: ["skip.md"]
      }
    });

    expect(files.map((file) => file.path)).toEqual(["docs/keep.md"]);
  });

  it("normalizes nested paths to posix format", async () => {
    const repoRoot = await createTempRepo();

    await mkdir(path.join(repoRoot, "docs", "api"), { recursive: true });
    await writeFile(path.join(repoRoot, "docs", "api", "reference.md"), "# Ref\n", "utf8");

    const files = await discoverMarkdownFiles({
      rootPath: repoRoot,
      config: DEFAULT_CONFIG
    });

    expect(files[0]?.path).toBe("docs/api/reference.md");
  });

  it("skips non-markdown files", async () => {
    const repoRoot = await createTempRepo();

    await writeFile(path.join(repoRoot, "README.md"), "# Root\n", "utf8");
    await writeFile(path.join(repoRoot, "notes.txt"), "plain text\n", "utf8");

    const files = await discoverMarkdownFiles({
      rootPath: repoRoot,
      config: DEFAULT_CONFIG
    });

    expect(files.map((file) => file.path)).toEqual(["README.md"]);
  });

  it("returns an empty list for an empty repository", async () => {
    const repoRoot = await createTempRepo();

    const files = await discoverMarkdownFiles({
      rootPath: repoRoot,
      config: DEFAULT_CONFIG
    });

    expect(files).toEqual([]);
  });

  it("reports a missing root path as a discovery error", async () => {
    const repoRoot = await createTempRepo();
    const missingRoot = path.join(repoRoot, "missing");

    await expect(
      discoverMarkdownFiles({
        rootPath: missingRoot,
        config: DEFAULT_CONFIG
      })
    ).rejects.toThrowError(new DiscoveryError(`Scan root not found: ${missingRoot}`));
  });

  it("includes symlinked files that resolve inside the root", async () => {
    const repoRoot = await createTempRepo();
    const realFile = path.join(repoRoot, "docs", "source.md");
    const linkedFile = path.join(repoRoot, "docs", "linked.md");

    await mkdir(path.join(repoRoot, "docs"), { recursive: true });
    await writeFile(realFile, "# Source\n", "utf8");
    const symlinkCreated = await tryCreateSymlink(realFile, linkedFile, "file");

    if (!symlinkCreated) {
      return;
    }

    const files = await discoverMarkdownFiles({
      rootPath: repoRoot,
      config: DEFAULT_CONFIG
    });

    expect(files.map((file) => file.path)).toEqual(["docs/linked.md", "docs/source.md"]);
  });

  it("skips symlinked directories in v1", async () => {
    const repoRoot = await createTempRepo();
    const realDirectory = path.join(repoRoot, "real-docs");
    const linkedDirectory = path.join(repoRoot, "linked-docs");

    await mkdir(realDirectory, { recursive: true });
    await writeFile(path.join(realDirectory, "inside.md"), "# Inside\n", "utf8");
    const symlinkCreated = await tryCreateSymlink(realDirectory, linkedDirectory, "dir");

    if (!symlinkCreated) {
      return;
    }

    const files = await discoverMarkdownFiles({
      rootPath: repoRoot,
      config: DEFAULT_CONFIG
    });

    expect(files.map((file) => file.path)).toEqual(["real-docs/inside.md"]);
  });
});
