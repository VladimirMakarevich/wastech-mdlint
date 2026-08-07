import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { detectPackageManager } from "../src/discovery/package-manager.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

/**
 * A fixture tree that is its own repository root: the `.git` marker bounds `detectPackageManager`'s
 * ancestor walk to the fixture. Without it the walk climbs out of `os.tmpdir()` to the filesystem
 * root, which would make every negative assertion here depend on host state rather than on the
 * fixture. Tests that need the walk to cross a boundary build their own nested roots below.
 */
async function createFixtureTree(
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-pm-"));
  tempDirs.push(root);
  await mkdir(path.join(root, ".git"));

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return root;
}

describe("detectPackageManager", () => {
  it("detects bun from bun.lock", async () => {
    const root = await createFixtureTree({ "bun.lock": "" });
    expect(await detectPackageManager(root)).toBe("bun");
  });

  it("detects bun from the legacy binary bun.lockb", async () => {
    const root = await createFixtureTree({ "bun.lockb": "" });
    expect(await detectPackageManager(root)).toBe("bun");
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    const root = await createFixtureTree({ "pnpm-lock.yaml": "" });
    expect(await detectPackageManager(root)).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", async () => {
    const root = await createFixtureTree({ "yarn.lock": "" });
    expect(await detectPackageManager(root)).toBe("yarn");
  });

  it("detects npm from package-lock.json", async () => {
    const root = await createFixtureTree({ "package-lock.json": "" });
    expect(await detectPackageManager(root)).toBe("npm");
  });

  it("returns undefined when no lockfile exists", async () => {
    const root = await createFixtureTree({ "package.json": "{}" });
    expect(await detectPackageManager(root)).toBeUndefined();
  });

  it("does not treat a directory named like a lockfile as a match", async () => {
    const root = await createFixtureTree({});
    await mkdir(path.join(root, "bun.lock"));
    expect(await detectPackageManager(root)).toBeUndefined();
  });

  it("falls through to a lower-priority lockfile when a higher-priority name is a directory", async () => {
    const root = await createFixtureTree({ "pnpm-lock.yaml": "" });
    await mkdir(path.join(root, "bun.lock"));
    expect(await detectPackageManager(root)).toBe("pnpm");
  });

  it("prefers bun > pnpm > yarn > npm when multiple lockfiles are present", async () => {
    const root = await createFixtureTree({
      "package-lock.json": "",
      "yarn.lock": "",
      "pnpm-lock.yaml": "",
      "bun.lock": "",
    });
    expect(await detectPackageManager(root)).toBe("bun");

    await rm(path.join(root, "bun.lock"));
    expect(await detectPackageManager(root)).toBe("pnpm");

    await rm(path.join(root, "pnpm-lock.yaml"));
    expect(await detectPackageManager(root)).toBe("yarn");

    await rm(path.join(root, "yarn.lock"));
    expect(await detectPackageManager(root)).toBe("npm");
  });
});

// An earlier check looked only at `cwd`, so a monorepo member — which by construction has
// no lockfile of its own — reported "not detected" and made `init` prompt for something it could
// have read off disk.
describe("detectPackageManager · ancestor walk", () => {
  it("finds a lockfile at an ancestor of the scanned directory", async () => {
    const root = await createFixtureTree({
      "pnpm-lock.yaml": "",
      "packages/foo/package.json": "{}",
    });

    expect(await detectPackageManager(path.join(root, "packages", "foo"))).toBe(
      "pnpm",
    );
  });

  it("prefers the nearest lockfile over a more distant ancestor's", async () => {
    // A nested project with its own lockfile is its own project, whatever the outer repo uses.
    const root = await createFixtureTree({
      "pnpm-lock.yaml": "",
      "examples/standalone/yarn.lock": "",
    });

    expect(
      await detectPackageManager(path.join(root, "examples", "standalone")),
    ).toBe("yarn");
  });

  it("stops at a repository root that has no lockfile", async () => {
    const root = await createFixtureTree({
      "outer/package-lock.json": "",
      "outer/repo/docs/guide.md": "# Guide\n",
    });
    await mkdir(path.join(root, "outer", "repo", ".git"));

    // `outer/`'s lockfile belongs to a different project: the walk must not climb past the `.git`
    // boundary to reach it.
    expect(
      await detectPackageManager(path.join(root, "outer", "repo", "docs")),
    ).toBeUndefined();
    // The boundary is not a blanket refusal — a lockfile at the repo root itself is still found.
    await writeFile(path.join(root, "outer", "repo", "bun.lock"), "", "utf8");
    expect(
      await detectPackageManager(path.join(root, "outer", "repo", "docs")),
    ).toBe("bun");
  });

  it("never attributes a lockfile at or above the home directory to the scanned project", async () => {
    const root = await createFixtureTree({
      "yarn.lock": "",
      "project/package.json": "{}",
    });
    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(root);

    try {
      expect(
        await detectPackageManager(path.join(root, "project")),
      ).toBeUndefined();
      // The boundary only rejects strict ancestors: a project rooted exactly at `$HOME` still
      // reports its own lockfile, matching findConfig's start-directory rule.
      expect(await detectPackageManager(root)).toBe("yarn");
    } finally {
      homedirSpy.mockRestore();
    }
  });
});
