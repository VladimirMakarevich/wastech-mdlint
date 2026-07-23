import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDocuments } from "../src/markdown/load-documents.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true }))
  );
});

async function createFixtureTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-load-"));
  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return root;
}

describe("loadDocuments", () => {
  it("returns parsed documents keyed by sorted, POSIX-normalized absolute paths", async () => {
    const root = await createFixtureTree({
      "b.md": "# B\n",
      "docs/a.md": "# A\n",
      "notes.txt": "ignored"
    });

    const documents = await loadDocuments(["**/*.md"], { cwd: root });
    const keys = [...documents.keys()];

    // On the Windows CI leg this makes the normalization assertion non-vacuous: the fixture root
    // must contain native separators before loadDocuments returns POSIX map keys.
    if (path.sep === "\\") {
      expect(root).toContain("\\");
    }

    expect(keys).toEqual([
      `${root}/b.md`.replaceAll("\\", "/"),
      `${root}/docs/a.md`.replaceAll("\\", "/")
    ]);
    expect(keys.every((key) => !key.includes("\\"))).toBe(true);
    expect([...documents.values()].map((doc) => doc.path)).toEqual(["b.md", "docs/a.md"]);
  });

  it("honors explicit exclude patterns (exclude wins over include)", async () => {
    const root = await createFixtureTree({
      "keep.md": "# Keep\n",
      "dist/generated.md": "# Gen\n",
      "vendor/lib.md": "# Vendor\n"
    });

    const documents = await loadDocuments(["**/*.md"], {
      cwd: root,
      exclude: ["dist/**", "vendor/**"]
    });

    expect([...documents.values()].map((doc) => doc.path)).toEqual(["keep.md"]);
  });

  it("honors .gitignore (root and nested) when respectGitignore is true", async () => {
    const root = await createFixtureTree({
      ".gitignore": "build/\n*.tmp.md\n",
      "keep.md": "# Keep\n",
      "build/out.md": "# Out\n",
      "scratch.tmp.md": "# Tmp\n",
      "docs/.gitignore": "local.md\n",
      "docs/page.md": "# Page\n",
      "docs/local.md": "# Local\n"
    });

    const enabled = await loadDocuments(["**/*.md"], { cwd: root, respectGitignore: true });
    expect([...enabled.values()].map((doc) => doc.path)).toEqual(["docs/page.md", "keep.md"]);

    // Opt-out: without the flag every Markdown file is loaded.
    const disabled = await loadDocuments(["**/*.md"], { cwd: root });
    expect([...disabled.values()].map((doc) => doc.path)).toEqual([
      "build/out.md",
      "docs/local.md",
      "docs/page.md",
      "keep.md",
      "scratch.tmp.md"
    ]);
  });

  it("returns an empty map when the root does not exist", async () => {
    const documents = await loadDocuments(["**/*.md"], {
      cwd: path.join(os.tmpdir(), "wastech-mdlint-does-not-exist-xyz")
    });

    expect(documents.size).toBe(0);
  });

  it("is deterministic across repeated loads", async () => {
    const root = await createFixtureTree({
      "z.md": "# Z\n",
      "a.md": "# A\n",
      "m/n.md": "# N\n"
    });

    const first = [...(await loadDocuments(["**/*.md"], { cwd: root })).keys()];
    const second = [...(await loadDocuments(["**/*.md"], { cwd: root })).keys()];

    expect(first).toEqual(second);
  });

  it("sorts mixed-case and non-ASCII paths by host-independent string order", async () => {
    const root = await createFixtureTree({
      "alpha.md": "# Lower\n",
      "Zulu.md": "# Upper z\n",
      "Beta.md": "# Upper b\n",
      "文.md": "# CJK\n"
    });

    const documents = await loadDocuments(["**/*.md"], { cwd: root });

    expect([...documents.values()].map((doc) => doc.path)).toEqual([
      "Beta.md",
      "Zulu.md",
      "alpha.md",
      "文.md"
    ]);
  });
});
