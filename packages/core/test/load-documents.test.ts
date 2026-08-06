import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDocuments } from "../src/markdown/load-documents.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

async function createFixtureTree(
  files: Record<string, string>,
): Promise<string> {
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
      "notes.txt": "ignored",
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
      `${root}/docs/a.md`.replaceAll("\\", "/"),
    ]);
    expect(keys.every((key) => !key.includes("\\"))).toBe(true);
    expect([...documents.values()].map((doc) => doc.path)).toEqual([
      "b.md",
      "docs/a.md",
    ]);
  });

  // The layering P13.02 depends on: the lint-time default `exclude` lives in `resolveCorpusScope`,
  // never here. This loader's contract is "what you pass is what I walk" — `gitignore-layers.test.ts`
  // compares its corpus against real `git ls-files` with an explicit pattern set, so a loader that
  // silently added the default patterns of its own would make that oracle compare two different trees.
  it("applies no default exclude of its own (P13.02 layering)", async () => {
    const root = await createFixtureTree({
      "keep.md": "# Keep\n",
      "node_modules/pkg/README.md": "# Dep\n",
    });

    const documents = await loadDocuments(["**/*.md"], { cwd: root });

    expect([...documents.values()].map((doc) => doc.path)).toEqual([
      "keep.md",
      "node_modules/pkg/README.md",
    ]);
  });

  it("honors explicit exclude patterns (exclude wins over include)", async () => {
    const root = await createFixtureTree({
      "keep.md": "# Keep\n",
      "dist/generated.md": "# Gen\n",
      "vendor/lib.md": "# Vendor\n",
    });

    const documents = await loadDocuments(["**/*.md"], {
      cwd: root,
      exclude: ["dist/**", "vendor/**"],
    });

    expect([...documents.values()].map((doc) => doc.path)).toEqual(["keep.md"]);
  });

  it("prunes a `**/<name>/**` exclude at any depth and at the root", async () => {
    const root = await createFixtureTree({
      "keep.md": "# Keep\n",
      "packages/foo/node_modules/lib/x.md": "# Nested dep\n",
      "packages/foo/dist/out.md": "# Nested build\n",
      "node_modules/root-lib/y.md": "# Root dep\n",
    });

    // The depth-agnostic form of `DEFAULT_EXCLUDE_GLOBS` (`config/corpus-scope.ts`). This exercises
    // the *directory* prune, not just file matching: shouldPruneDirectory's synthetic-child probe has
    // to match both `node_modules/...` and `packages/foo/node_modules/...` or the walk descends into
    // the dependency tree before the file filter ever runs.
    const documents = await loadDocuments(["**/*.md"], {
      cwd: root,
      exclude: ["**/node_modules/**", "**/dist/**"],
    });

    expect([...documents.values()].map((doc) => doc.path)).toEqual(["keep.md"]);
  });

  it("narrows the corpus when an include entry is negated (W-01)", async () => {
    const root = await createFixtureTree({
      "README.md": "# Readme\n",
      "docs/public.md": "# Public\n",
      "docs/private/secret.md": "# Secret\n",
    });

    // Negation in `include` does reach into a subdirectory, unlike the `exclude` case below: only
    // `exclude` prunes directories, so `docs/private` is still walked and its files are then filtered.
    const documents = await loadDocuments(["docs/**", "!docs/private/**"], {
      cwd: root,
    });

    expect([...documents.values()].map((doc) => doc.path)).toEqual([
      "docs/public.md",
    ]);
  });

  it("keeps the corpus when an exclude entry is negated (W-01)", async () => {
    const root = await createFixtureTree({
      "keep.md": "# Keep\n",
      "docs/public.md": "# Public\n",
      "docs/private/secret.md": "# Secret\n",
      "docs/private/keepme.md": "# Keep me\n",
    });

    // Before P13.01 this returned *nothing*: `keep.md` is not `docs/private/keepme.md`, so it matched
    // the inverted second entry and every file in the tree was excluded.
    const documents = await loadDocuments(["**/*.md"], {
      cwd: root,
      exclude: ["docs/private/**", "!docs/private/keepme.md"],
    });

    // `keepme.md` is not restored, and that is deliberate: `shouldPruneDirectory` decides
    // `docs/private` before descending into it, so no file inside is ever offered to the file-level
    // filter that the negation would rescue. Honoring it would mean walking every excluded tree — the
    // cost `exclude` exists to avoid. Recorded in `docs/mdlint_v2/accepted-behaviors.md`.
    expect([...documents.values()].map((doc) => doc.path)).toEqual([
      "docs/public.md",
      "keep.md",
    ]);
  });

  it("honors .gitignore (root and nested) when respectGitignore is true", async () => {
    const root = await createFixtureTree({
      ".gitignore": "build/\n*.tmp.md\n",
      "keep.md": "# Keep\n",
      "build/out.md": "# Out\n",
      "scratch.tmp.md": "# Tmp\n",
      "docs/.gitignore": "local.md\n",
      "docs/page.md": "# Page\n",
      "docs/local.md": "# Local\n",
    });

    const enabled = await loadDocuments(["**/*.md"], {
      cwd: root,
      respectGitignore: true,
    });
    expect([...enabled.values()].map((doc) => doc.path)).toEqual([
      "docs/page.md",
      "keep.md",
    ]);

    // Opt-out: without the flag every Markdown file is loaded.
    const disabled = await loadDocuments(["**/*.md"], { cwd: root });
    expect([...disabled.values()].map((doc) => doc.path)).toEqual([
      "build/out.md",
      "docs/local.md",
      "docs/page.md",
      "keep.md",
      "scratch.tmp.md",
    ]);
  });

  it("lets a nested .gitignore negation re-include a file a root pattern ignored", async () => {
    // W-11: layers are ranked by depth, so `docs/.gitignore` overrides the root's `docs/*.md` — the
    // corpus now matches what `git` keeps. Kept in the loader's own suite so the behavior stays
    // covered here with no `git` on PATH; `gitignore-layers.test.ts` is the against-real-git oracle.
    const root = await createFixtureTree({
      ".gitignore": "docs/*.md\n",
      "docs/.gitignore": "!keep.md\n",
      "docs/keep.md": "# Keep\n",
      "docs/other.md": "# Other\n",
    });

    const documents = await loadDocuments(["**/*.md"], {
      cwd: root,
      respectGitignore: true,
    });

    expect([...documents.values()].map((doc) => doc.path)).toEqual([
      "docs/keep.md",
    ]);
  });

  it("keeps a subtree a nested .gitignore re-includes from an excluded parent directory", async () => {
    // The walk-level shape of the same rule, and the one that used to be self-contradictory: the
    // root excludes the *directory* `artifacts/docs` (`artifacts/*` never matches the file itself),
    // `artifacts/.gitignore` re-includes it, so the walk descended — and then dropped every file
    // inside, because the file verdict re-applied the root's exclusion of a parent the deeper layer
    // had already rescued. `git` keeps these files; the oracle for that lives in
    // `gitignore-layers.test.ts`, and this case keeps the corpus covered with no `git` on PATH.
    const root = await createFixtureTree({
      ".gitignore": "artifacts/*\n",
      "artifacts/.gitignore": "!docs/\n",
      "artifacts/docs/one.md": "# One\n",
      "artifacts/docs/deep/two.md": "# Two\n",
      "artifacts/scratch.md": "# Scratch\n",
    });

    const documents = await loadDocuments(["**/*.md"], {
      cwd: root,
      respectGitignore: true,
    });

    expect([...documents.values()].map((doc) => doc.path)).toEqual([
      "artifacts/docs/deep/two.md",
      "artifacts/docs/one.md",
    ]);
  });

  it("returns an empty map when the root does not exist", async () => {
    const documents = await loadDocuments(["**/*.md"], {
      cwd: path.join(os.tmpdir(), "wastech-mdlint-does-not-exist-xyz"),
    });

    expect(documents.size).toBe(0);
  });

  it("is deterministic across repeated loads", async () => {
    const root = await createFixtureTree({
      "z.md": "# Z\n",
      "a.md": "# A\n",
      "m/n.md": "# N\n",
    });

    const first = [...(await loadDocuments(["**/*.md"], { cwd: root })).keys()];
    const second = [
      ...(await loadDocuments(["**/*.md"], { cwd: root })).keys(),
    ];

    expect(first).toEqual(second);
  });

  it("produces byte-identical ParsedDocument values across repeated loads, not just key order", async () => {
    const root = await createFixtureTree({
      "z.md": "# Z\n\n[a](a.md#z)\n",
      "a.md": "# A\n\n| ID |\n| --- |\n| REQ-1 |\n",
    });

    const first = [
      ...(await loadDocuments(["**/*.md"], { cwd: root })).values(),
    ];
    const second = [
      ...(await loadDocuments(["**/*.md"], { cwd: root })).values(),
    ];

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("sorts mixed-case and non-ASCII paths by host-independent string order", async () => {
    const root = await createFixtureTree({
      "alpha.md": "# Lower\n",
      "Zulu.md": "# Upper z\n",
      "Beta.md": "# Upper b\n",
      "文.md": "# CJK\n",
    });

    const documents = await loadDocuments(["**/*.md"], { cwd: root });

    expect([...documents.values()].map((doc) => doc.path)).toEqual([
      "Beta.md",
      "Zulu.md",
      "alpha.md",
      "文.md",
    ]);
  });
});
