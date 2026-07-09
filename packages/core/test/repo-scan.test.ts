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
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true }))
  );
});

async function createFixtureTree(files: Record<string, string>): Promise<string> {
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
      "articles/c.md": "# C\n"
    });

    const result = await scanRepository({ cwd: root });
    const paths = result.clusters.map((cluster) => cluster.path);

    expect(paths).toContain("docs");
    expect(paths).toContain("articles");
    expect(paths).not.toContain("notes");

    const docsCluster = result.clusters.find((cluster) => cluster.path === "docs");
    expect(docsCluster).toMatchObject({ kind: "cluster", subtreeCount: 1, score: 4 });

    const articlesCluster = result.clusters.find((cluster) => cluster.path === "articles");
    expect(articlesCluster).toMatchObject({ kind: "cluster", subtreeCount: 3, score: 3 });
  });

  it("rolls nested qualifying dirs up to the shallowest kept ancestor", async () => {
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      "docs/api/two.md": "# Two\n",
      "docs/api/three.md": "# Three\n",
      "docs/api/four.md": "# Four\n"
    });

    const result = await scanRepository({ cwd: root });
    const clusterPaths = result.clusters
      .filter((cluster) => cluster.kind === "cluster")
      .map((cluster) => cluster.path);

    expect(clusterPaths).toEqual(["docs"]);
    const docsCluster = result.clusters.find((cluster) => cluster.path === "docs");
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
    const rootEntry = result.clusters.find((cluster) => cluster.kind === "root");
    expect(rootEntry?.subtreeCount).toBe(10);

    const rootIndex = result.clusters.findIndex((cluster) => cluster.kind === "root");
    const clusterIndex = result.clusters.findIndex((cluster) => cluster.kind === "cluster");
    expect(rootIndex).toBeGreaterThan(clusterIndex);
  });

  it("falls back to **/*.md when nothing qualifies but Markdown exists somewhere", async () => {
    const root = await createFixtureTree({
      "leaf1/a.md": "# A\n",
      "leaf2/b.md": "# B\n",
      "leaf3/c.md": "# C\n"
    });

    const result = await scanRepository({ cwd: root });

    expect(result.clusters).toEqual([
      {
        path: "",
        kind: "fallback",
        score: 3,
        subtreeCount: 3,
        includeGlob: "**/*.md",
        sampleFiles: ["leaf1/a.md", "leaf2/b.md", "leaf3/c.md"]
      }
    ]);
  });

  it("keeps the literal **/*.md fallback (mirroring the tool's default) even when only .mdx files exist", async () => {
    const root = await createFixtureTree({
      "leaf1/a.mdx": "# A\n",
      "leaf2/b.mdx": "# B\n"
    });

    const result = await scanRepository({ cwd: root });

    expect(result.clusters).toEqual([
      {
        path: "",
        kind: "fallback",
        score: 2,
        subtreeCount: 2,
        includeGlob: "**/*.md",
        sampleFiles: ["leaf1/a.mdx", "leaf2/b.mdx"]
      }
    ]);

    // Known, accepted tradeoff: the fallback proposes the tool's actual zero-config default
    // (`.md` only), not a scan-specific glob, so it honestly loads nothing when the discovered
    // corpus is `.mdx`-only — the proposal is a starting point for `init`, not a guarantee.
    const documents = await loadDocuments([result.clusters[0].includeGlob], { cwd: root });
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
      "node_modules/foo/d.md": "# D\n"
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
      "docs/two.md": "# Two\n"
    });

    const result = await scanRepository({ cwd: root });

    const fooDocs = result.clusters.find((cluster) => cluster.path === "packages/foo/docs");
    expect(fooDocs).toMatchObject({ kind: "cluster", workspacePackage: "packages/foo" });

    const fooRoot = result.clusters.find(
      (cluster) => cluster.kind === "root" && cluster.workspacePackage === "packages/foo"
    );
    expect(fooRoot).toMatchObject({ path: "packages/foo", subtreeCount: 1 });

    const rootDocs = result.clusters.find((cluster) => cluster.path === "docs");
    expect(rootDocs).toMatchObject({ kind: "cluster" });
    expect(rootDocs).not.toHaveProperty("workspacePackage");

    // No entry should re-surface the package's files under the repo-root scope.
    expect(
      result.clusters.some(
        (cluster) => cluster.workspacePackage === undefined && cluster.kind === "root"
      )
    ).toBe(false);

    expect(result.workspacePackages).toEqual([{ path: "packages/foo", name: "foo" }]);
  });

  it("emits a root-only includeGlob that round-trips through matchesConfigGlob/loadDocuments", async () => {
    const root = await createFixtureTree({
      "README.md": "# Readme\n",
      "docs/one.md": "# One\n"
    });

    const result = await scanRepository({ cwd: root });
    const rootEntry = result.clusters.find((cluster) => cluster.kind === "root");
    expect(rootEntry).toBeDefined();

    // Config globs without a "/" get rewritten to `**/pattern` by normalizeConfigGlob, so a
    // naive "*.{md,mdx}" root proposal would silently expand to every Markdown file once fed
    // through the real config pipeline. Prove the emitted pattern stays root-only end to end.
    const patterns = rootEntry === undefined ? [] : [rootEntry.includeGlob];
    expect(matchesConfigGlob("README.md", patterns)).toBe(true);
    expect(matchesConfigGlob("docs/one.md", patterns)).toBe(false);

    const documents = await loadDocuments(patterns, { cwd: root });
    expect([...documents.values()].map((doc) => doc.path)).toEqual(["README.md"]);
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
      "appsweb/a.md": "# Decoy\n"
    });

    const result = await scanRepository({ cwd: root });

    const bracketCluster = result.clusters.find((cluster) => cluster.path === "docs[x]");
    expect(bracketCluster).toBeDefined();
    const bracketPatterns = bracketCluster === undefined ? [] : [bracketCluster.includeGlob];
    expect(matchesConfigGlob("docs[x]/a.md", bracketPatterns)).toBe(true);
    expect(matchesConfigGlob("docsx/a.md", bracketPatterns)).toBe(false);
    const bracketDocuments = await loadDocuments(bracketPatterns, { cwd: root });
    expect([...bracketDocuments.values()].map((doc) => doc.path)).toEqual([
      "docs[x]/a.md",
      "docs[x]/b.md",
      "docs[x]/c.md"
    ]);

    const parenCluster = result.clusters.find((cluster) => cluster.path === "apps(web)");
    expect(parenCluster).toBeDefined();
    const parenPatterns = parenCluster === undefined ? [] : [parenCluster.includeGlob];
    expect(matchesConfigGlob("apps(web)/a.md", parenPatterns)).toBe(true);
    expect(matchesConfigGlob("appsweb/a.md", parenPatterns)).toBe(false);
    const parenDocuments = await loadDocuments(parenPatterns, { cwd: root });
    expect([...parenDocuments.values()].map((doc) => doc.path)).toEqual([
      "apps(web)/a.md",
      "apps(web)/b.md",
      "apps(web)/c.md"
    ]);
  });

  it("owns each Markdown file by exactly one scope when a workspace package nests inside another", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ workspaces: ["packages/*", "packages/foo/examples/*"] }),
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/foo/docs/one.md": "# One\n",
      "packages/foo/examples/bar/package.json": JSON.stringify({ name: "bar" }),
      "packages/foo/examples/bar/docs/nested.md": "# Nested\n"
    });

    const result = await scanRepository({ cwd: root });

    expect(result.workspacePackages).toEqual([
      { path: "packages/foo", name: "foo" },
      { path: "packages/foo/examples/bar", name: "bar" }
    ]);

    const fooDocs = result.clusters.find((cluster) => cluster.path === "packages/foo/docs");
    expect(fooDocs).toMatchObject({
      workspacePackage: "packages/foo",
      subtreeCount: 1,
      sampleFiles: ["packages/foo/docs/one.md"]
    });

    const barDocs = result.clusters.find(
      (cluster) => cluster.path === "packages/foo/examples/bar/docs"
    );
    expect(barDocs).toMatchObject({
      workspacePackage: "packages/foo/examples/bar",
      subtreeCount: 1,
      sampleFiles: ["packages/foo/examples/bar/docs/nested.md"]
    });

    // The nested package's file must not also appear under its ancestor's cluster.
    expect(fooDocs?.sampleFiles).not.toContain("packages/foo/examples/bar/docs/nested.md");
  });

  it("threads a custom noiseDirNames into workspace-package detection, not just Markdown collection", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/foo/docs/one.md": "# One\n"
    });

    const withDefaultNoise = await scanRepository({ cwd: root });
    expect(withDefaultNoise.workspacePackages).toEqual([{ path: "packages/foo", name: "foo" }]);

    // A caller pruning "packages" from scan noise must have that respected by workspace
    // detection too — not just the Markdown walk.
    const withCustomNoise = await scanRepository({
      cwd: root,
      noiseDirNames: [...DEFAULT_NOISE_DIR_NAMES, "packages"]
    });
    expect(withCustomNoise.workspacePackages).toEqual([]);
  });

  it("honors a custom sampleSize and returns sorted sample files", async () => {
    const root = await createFixtureTree({
      "docs/z.md": "# Z\n",
      "docs/a.md": "# A\n",
      "docs/m.md": "# M\n"
    });

    const result = await scanRepository({ cwd: root, sampleSize: 2 });
    const docsCluster = result.clusters.find((cluster) => cluster.path === "docs");

    expect(docsCluster?.sampleFiles).toEqual(["docs/a.md", "docs/m.md"]);
  });

  it("returns an empty result for a non-existent cwd without throwing", async () => {
    const missing = path.join(os.tmpdir(), "wastech-mdlint-scan-does-not-exist-xyz");
    const result = await scanRepository({ cwd: missing });

    expect(result).toEqual({ clusters: [], packageManager: undefined, workspacePackages: [] });
  });

  it("is deterministic across repeated scans of the same fixture tree", async () => {
    const root = await createFixtureTree({
      "docs/one.md": "# One\n",
      "docs/api/two.md": "# Two\n",
      "docs/api/three.md": "# Three\n",
      "README.md": "# Readme\n",
      "package-lock.json": "{}"
    });

    const first = await scanRepository({ cwd: root });
    const second = await scanRepository({ cwd: root });

    expect(first).toEqual(second);
  });
});
