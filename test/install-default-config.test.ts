import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { copyDefaultConfigIfMissing } from "../scripts/install-default-config.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (tempDir) => {
      const fs = await import("node:fs/promises");
      await fs.rm(tempDir, { recursive: true, force: true });
    })
  );
});

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-install-"));
  tempDirs.push(tempDir);
  return tempDir;
}

describe("copyDefaultConfigIfMissing", () => {
  it("copies the default config when the destination does not exist", async () => {
    const sourceDir = await createTempDir();
    const destinationDir = await createTempDir();
    const sourcePath = path.join(sourceDir, "wastech-mdlint.config.json");
    const destinationPath = path.join(destinationDir, "wastech-mdlint.config.json");

    await writeFile(sourcePath, "{\"structure\":{\"orphanDocs\":\"warning\"}}\n", "utf8");

    const result = await copyDefaultConfigIfMissing({
      sourcePath,
      destinationPath
    });

    expect(result).toEqual({
      copied: true,
      destinationPath
    });
    expect(await readFile(destinationPath, "utf8")).toBe(
      "{\"structure\":{\"orphanDocs\":\"warning\"}}\n"
    );
  });

  it("does not overwrite an existing destination config", async () => {
    const sourceDir = await createTempDir();
    const destinationDir = await createTempDir();
    const sourcePath = path.join(sourceDir, "wastech-mdlint.config.json");
    const destinationPath = path.join(destinationDir, "wastech-mdlint.config.json");

    await writeFile(sourcePath, "{\"structure\":{\"orphanDocs\":\"warning\"}}\n", "utf8");
    await writeFile(destinationPath, "{\"structure\":{\"orphanDocs\":\"off\"}}\n", "utf8");

    const result = await copyDefaultConfigIfMissing({
      sourcePath,
      destinationPath
    });

    expect(result).toEqual({
      copied: false,
      destinationPath
    });
    expect(await readFile(destinationPath, "utf8")).toBe(
      "{\"structure\":{\"orphanDocs\":\"off\"}}\n"
    );
  });
});
