import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectWorkspacePackages,
  detectWorkspacePackagesWithNoise
} from "../src/discovery/workspace-packages.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true }))
  );
});

async function createFixtureTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-ws-"));
  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return root;
}

describe("detectWorkspacePackages", () => {
  it("detects npm-style workspaces (string array)", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/core/package.json": JSON.stringify({ name: "@scope/core" }),
      "packages/cli/package.json": JSON.stringify({ name: "@scope/cli" })
    });

    const packages = await detectWorkspacePackages(root);
    expect(packages).toEqual([
      { path: "packages/cli", name: "@scope/cli" },
      { path: "packages/core", name: "@scope/core" }
    ]);
  });

  it("detects yarn-style workspaces (object form with packages key)", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ workspaces: { packages: ["apps/*"] } }),
      "apps/web/package.json": JSON.stringify({ name: "web" })
    });

    const packages = await detectWorkspacePackages(root);
    expect(packages).toEqual([{ path: "apps/web", name: "web" }]);
  });

  it("detects packages from pnpm-workspace.yaml when package.json has no workspaces key", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ name: "root" }),
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
      "packages/foo/package.json": JSON.stringify({ name: "foo" })
    });

    const packages = await detectWorkspacePackages(root);
    expect(packages).toEqual([{ path: "packages/foo", name: "foo" }]);
  });

  it("falls back to a sibling packages/* heuristic with no explicit declaration", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ name: "root" }),
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/bar/package.json": JSON.stringify({ name: "bar" })
    });

    const packages = await detectWorkspacePackages(root);
    expect(packages).toEqual([
      { path: "packages/bar", name: "bar" },
      { path: "packages/foo", name: "foo" }
    ]);
  });

  it("falls back to a sibling apps/* heuristic with no explicit declaration", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ name: "root" }),
      "apps/one/package.json": JSON.stringify({ name: "one" }),
      "apps/two/package.json": JSON.stringify({ name: "two" })
    });

    const packages = await detectWorkspacePackages(root);
    expect(packages).toEqual([
      { path: "apps/one", name: "one" },
      { path: "apps/two", name: "two" }
    ]);
  });

  it("does not treat a single stray package.json under packages/ as a monorepo", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ name: "root" }),
      "packages/only/package.json": JSON.stringify({ name: "only" })
    });

    expect(await detectWorkspacePackages(root)).toEqual([]);
  });

  it("returns [] for an ordinary single-package repo", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ name: "root" }),
      "src/index.ts": "export {};\n"
    });

    expect(await detectWorkspacePackages(root)).toEqual([]);
  });

  it("does not fall back to sibling detection when workspaces is explicitly an empty array", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ workspaces: [] }),
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/bar/package.json": JSON.stringify({ name: "bar" })
    });

    expect(await detectWorkspacePackages(root)).toEqual([]);
  });

  it("does not fall back to sibling detection when workspaces.packages is explicitly empty", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ workspaces: { packages: [] } }),
      "apps/one/package.json": JSON.stringify({ name: "one" }),
      "apps/two/package.json": JSON.stringify({ name: "two" })
    });

    expect(await detectWorkspacePackages(root)).toEqual([]);
  });

  it("detects packages from pnpm-workspace.yaml using unindented `- glob` list items", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ name: "root" }),
      "pnpm-workspace.yaml": "packages:\n- packages/*\n- apps/*\n",
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "apps/web/package.json": JSON.stringify({ name: "web" })
    });

    const packages = await detectWorkspacePackages(root);
    expect(packages).toEqual([
      { path: "apps/web", name: "web" },
      { path: "packages/foo", name: "foo" }
    ]);
  });

  it("detects packages from pnpm-workspace.yaml entries with trailing YAML comments", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ name: "root" }),
      "pnpm-workspace.yaml":
        "packages:\n  - 'packages/*' # workspace packages\n  - \"apps/*\"   # apps\n",
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "apps/web/package.json": JSON.stringify({ name: "web" })
    });

    const packages = await detectWorkspacePackages(root);
    expect(packages).toEqual([
      { path: "apps/web", name: "web" },
      { path: "packages/foo", name: "foo" }
    ]);
  });

  it("does not fall back to sibling detection when pnpm-workspace.yaml declares an empty packages block", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ name: "root" }),
      "pnpm-workspace.yaml": "packages:\n",
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/bar/package.json": JSON.stringify({ name: "bar" })
    });

    expect(await detectWorkspacePackages(root)).toEqual([]);
  });

  it("detectWorkspacePackagesWithNoise honors a custom noiseDirNames, pruning a package.json inside a caller-ignored directory", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/foo/package.json": JSON.stringify({ name: "foo" })
    });

    expect(await detectWorkspacePackages(root)).toEqual([{ path: "packages/foo", name: "foo" }]);
    expect(await detectWorkspacePackagesWithNoise(root, ["packages"])).toEqual([]);
  });

  it("honors an ordered negated glob from package.json#workspaces", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ workspaces: ["packages/*", "!packages/private"] }),
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/private/package.json": JSON.stringify({ name: "private" })
    });

    expect(await detectWorkspacePackages(root)).toEqual([{ path: "packages/foo", name: "foo" }]);
  });

  it("honors an ordered negated glob from pnpm-workspace.yaml", async () => {
    const root = await createFixtureTree({
      "package.json": JSON.stringify({ name: "root" }),
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - '!packages/private'\n",
      "packages/foo/package.json": JSON.stringify({ name: "foo" }),
      "packages/private/package.json": JSON.stringify({ name: "private" })
    });

    expect(await detectWorkspacePackages(root)).toEqual([{ path: "packages/foo", name: "foo" }]);
  });
});
