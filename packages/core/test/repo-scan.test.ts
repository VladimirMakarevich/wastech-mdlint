import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { matchesConfigGlob } from "../src/discovery/globs.js";
import { DEFAULT_NOISE_DIR_NAMES } from "../src/discovery/repo-scan-constants.js";
import { scanRepository } from "../src/discovery/repo-scan.js";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-scan-"));
  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return root;
}

describe("scanRepository", () => {
  it("qualifies a known-named dir at 1 file but requires 3+ for an unknown-named dir", async () => {
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      "notes/a.md": "# A\n",
      "notes/b.md": "# B\n",
      "articles/a.md": "# A\n",
      "articles/b.md": "# B\n",
      "articles/c.md": "# C\n",
    });

    const result = await scanRepository({ cwd: root });
    const paths = result.clusters.map((cluster) => cluster.path);

    expect(paths).toContain("docs");
    expect(paths).toContain("articles");
    expect(paths).not.toContain("notes");

    const docsCluster = result.clusters.find(
      (cluster) => cluster.path === "docs",
    );
    expect(docsCluster).toMatchObject({
      kind: "cluster",
      subtreeCount: 1,
      score: 4,
    });

    const articlesCluster = result.clusters.find(
      (cluster) => cluster.path === "articles",
    );
    expect(articlesCluster).toMatchObject({
      kind: "cluster",
      subtreeCount: 3,
      score: 3,
    });
  });

  it("rolls nested qualifying dirs up to the shallowest kept ancestor", async () => {
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      "docs/api/two.md": "# Two\n",
      "docs/api/three.md": "# Three\n",
      "docs/api/four.md": "# Four\n",
    });

    const result = await scanRepository({ cwd: root });
    const clusterPaths = result.clusters
      .filter((cluster) => cluster.kind === "cluster")
      .map((cluster) => cluster.path);

    expect(clusterPaths).toEqual(["docs"]);
    const docsCluster = result.clusters.find(
      (cluster) => cluster.path === "docs",
    );
    expect(docsCluster?.subtreeCount).toBe(4);
  });

  it("sorts root-kind entries after every cluster-kind entry regardless of score", async () => {
    const rootFiles: Record<string, string> = { "docs/one.md": "# One\n" };
    for (let index = 0; index < 10; index += 1) {
      rootFiles[`root-${index}.md`] = `# Root ${index}\n`;
    }

    const root = await createFixtureTree(rootFiles);
    const result = await scanRepository({ cwd: root });

    expect(result.clusters[0]).toMatchObject({ kind: "cluster", path: "docs" });
    const rootEntry = result.clusters.find(
      (cluster) => cluster.kind === "root",
    );
    expect(rootEntry?.subtreeCount).toBe(10);

    const rootIndex = result.clusters.findIndex(
      (cluster) => cluster.kind === "root",
    );
    const clusterIndex = result.clusters.findIndex(
      (cluster) => cluster.kind === "cluster",
    );
    expect(rootIndex).toBeGreaterThan(clusterIndex);
  });

  it("falls back to **/*.md when nothing qualifies but Markdown exists somewhere", async () => {
    const root = await createFixtureTree({
      "leaf1/a.md": "# A\n",
      "leaf2/b.md": "# B\n",
      "leaf3/c.md": "# C\n",
    });

    const result = await scanRepository({ cwd: root });

    expect(result.clusters).toEqual([
      {
        path: "",
        kind: "fallback",
        score: 3,
        subtreeCount: 3,
        includeGlob: "**/*.md",
        sampleFiles: ["leaf1/a.md", "leaf2/b.md", "leaf3/c.md"],
      },
    ]);
  });

  it("keeps the literal **/*.md fallback (mirroring the tool's default) even when only .mdx files exist", async () => {
    const root = await createFixtureTree({
      "leaf1/a.mdx": "# A\n",
      "leaf2/b.mdx": "# B\n",
    });

    const result = await scanRepository({ cwd: root });

    expect(result.clusters).toEqual([
      {
        path: "",
        kind: "fallback",
        score: 2,
        subtreeCount: 2,
        includeGlob: "**/*.md",
        sampleFiles: ["leaf1/a.mdx", "leaf2/b.mdx"],
      },
    ]);

    // Known, accepted tradeoff: the fallback proposes the tool's actual zero-config default
    // (`.md` only), not a scan-specific glob, so it honestly loads nothing when the discovered
    // corpus is `.mdx`-only — the proposal is a starting point for `init`, not a guarantee.
    const documents = await loadDocuments([result.clusters[0].includeGlob], {
      cwd: root,
    });
    expect(documents.size).toBe(0);
  });

  it("returns no clusters and no spurious fallback when there is zero Markdown", async () => {
    const root = await createFixtureTree({ "src/index.ts": "export {};\n" });
    const result = await scanRepository({ cwd: root });
    expect(result.clusters).toEqual([]);
  });

  it("prunes NOISE dirs even when they contain many Markdown files", async () => {
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      "node_modules/foo/a.md": "# A\n",
      "node_modules/foo/b.md": "# B\n",
      "node_modules/foo/c.md": "# C\n",
      "node_modules/foo/d.md": "# D\n",
    });

    const result = await scanRepository({ cwd: root });
    const paths = result.clusters.map((cluster) => cluster.path);

    expect(paths).toEqual(["docs"]);
  });

  it("tags a workspace package's own cluster/root entries and excludes them from the repo-root scope", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/foo/docs/one.md": "# One\n",
      "packages/foo/README.md": "# Foo\n",
      "docs/two.md": "# Two\n",
    });

    const result = await scanRepository({ cwd: root });

    const fooDocs = result.clusters.find(
      (cluster) => cluster.path === "packages/foo/docs",
    );
    expect(fooDocs).toMatchObject({
      kind: "cluster",
      workspacePackage: "packages/foo",
    });

    const fooRoot = result.clusters.find(
      (cluster) =>
        cluster.kind === "root" && cluster.workspacePackage === "packages/foo",
    );
    expect(fooRoot).toMatchObject({ path: "packages/foo", subtreeCount: 1 });

    const rootDocs = result.clusters.find((cluster) => cluster.path === "docs");
    expect(rootDocs).toMatchObject({ kind: "cluster" });
    expect(rootDocs).not.toHaveProperty("workspacePackage");

    // No entry should re-surface the package's files under the repo-root scope.
    expect(
      result.clusters.some(
        (cluster) =>
          cluster.workspacePackage === undefined && cluster.kind === "root",
      ),
    ).toBe(false);

    expect(result.workspacePackages).toEqual([
      { path: "packages/foo", name: "foo" },
    ]);
  });

  it("emits a root-only includeGlob that round-trips through matchesConfigGlob/loadDocuments", async () => {
    const root = await createFixtureTree({
      "README.md": "# Readme\n",
      "docs/one.md": "# One\n",
    });

    const result = await scanRepository({ cwd: root });
    const rootEntry = result.clusters.find(
      (cluster) => cluster.kind === "root",
    );
    expect(rootEntry).toBeDefined();

    // Config globs without a "/" get rewritten to `**/pattern` by normalizeConfigGlob, so a
    // naive "*.{md,mdx}" root proposal would silently expand to every Markdown file once fed
    // through the real config pipeline. Prove the emitted pattern stays root-only end to end.
    const patterns = rootEntry === undefined ? [] : [rootEntry.includeGlob];
    expect(matchesConfigGlob("README.md", patterns)).toBe(true);
    expect(matchesConfigGlob("docs/one.md", patterns)).toBe(false);

    const documents = await loadDocuments(patterns, { cwd: root });
    expect([...documents.values()].map((doc) => doc.path)).toEqual([
      "README.md",
    ]);
  });

  it("escapes glob-special characters in a directory name before composing includeGlob", async () => {
    const root = await createFixtureTree({
      "docs[x]/a.md": "# A\n",
      "docs[x]/b.md": "# B\n",
      "docs[x]/c.md": "# C\n",
      "docsx/a.md": "# Decoy\n",
      "apps(web)/a.md": "# A\n",
      "apps(web)/b.md": "# B\n",
      "apps(web)/c.md": "# C\n",
      "appsweb/a.md": "# Decoy\n",
    });

    const result = await scanRepository({ cwd: root });

    const bracketCluster = result.clusters.find(
      (cluster) => cluster.path === "docs[x]",
    );
    expect(bracketCluster).toBeDefined();
    const bracketPatterns =
      bracketCluster === undefined ? [] : [bracketCluster.includeGlob];
    expect(matchesConfigGlob("docs[x]/a.md", bracketPatterns)).toBe(true);
    expect(matchesConfigGlob("docsx/a.md", bracketPatterns)).toBe(false);
    const bracketDocuments = await loadDocuments(bracketPatterns, {
      cwd: root,
    });
    expect([...bracketDocuments.values()].map((doc) => doc.path)).toEqual([
      "docs[x]/a.md",
      "docs[x]/b.md",
      "docs[x]/c.md",
    ]);

    const parenCluster = result.clusters.find(
      (cluster) => cluster.path === "apps(web)",
    );
    expect(parenCluster).toBeDefined();
    const parenPatterns =
      parenCluster === undefined ? [] : [parenCluster.includeGlob];
    expect(matchesConfigGlob("apps(web)/a.md", parenPatterns)).toBe(true);
    expect(matchesConfigGlob("appsweb/a.md", parenPatterns)).toBe(false);
    const parenDocuments = await loadDocuments(parenPatterns, { cwd: root });
    expect([...parenDocuments.values()].map((doc) => doc.path)).toEqual([
      "apps(web)/a.md",
      "apps(web)/b.md",
      "apps(web)/c.md",
    ]);
  });

  it("owns each Markdown file by exactly one scope when a workspace package nests inside another", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({
        workspaces: ["packages/*", "packages/foo/examples/*"],
      }),
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/foo/docs/one.md": "# One\n",
      "packages/foo/examples/bar/package.json": JSON.stringify({ name: "bar" }),
      "packages/foo/examples/bar/docs/nested.md": "# Nested\n",
    });

    const result = await scanRepository({ cwd: root });

    expect(result.workspacePackages).toEqual([
      { path: "packages/foo", name: "foo" },
      { path: "packages/foo/examples/bar", name: "bar" },
    ]);

    const fooDocs = result.clusters.find(
      (cluster) => cluster.path === "packages/foo/docs",
    );
    expect(fooDocs).toMatchObject({
      workspacePackage: "packages/foo",
      subtreeCount: 1,
      sampleFiles: ["packages/foo/docs/one.md"],
    });

    const barDocs = result.clusters.find(
      (cluster) => cluster.path === "packages/foo/examples/bar/docs",
    );
    expect(barDocs).toMatchObject({
      workspacePackage: "packages/foo/examples/bar",
      subtreeCount: 1,
      sampleFiles: ["packages/foo/examples/bar/docs/nested.md"],
    });

    // The nested package's file must not also appear under its ancestor's cluster.
    expect(fooDocs?.sampleFiles).not.toContain(
      "packages/foo/examples/bar/docs/nested.md",
    );
  });

  it("threads a custom noiseDirNames into workspace-package detection, not just Markdown collection", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/foo/docs/one.md": "# One\n",
    });

    const withDefaultNoise = await scanRepository({ cwd: root });
    expect(withDefaultNoise.workspacePackages).toEqual([
      { path: "packages/foo", name: "foo" },
    ]);

    // A caller pruning "packages" from scan noise must have that respected by workspace
    // detection too — not just the Markdown walk.
    const withCustomNoise = await scanRepository({
      cwd: root,
      noiseDirNames: [...DEFAULT_NOISE_DIR_NAMES, "packages"],
    });
    expect(withCustomNoise.workspacePackages).toEqual([]);
  });

  it("honors a custom sampleSize and returns sorted sample files", async () => {
    const root = await createFixtureTree({
      "docs/z.md": "# Z\n",
      "docs/a.md": "# A\n",
      "docs/m.md": "# M\n",
    });

    const result = await scanRepository({ cwd: root, sampleSize: 2 });
    const docsCluster = result.clusters.find(
      (cluster) => cluster.path === "docs",
    );

    expect(docsCluster?.sampleFiles).toEqual(["docs/a.md", "docs/m.md"]);
  });

  it("returns an empty result for a non-existent cwd without throwing", async () => {
    // Nested under a fixture root that carries a `.git` marker rather than sitting directly in
    // `os.tmpdir()`: the package-manager probe walks ancestors, so an unbounded path would make
    // `packageManager: undefined` an assertion about the host's directory tree, not the fixture.
    const root = await createFixtureTree({
      ".git/HEAD": "ref: refs/heads/main\n",
    });
    const missing = path.join(root, "wastech-mdlint-scan-does-not-exist-xyz");
    const result = await scanRepository({ cwd: missing });

    expect(result).toEqual({
      clusters: [],
      packageManager: undefined,
      workspacePackages: [],
      pruned: { directories: [] },
    });
  });

  it("is deterministic across repeated scans of the same fixture tree", async () => {
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      "docs/api/two.md": "# Two\n",
      "docs/api/three.md": "# Three\n",
      "README.md": "# Readme\n",
      "package-lock.json": "{}",
    });

    const first = await scanRepository({ cwd: root });
    const second = await scanRepository({ cwd: root });

    expect(first).toEqual(second);
  });
});

// `init` used to propose `.github/**`, `.venv/**` and `generated-docs/**` as doc clusters, and
// the config it wrote then linted them. The scan is the first half of that fix.
describe("scanRepository · hidden and gitignored trees", () => {
  it("does not propose a hidden directory as a cluster, at the root or nested", async () => {
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      ".github/PULL_REQUEST_TEMPLATE.md": "# PR\n",
      ".github/ISSUE_TEMPLATE/bug.md": "# Bug\n",
      ".venv/lib/site-packages/pkg/README.md": "# Vendored\n",
      "packages/app/.husky/NOTES.md": "# Hooks\n",
    });

    const result = await scanRepository({ cwd: root });
    const paths = result.clusters.map((cluster) => cluster.path);

    expect(paths).toEqual(["docs"]);
    // Not merely unproposed as a cluster — invisible to sampling too, so rule inference never
    // sniffs a file the written config excludes.
    for (const cluster of result.clusters) {
      expect(cluster.sampleFiles.every((file) => !file.includes("/."))).toBe(
        true,
      );
    }
  });

  it("skips gitignored trees, honoring nested .gitignore files and negations", async () => {
    const root = await createFixtureTree({
      ".gitignore": "generated-docs/\n",
      "docs/one.md": "# One\n",
      "generated-docs/api/a.md": "# A\n",
      "generated-docs/api/b.md": "# B\n",
      "generated-docs/api/c.md": "# C\n",
      // A nested ignore file governs only its own subtree, and its `!` negation re-includes one file.
      "notes/.gitignore": "*.md\n!keep.md\n",
      "notes/drop.md": "# Drop\n",
      "notes/keep.md": "# Keep\n",
    });

    const result = await scanRepository({ cwd: root });
    const paths = result.clusters.map((cluster) => cluster.path);

    expect(paths).not.toContain("generated-docs");
    expect(paths).not.toContain("generated-docs/api");
    expect(paths).toContain("docs");

    // `notes` has one surviving file, so it does not clear minClusterSize — but that surviving file
    // must be the negated one, proving the layer's negation was applied rather than the whole
    // directory being dropped.
    const sampled = result.clusters.flatMap((cluster) => cluster.sampleFiles);
    expect(sampled).not.toContain("notes/drop.md");
    expect(sampled).not.toContain("generated-docs/api/a.md");
  });

  it("samples a file a nested .gitignore re-includes across layers, not just within one", async () => {
    // The case above puts both the ignore and its negation in the *same* file, so it never exercised
    // precedence between layers. The cross-layer shape is what mattered: the root ignores, the nested file
    // negates, and the deeper layer has to win or `init` proposes a corpus the linter then drops.
    const root = await createFixtureTree({
      ".gitignore": "notes/*.md\n",
      "notes/.gitignore": "!keep.md\n",
      "notes/drop.md": "# Drop\n",
      "notes/keep.md": "# Keep\n",
      "docs/one.md": "# One\n",
    });

    const result = await scanRepository({ cwd: root, minClusterSize: 1 });
    const sampled = result.clusters.flatMap((cluster) => cluster.sampleFiles);

    expect(sampled).toContain("notes/keep.md");
    expect(sampled).not.toContain("notes/drop.md");
  });

  it("prunes a noise-named directory even when a gitignore negation re-includes it", async () => {
    const root = await createFixtureTree({
      ".gitignore": "build/\n!build/docs/\n",
      "build/artifact.md": "# Artifact\n",
      "build/docs/one.md": "# One\n",
      "docs/two.md": "# Two\n",
    });

    const result = await scanRepository({ cwd: root });
    const paths = result.clusters.map((cluster) => cluster.path);

    // `build` is a DEFAULT_NOISE_DIR_NAMES entry, so it stays pruned regardless of the negation —
    // the name prune runs first and is not gitignore's to override. (Git would not re-include
    // `build/docs/` here either, since its parent is excluded; the negation below is the shape
    // that actually re-includes a subtree.)
    expect(paths).toEqual(["docs"]);
  });

  it("proposes a cluster a gitignore negation re-includes from an excluded parent", async () => {
    const root = await createFixtureTree({
      // The only shape that re-includes a subtree in git's own semantics: exclude the *contents*
      // of `artifacts/` (not the directory itself, which could never be descended into again),
      // then negate the one child that is real documentation.
      ".gitignore": "artifacts/*\n!artifacts/docs/\n",
      "artifacts/scratch.md": "# Scratch\n",
      "artifacts/docs/one.md": "# One\n",
      "artifacts/docs/two.md": "# Two\n",
    });

    const result = await scanRepository({ cwd: root });

    expect(result.clusters.map((cluster) => cluster.path)).toEqual([
      "artifacts/docs",
    ]);
    const sampled = result.clusters.flatMap((cluster) => cluster.sampleFiles);
    expect(sampled).toEqual(["artifacts/docs/one.md", "artifacts/docs/two.md"]);
  });

  it("still proposes a dot-free tree that no .gitignore mentions", async () => {
    // Guard against over-pruning: the two new filters must not touch an ordinary cluster.
    const root = await createFixtureTree({
      ".gitignore": "coverage/\n",
      "specs/a.md": "# A\n",
      "specs/b.md": "# B\n",
    });

    const result = await scanRepository({ cwd: root });

    expect(result.clusters.map((cluster) => cluster.path)).toEqual(["specs"]);
  });
});

// The scan records what it pruned so `init` can disclose it. The record is the whole
// point — a second directory walk to produce the same numbers is a second thing to disagree with the
// first, so these tests pin what the *scan* reports rather than what a re-walk would find.
describe("scanRepository · the pruning record", () => {
  it("records a hidden directory with the Markdown it holds", async () => {
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      ".agents/rules/a.md": "# A\n",
      ".agents/rules/b.md": "# B\n",
      ".claude/skills/x/SKILL.md": "# Skill\n",
    });

    const result = await scanRepository({ cwd: root });

    // Only the hidden *roots* are recorded — a nested `.a/b` is part of `.a`'s total,
    // not a second entry, so the counts can never be double-read.
    expect(result.pruned.directories).toEqual([
      { path: ".agents", reason: "hidden", markdownFileCount: 2 },
      { path: ".claude", reason: "hidden", markdownFileCount: 1 },
    ]);
  });

  it("classifies a hidden dependency tree as noise and never counts it", async () => {
    // The bound on the count walk: `.venv`/`.yarn` are in DEFAULT_NOISE_DIR_NAMES precisely so
    // sizing the hidden class never descends into a virtualenv or a Yarn Berry cache.
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      ".venv/lib/site-packages/pkg/README.md": "# Vendored\n",
      "mobile/node_modules/leftpad/README.md": "# leftpad\n",
    });

    const result = await scanRepository({ cwd: root });

    expect(result.pruned.directories).toEqual([
      { path: ".venv", reason: "noise" },
      { path: "mobile/node_modules", reason: "noise" },
    ]);
    for (const entry of result.pruned.directories) {
      expect(entry.markdownFileCount).toBeUndefined();
    }
  });

  it("records a gitignored directory without counting it, and honors ignores inside a hidden one", async () => {
    const root = await createFixtureTree({
      ".gitignore": "generated-docs/\n.claude/drafts/\n",
      "docs/one.md": "# One\n",
      "generated-docs/api/a.md": "# A\n",
      "generated-docs/api/b.md": "# B\n",
      ".claude/keep.md": "# Keep\n",
      ".claude/drafts/skip.md": "# Skip\n",
    });

    const result = await scanRepository({ cwd: root });

    expect(result.pruned.directories).toEqual([
      // The hidden count runs the same gitignore layers the corpus walk does, so the number agrees
      // with `git ls-files` rather than with a raw directory listing.
      { path: ".claude", reason: "hidden", markdownFileCount: 1 },
      { path: "generated-docs", reason: "gitignored" },
    ]);
  });

  it("counts only MARKDOWN_EXTENSIONS files inside a hidden directory", async () => {
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      ".claude/a.md": "# A\n",
      ".claude/b.mdx": "# B\n",
      ".claude/settings.json": "{}\n",
      ".claude/notes.txt": "notes\n",
    });

    const result = await scanRepository({ cwd: root });

    expect(result.pruned.directories).toEqual([
      { path: ".claude", reason: "hidden", markdownFileCount: 2 },
    ]);
  });

  it("is sorted by path and stable across repeated scans", async () => {
    const root = await createFixtureTree({
      ".gitignore": "generated-docs/\n",
      "docs/one.md": "# One\n",
      "zeta/node_modules/pkg/README.md": "# Pkg\n",
      "alpha/dist/out.md": "# Out\n",
      ".github/PULL_REQUEST_TEMPLATE.md": "# PR\n",
      "generated-docs/api/a.md": "# A\n",
    });

    const first = await scanRepository({ cwd: root });
    const second = await scanRepository({ cwd: root });

    expect(first.pruned.directories.map((entry) => entry.path)).toEqual([
      ".github",
      "alpha/dist",
      "generated-docs",
      "zeta/node_modules",
    ]);
    expect(first.pruned).toEqual(second.pruned);
  });

  it("records nothing for a tree with no pruned directory at all", async () => {
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      "docs/two.md": "# Two\n",
    });

    const result = await scanRepository({ cwd: root });

    expect(result.pruned).toEqual({ directories: [] });
  });
});
