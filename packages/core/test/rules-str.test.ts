import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { RuleResolutionError } from "../src/engine/registry.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-str-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

function rule(id: string, options?: unknown): ConfiguredRule {
  return { rule: ruleRegistry.resolveRule(id, options) };
}

async function lint(cwd: string, rules: ConfiguredRule[]) {
  return lintFiles({ cwd, config: { rules: [] }, rules, settings: {} });
}

describe("STR-001 required files", () => {
  it("reports nothing when every required file (including a glob) is present", async () => {
    const cwd = await fixtureRepo({
      "README.md": "# Readme\n",
      "docs/guide.md": "# Guide\n",
    });
    const result = await lint(cwd, [
      rule("STR-001", { files: ["README.md", "docs/*.md"] }),
    ]);
    expect(result.messages).toEqual([]);
  });

  it("flags each missing required file independently", async () => {
    const cwd = await fixtureRepo({ "README.md": "# Readme\n" });
    const result = await lint(cwd, [
      rule("STR-001", {
        files: ["README.md", "CONTRIBUTING.md", "LICENSE.md"],
      }),
    ]);
    expect(result.messages.map((message) => message.data?.required)).toEqual([
      "CONTRIBUTING.md",
      "LICENSE.md",
    ]);
  });

  it("satisfies a present non-Markdown required file from disk", async () => {
    // The regression: `LICENSE` and `package.json` can never enter a `**/*.md` corpus, so before
    // the disk probe, this reported both as missing on a fully compliant repository.
    const cwd = await fixtureRepo({
      "README.md": "# Readme\n",
      LICENSE: "MIT\n",
      "package.json": '{ "name": "fixture" }\n',
    });
    const result = await lint(cwd, [
      rule("STR-001", { files: ["README.md", "LICENSE", "package.json"] }),
    ]);
    expect(result.messages).toEqual([]);
  });

  it("pins a literal entry to the repository root, with `**/` as the opt-out", async () => {
    const cwd = await fixtureRepo({ "docs/nested/README.md": "# Nested\n" });

    const literal = await lint(cwd, [
      rule("STR-001", { files: ["README.md"] }),
    ]);
    expect(literal.messages.map((message) => message.data?.required)).toEqual([
      "README.md",
    ]);

    const glob = await lint(cwd, [
      rule("STR-001", { files: ["**/README.md"] }),
    ]);
    expect(glob.messages).toEqual([]);
  });

  it("keeps glob entries corpus-scoped — a non-Markdown match on disk is still missing", async () => {
    const cwd = await fixtureRepo({
      "README.md": "# Readme\n",
      "assets/logo.png": "not really a png\n",
    });
    const result = await lint(cwd, [
      rule("STR-001", { files: ["assets/*.png"] }),
    ]);
    expect(result.messages.map((message) => message.data?.required)).toEqual([
      "assets/*.png",
    ]);
  });

  it("satisfies a literal entry that names a directory", async () => {
    const cwd = await fixtureRepo({ "docs/guide.md": "# Guide\n" });
    const result = await lint(cwd, [rule("STR-001", { files: ["docs"] })]);
    expect(result.messages).toEqual([]);
  });

  it("rejects an absolute required path instead of probing it", async () => {
    // Same containment contract as SEC-003: the probe must not become an existence
    // oracle for arbitrary host paths, so this is rejected rather than answered.
    const outsideRoot = await fixtureRepo({ "secret.txt": "top secret\n" });
    const cwd = await fixtureRepo({ "README.md": "# Readme\n" });

    const result = await lint(cwd, [
      rule("STR-001", { files: [path.join(outsideRoot, "secret.txt")] }),
    ]);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message).toMatch(/escapes the analyzed root/);
  });

  it("rejects a `..`-escaping relative required path, including Windows-style separators", async () => {
    const outerRoot = await fixtureRepo({
      "secret.txt": "top secret\n",
      "project/README.md": "# Readme\n",
    });
    const cwd = path.join(outerRoot, "project");

    for (const entry of ["../secret.txt", "..\\secret.txt"]) {
      const result = await lint(cwd, [rule("STR-001", { files: [entry] })]);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.message).toMatch(/escapes the analyzed root/);
    }
  });

  // STR-001 is the one rule whose `files` is *not* the shared file-scope shape: it is the set of
  // files that must exist, so there is nothing for an `exclude` to subtract. Pinned as a rejection
  // rather than left implicit, so "every family has an exclude test" stays honest about the
  // family that has no such option.
  it("rejects `exclude`, because its `files` is a required-file set and not file scope", () => {
    let thrown: unknown;
    try {
      ruleRegistry.resolveRule("STR-001", {
        files: ["README.md"],
        exclude: ["drafts/**"],
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RuleResolutionError);
    expect((thrown as RuleResolutionError).code).toBe("INVALID_OPTIONS");
    expect(JSON.stringify((thrown as RuleResolutionError).issues)).toContain(
      "exclude",
    );
  });
});
