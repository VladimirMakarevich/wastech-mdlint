import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config/load.js";

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
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-ctxlint-config-"));
  tempDirs.push(tempDir);
  return tempDir;
}

describe("loadConfig", () => {
  it("loads defaults when no config file exists", async () => {
    const repoRoot = await createTempRepo();

    const loaded = await loadConfig({ rootPath: repoRoot });

    expect(loaded.configPath).toBeUndefined();
    expect(loaded.config.include).toEqual(["**/*.md"]);
    expect(loaded.config.structure.orphanDocs).toBe("error");
  });

  it("prefers an explicit config path over discovered files", async () => {
    const repoRoot = await createTempRepo();
    const discoveredConfigPath = path.join(repoRoot, "wastech-ctxlint.config.json");
    const explicitConfigPath = path.join(repoRoot, "custom-config.json");

    await writeFile(discoveredConfigPath, JSON.stringify({ include: ["docs/**/*.md"] }), "utf8");
    await writeFile(explicitConfigPath, JSON.stringify({ include: ["guides/**/*.md"] }), "utf8");

    const loaded = await loadConfig({
      rootPath: repoRoot,
      explicitConfigPath
    });

    expect(loaded.configPath).toBe(explicitConfigPath);
    expect(loaded.config.include).toEqual(["guides/**/*.md"]);
  });

  it("loads json config files", async () => {
    const repoRoot = await createTempRepo();
    const configPath = path.join(repoRoot, "wastech-ctxlint.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        links: {
          ignorePatterns: ["https://localhost/**"]
        }
      }),
      "utf8"
    );

    const loaded = await loadConfig({ rootPath: repoRoot });

    expect(loaded.configPath).toBe(configPath);
    expect(loaded.config.links.ignorePatterns).toEqual(["https://localhost/**"]);
  });

  it("loads cjs config files", async () => {
    const repoRoot = await createTempRepo();
    const configPath = path.join(repoRoot, "wastech-ctxlint.config.cjs");

    await writeFile(
      configPath,
      "module.exports = { llm: { maxTokensPerEntrypoint: 7000 } };\n",
      "utf8"
    );

    const loaded = await loadConfig({ rootPath: repoRoot });

    expect(loaded.configPath).toBe(configPath);
    expect(loaded.config.llm.maxTokensPerEntrypoint).toBe(7000);
  });

  it("loads mjs config files", async () => {
    const repoRoot = await createTempRepo();
    const configPath = path.join(repoRoot, "wastech-ctxlint.config.mjs");

    await writeFile(
      configPath,
      "export default { size: { maxBytesDefault: 1024 } };\n",
      "utf8"
    );

    const loaded = await loadConfig({ rootPath: repoRoot });

    expect(loaded.configPath).toBe(configPath);
    expect(loaded.config.size.maxBytesDefault).toBe(1024);
  });

  it("replaces arrays instead of merging them", async () => {
    const repoRoot = await createTempRepo();
    const configPath = path.join(repoRoot, "wastech-ctxlint.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        structure: {
          orphanExemptions: ["docs/index.md"]
        }
      }),
      "utf8"
    );

    const loaded = await loadConfig({ rootPath: repoRoot });

    expect(loaded.config.structure.orphanExemptions).toEqual(["docs/index.md"]);
  });

  it("deep merges nested objects", async () => {
    const repoRoot = await createTempRepo();
    const configPath = path.join(repoRoot, "wastech-ctxlint.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        llm: {
          maxTokensPerEntrypoint: 9000
        }
      }),
      "utf8"
    );

    const loaded = await loadConfig({ rootPath: repoRoot });

    expect(loaded.config.llm.maxTokensPerEntrypoint).toBe(9000);
    expect(loaded.config.llm.entrypoints).toEqual([
      "CLAUDE.md",
      "AGENTS.md",
      "skills/**/SKILL.md"
    ]);
  });

  it("rejects unknown top-level keys", async () => {
    const repoRoot = await createTempRepo();
    const configPath = path.join(repoRoot, "wastech-ctxlint.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        unknownTopLevelKey: true
      }),
      "utf8"
    );

    await expect(loadConfig({ rootPath: repoRoot })).rejects.toThrowError(ConfigError);
  });

  it("rejects invalid types", async () => {
    const repoRoot = await createTempRepo();
    const configPath = path.join(repoRoot, "wastech-ctxlint.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        links: {
          checkExternal: "false"
        }
      }),
      "utf8"
    );

    await expect(loadConfig({ rootPath: repoRoot })).rejects.toThrowError(ConfigError);
  });

  it("allows only specific orphan severities", async () => {
    const repoRoot = await createTempRepo();
    const configPath = path.join(repoRoot, "wastech-ctxlint.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        structure: {
          orphanDocs: "fatal"
        }
      }),
      "utf8"
    );

    await expect(loadConfig({ rootPath: repoRoot })).rejects.toThrowError(ConfigError);
  });

  it("fails for an explicit missing config file", async () => {
    const repoRoot = await createTempRepo();
    const missingConfigPath = path.join(repoRoot, "missing-config.json");

    await expect(
      loadConfig({
        rootPath: repoRoot,
        explicitConfigPath: missingConfigPath
      })
    ).rejects.toThrowError(new ConfigError(`Config file not found: ${missingConfigPath}`));
  });

  it("rejects explicit ts config files in v1", async () => {
    const repoRoot = await createTempRepo();
    const configPath = path.join(repoRoot, "wastech-ctxlint.config.ts");

    await writeFile(configPath, "export default {};\n", "utf8");

    await expect(
      loadConfig({
        rootPath: repoRoot,
        explicitConfigPath: configPath
      })
    ).rejects.toThrowError(ConfigError);
  });

  it("accepts requiredSections for compatibility", async () => {
    const repoRoot = await createTempRepo();
    const configPath = path.join(repoRoot, "wastech-ctxlint.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        structure: {
          requiredSections: [
            {
              pattern: "CLAUDE.md",
              slugs: ["overview"]
            }
          ]
        }
      }),
      "utf8"
    );

    const loaded = await loadConfig({ rootPath: repoRoot });

    expect(loaded.config.structure.requiredSections).toEqual([
      {
        pattern: "CLAUDE.md",
        slugs: ["overview"]
      }
    ]);
  });

  it("supports explicit Windows-like absolute config paths", async () => {
    const repoRoot = await createTempRepo();
    const windowsRoot = path.join(repoRoot, "C-drive", "repo");
    const configPath = path.join(windowsRoot, "wastech-ctxlint.config.mjs");

    await mkdir(windowsRoot, { recursive: true });
    await writeFile(configPath, "export default { include: ['docs/**/*.md'] };\n", "utf8");

    const loaded = await loadConfig({
      rootPath: repoRoot,
      explicitConfigPath: configPath
    });

    expect(loaded.configPath).toBe(configPath);
    expect(loaded.config.include).toEqual(["docs/**/*.md"]);
  });
});
