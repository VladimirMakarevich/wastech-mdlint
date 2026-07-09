import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectPackageManager } from "../src/discovery/package-manager.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true }))
  );
});

async function createFixtureTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-pm-"));
  tempDirs.push(root);

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
      "bun.lock": ""
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
