import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError } from "@wastech-mdlint/core";
import { afterAll, describe, expect, it } from "vitest";

import {
  resolveToolConfiguration,
  resolveToolContext,
  resolveToolCwd,
} from "../src/shared/tool-context.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(testDir, "fixtures/basic-project");
const srcDir = path.resolve(testDir, "../src");

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// The stdio suite is the acceptance evidence (an in-process call cannot see the plausible
// success shape being fixed); these pin the guard's own contract — code, hint, and the offending path
// in the message — without spawning a server for each case.
describe("resolveToolCwd", () => {
  async function rejectionOf(cwd: string): Promise<{
    code?: unknown;
    hint?: unknown;
    message?: unknown;
  }> {
    return (await resolveToolCwd({ cwd }).catch((error: unknown) => error)) as {
      code?: unknown;
      hint?: unknown;
      message?: unknown;
    };
  }

  it("returns the resolved absolute path for a real directory", async () => {
    expect(await resolveToolCwd({ cwd: fixtureDir })).toBe(fixtureDir);
  });

  it("falls back to the process cwd when no cwd is given", async () => {
    expect(await resolveToolCwd({})).toBe(path.resolve(process.cwd()));
  });

  it("rejects a nonexistent cwd with INVALID_INPUT naming the path", async () => {
    const parent = await makeTempDir("mcp-tc-cwd-missing-");
    const missing = path.join(parent, "no-such-directory");

    const error = await rejectionOf(missing);
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toContain(missing);
    expect(error.hint).toBeTruthy();
  });

  it("rejects a cwd that exists but is a file", async () => {
    const dir = await makeTempDir("mcp-tc-cwd-file-");
    const filePath = path.join(dir, "not-a-directory.md");
    await writeFile(filePath, "# Not a directory\n", "utf8");

    const error = await rejectionOf(filePath);
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toContain(filePath);
    expect(error.hint).toBeTruthy();
  });
});

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
    // The sixth `--config` call site: the behavior is unchanged, but the resolution moved.
    // This helper used to pre-resolve the path itself; now it forwards the caller's string verbatim
    // and core resolves it against the validated `cwd` — the same base the CLI's five handlers get.
    // The test process cwd is the repo root, not this temp dir, which is the only shape in which a
    // process-cwd base could be told apart from the tool one.
    const dir = await makeTempDir("mcp-tc-relconfig-");
    await writeFile(
      path.join(dir, "custom.config.json"),
      JSON.stringify({ include: ["**/*.md"], rules: [] }),
      "utf8",
    );

    const loaded = await resolveToolConfiguration({
      cwd: dir,
      configPath: "custom.config.json",
    });
    expect(loaded.configPath).toBe(path.join(dir, "custom.config.json"));
  });

  it("exposes the resolved cwd so callers need not recompute the default", async () => {
    const loaded = await resolveToolConfiguration({ cwd: fixtureDir });
    expect(loaded.cwd).toBe(fixtureDir);
  });

  it("reports a bad cwd rather than CONFIG_NOT_FOUND when both are wrong", async () => {
    // Ordering guard: the cwd check must run before `loadConfiguration`, or a configPath under a
    // nonexistent root names the wrong cause.
    const parent = await makeTempDir("mcp-tc-cwd-order-");
    const missing = path.join(parent, "no-such-directory");

    const error = (await resolveToolConfiguration({
      cwd: missing,
      configPath: "custom.config.json",
    }).catch((e: unknown) => e)) as { code?: unknown };
    expect(error.code).toBe("INVALID_INPUT");
  });

  it("propagates a structured ConfigError on invalid JSON", async () => {
    const dir = await makeTempDir("mcp-tc-invalid-");
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      "{ not valid ",
      "utf8",
    );

    const error = await resolveToolConfiguration({ cwd: dir }).catch(
      (e: unknown) => e,
    );
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

  it("carries the same resolved cwd rather than recomputing the fallback", async () => {
    // Pins the de-duplication: `resolveToolContext` reads the cwd `resolveToolConfiguration` already
    // validated instead of re-deriving `cwd ?? process.cwd()` on its own.
    const context = await resolveToolContext({ cwd: fixtureDir });
    expect(context.cwd).toBe(fixtureDir);
  });

  it("rejects a nonexistent cwd before building a graph over an empty corpus", async () => {
    const parent = await makeTempDir("mcp-tc-ctx-missing-");
    const error = (await resolveToolContext({
      cwd: path.join(parent, "no-such-directory"),
    }).catch((e: unknown) => e)) as { code?: unknown };
    expect(error.code).toBe("INVALID_INPUT");
  });
});

/**
 * The seventh-handler guard for MCP's half of single-base `--config` resolution.
 *
 * The CLI's five `--config` handlers are covered by a table derived from `--help`
 * (`packages/cli/test/config-resolution-base.test.ts`); a tool module cannot be enumerated that way,
 * so this pins the property instead: one call site means one resolution base. A future file-based
 * tool that calls `loadConfiguration` directly would silently reintroduce the divergence this task
 * removed — and would pass every behavioral test in this package, because each tool is tested
 * against its own handler. Reading source from a test follows the precedent of
 * `packages/core/test/boundary-guards.test.ts`.
 */
describe("loadConfiguration has exactly one MCP call site", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(full);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
    });
  }

  it("is called only from shared/tool-context.ts", () => {
    const callers = sourceFiles(srcDir)
      .filter((file) =>
        readFileSync(file, "utf8").includes("loadConfiguration("),
      )
      // POSIX-relative so the failure message reads the same on every host.
      .map((file) => path.relative(srcDir, file).split(path.sep).join("/"))
      .sort();

    expect(callers).toEqual(["shared/tool-context.ts"]);
  });
});
