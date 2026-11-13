import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { compareStrings } from "../src/deterministic-sort.js";
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
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-fm-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

function rule(options?: unknown): ConfiguredRule {
  return { rule: ruleRegistry.resolveRule("FM-001", options) };
}

async function lint(cwd: string, rules: ConfiguredRule[]) {
  return lintFiles({ cwd, config: { rules: [] }, rules, settings: {} });
}

// Front matter on lines 1–5. It is missing `owner`, has a `status` outside the allowed set and an
// `id` that does not match its pattern — one violation of each configured check.
const VIOLATING = [
  "---",
  "status: bogus",
  "id: adr-7",
  "title: Example",
  "---",
  "",
  "# Example",
  "",
].join("\n");

const ALL_CHECKS = {
  required: ["owner", "title"],
  allowed: { status: ["proposed", "accepted"] },
  patterns: { id: "^ADR-\\d+$" },
};

describe("FM-001 front matter schema", () => {
  it("reports a missing key, a disallowed value and a pattern mismatch at the block's range", async () => {
    const cwd = await fixtureRepo({ "adr.md": VIOLATING });
    const result = await lint(cwd, [rule(ALL_CHECKS)]);

    expect(
      result.messages
        .map((message) => ({
          ruleId: message.ruleId,
          line: message.line,
          endLine: message.endLine,
          key: message.data?.key as string,
          severity: message.severity,
        }))
        .sort((left, right) => compareStrings(left.key, right.key)),
    ).toEqual(
      ["id", "owner", "status"].map((key) => ({
        ruleId: "FM-001",
        line: 1,
        endLine: 5,
        key,
        severity: "error",
      })),
    );
    expect(
      result.messages.map((message) => message.message).sort(compareStrings),
    ).toEqual([
      'Front matter is missing required key "owner".',
      'Front matter value "adr-7" for key "id" does not match ^ADR-\\d+$.',
      'Front matter value "bogus" for key "status" is not one of the allowed values: proposed, accepted.',
    ]);
  });

  it("passes a document that satisfies every check", async () => {
    const cwd = await fixtureRepo({
      "adr.md":
        "---\nowner: me\ntitle: T\nstatus: accepted\nid: ADR-7\n---\n\n# T\n",
    });

    expect((await lint(cwd, [rule(ALL_CHECKS)])).messages).toEqual([]);
  });

  it("reports invalid YAML as exactly one finding, however many checks are configured", async () => {
    const cwd = await fixtureRepo({
      "broken.md": "---\nstatus: [bogus\nid: x\n---\n\n# T\n",
      "fine.md": "---\nowner: me\ntitle: T\n---\n\n# T\n",
    });
    const result = await lint(cwd, [rule(ALL_CHECKS)]);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      ruleId: "FM-001",
      filePath: "broken.md",
    });
    expect(result.messages[0]?.message).toMatch(
      /^Front matter is not valid YAML: /u,
    );
  });

  it("checks validity on its own when given no options", async () => {
    const cwd = await fixtureRepo({
      "list.md": "---\n- a\n- b\n---\n\n# T\n",
      "dup.md": "---\na: 1\na: 2\n---\n\n# T\n",
      "fine.md": "---\na: 1\n---\n\n# T\n",
      "none.md": "# T\n",
    });
    const result = await lint(cwd, [rule()]);

    expect(
      result.messages.map((message) => [
        message.filePath,
        message.line,
        message.message,
      ]),
    ).toEqual([
      ["dup.md", 3, "Front matter is not valid YAML: Map keys must be unique."],
      ["list.md", 1, "Front matter must be a YAML mapping of keys to values."],
    ]);
  });

  it("reports a document without front matter only when keys are required", async () => {
    const cwd = await fixtureRepo({ "plain.md": "# T\n" });

    expect(
      (
        await lint(cwd, [
          rule({ allowed: ALL_CHECKS.allowed, patterns: ALL_CHECKS.patterns }),
        ])
      ).messages,
    ).toEqual([]);

    const required = await lint(cwd, [rule({ required: ["owner"] })]);
    expect(
      required.messages.map((message) => [message.line, message.message]),
    ).toEqual([
      [0, 'Document has no front matter; required key "owner" is missing.'],
    ]);
  });

  it("emits findings in the same order however the config object was written", async () => {
    const cwd = await fixtureRepo({
      "a.md": "---\nb: x\na: x\n---\n\n# T\n",
    });
    const forward = await lint(cwd, [
      rule({ allowed: { a: ["y"], b: ["y"] } }),
    ]);
    const reversed = await lint(cwd, [
      rule({ allowed: { b: ["y"], a: ["y"] } }),
    ]);

    expect(forward.messages.map((message) => message.data?.key)).toEqual([
      "a",
      "b",
    ]);
    expect(reversed.messages).toEqual(forward.messages);
  });
});

describe("FM-001 option schema", () => {
  function resolutionError(options: unknown): RuleResolutionError {
    let thrown: unknown;
    try {
      ruleRegistry.resolveRule("FM-001", options);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuleResolutionError);
    expect((thrown as RuleResolutionError).code).toBe("INVALID_OPTIONS");
    return thrown as RuleResolutionError;
  }

  it("rejects an invalid regex in `patterns` at config load", () => {
    resolutionError({ patterns: { id: "([" } });
  });

  it("rejects an unknown option key", () => {
    resolutionError({ requried: ["owner"] });
  });

  it("rejects an empty allowed set", () => {
    resolutionError({ allowed: { status: [] } });
  });
});

// The FM half of the shared `exclude` matrix: both documents violate the required key, so any
// document missing from the report was dropped by scoping and nothing else.
describe("FM file scope (exclude)", () => {
  async function reportedFiles(
    cwd: string,
    configured: ConfiguredRule,
  ): Promise<string[]> {
    const result = await lint(cwd, [configured]);
    return [
      ...new Set(result.messages.map((message) => message.filePath)),
    ].sort(compareStrings);
  }

  it("FM-001 drops an excluded document, with and without `files`", async () => {
    const cwd = await fixtureRepo({
      "docs/a.md": VIOLATING,
      "drafts/b.md": VIOLATING,
    });
    const options = { required: ["owner"] };

    expect(await reportedFiles(cwd, rule(options))).toEqual([
      "docs/a.md",
      "drafts/b.md",
    ]);
    // The unscoped shape — `exclude` with no `files` beside it to carry the filtering.
    expect(
      await reportedFiles(cwd, rule({ ...options, exclude: ["drafts/**"] })),
    ).toEqual(["docs/a.md"]);
    expect(
      await reportedFiles(
        cwd,
        rule({ ...options, files: ["**/*.md"], exclude: ["drafts/**"] }),
      ),
    ).toEqual(["docs/a.md"]);
  });
});
