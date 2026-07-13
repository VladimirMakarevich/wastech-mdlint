import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError } from "@wastech-mdlint/core";
import { afterAll, describe, expect, it } from "vitest";

import { resolveToolConfiguration, resolveToolContext } from "../src/shared/tool-context.js";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/basic-project"
);

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("resolveToolConfiguration", () => {
  it("loads a real config from the fixture dir", async () => {
    const loaded = await resolveToolConfiguration({ cwd: fixtureDir });
    expect(loaded.configPath).toBeDefined();
    expect(loaded.config.include).toEqual(["**/*.md"]);
  });

  it("falls back to the zero-config default in an empty dir", async () => {
    const dir = await makeTempDir("mcp-tc-empty-");
    const loaded = await resolveToolConfiguration({ cwd: dir });
    expect(loaded.configPath).toBeUndefined();
    expect(loaded.config.include).toEqual(["**/*.md"]);
  });

  it("resolves a relative configPath against the tool cwd, not the process cwd", async () => {
    // The test process cwd is the repo root, not this temp dir, so a relative configPath forwarded
    // unchanged would resolve against the wrong root and raise CONFIG_NOT_FOUND. The fix resolves it
    // against the tool cwd.
    const dir = await makeTempDir("mcp-tc-relconfig-");
    await writeFile(
      path.join(dir, "custom.config.json"),
      JSON.stringify({ include: ["**/*.md"], rules: [] }),
      "utf8"
    );

    const loaded = await resolveToolConfiguration({ cwd: dir, configPath: "custom.config.json" });
    expect(loaded.configPath).toBe(path.join(dir, "custom.config.json"));
  });

  it("propagates a structured ConfigError on invalid JSON", async () => {
    const dir = await makeTempDir("mcp-tc-invalid-");
    await writeFile(path.join(dir, "wastech-mdlint.config.json"), "{ not valid ", "utf8");

    const error = await resolveToolConfiguration({ cwd: dir }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
  });
});

describe("resolveToolContext", () => {
  it("returns a flattened config + graph context over a real corpus", async () => {
    const context = await resolveToolContext({ cwd: fixtureDir });
    // Graph fields live at the top level (no nested { context }): the two linked fixtures give a
    // non-empty document set and graph.
    expect(context.config.include).toEqual(["**/*.md"]);
    expect(context.documents.size).toBe(2);
    expect(context.graph.nodes.length).toBe(2);
  });
});
