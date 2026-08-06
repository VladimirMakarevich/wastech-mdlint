import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigError } from "../src/config/config-error.js";
import { loadConfiguration } from "../src/config/load-config.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { lintFiles } from "../src/engine/lint-files.js";
import type { Assertion } from "../src/engine/primitives/assert.js";
import { ASSERTION_TARGETS } from "../src/engine/primitives/assert.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-custom-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

async function lintWithConfig(cwd: string) {
  const loaded = await loadConfiguration({ cwd });
  return lintFiles({
    cwd,
    config: loaded.config,
    rules: loaded.rules,
    settings: loaded.settings,
  });
}

describe("declarative custom rule", () => {
  it("runs a document-scope custom rule from config (no rebuild)", async () => {
    const cwd = await repo({
      "docs/reqs.md": "| ID | Owner |\n| --- | --- |\n| REQ-1 |  |\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "REQ-OWNER",
            description: "Every requirement row must have an Owner",
            severity: "error",
            target: "table",
            options: {
              files: ["docs/**/*.md"],
              assert: { kind: "columnNotEmpty", column: "Owner" },
            },
          },
        ],
      }),
    });

    const result = await lintWithConfig(cwd);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      ruleId: "REQ-OWNER",
      severity: "error",
      filePath: "docs/reqs.md",
    });
  });

  it("runs a project-scope custom rule (columnUnique) from config", async () => {
    const cwd = await repo({
      "a.md": "| ID |\n| --- |\n| X-1 |\n",
      "b.md": "| ID |\n| --- |\n| X-1 |\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "UNIQUE-ID",
            options: { assert: { kind: "columnUnique", column: "ID" } },
          },
        ],
      }),
    });

    const result = await lintWithConfig(cwd);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      ruleId: "UNIQUE-ID",
      filePath: "b.md",
    });
  });

  it("rejects a custom id that shadows a built-in prefix (C7)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "REF-100",
            options: { assert: { kind: "allChecked" } },
          },
        ],
      }),
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(
      /reserved built-in prefix/,
    );
  });

  it("rejects a custom id that violates the namespaced grammar", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "nodash",
            options: { assert: { kind: "allChecked" } },
          },
        ],
      }),
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(/dash-separated/);
  });

  it("rejects an invalid assert shape via the primitive schema", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "REQ-X",
            options: {
              assert: { kind: "columnMatches", column: "C", pattern: "(" },
            },
          },
        ],
      }),
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(
      /valid regular expression/,
    );
  });

  it("rejects a target that does not match the assert kind, including the retired 'heading' target (P9.05)", async () => {
    const cwd = await repo({
      "a.md": "# A\n## B\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "ARCH-DEPS",
            target: "heading",
            options: { assert: { kind: "sectionPresent", sections: ["B"] } },
          },
        ],
      }),
    });

    await expect(loadConfiguration({ cwd })).rejects.toThrow(
      /target "heading" does not match assert kind "sectionPresent" \(expected "section"\)/,
    );
  });

  // Audit M-3: {"rule":"custom"} without `id` used to fall through the permissive standard
  // ruleEntrySchema and crash in resolveCustomRule's canonicalizeRuleId(undefined). These three
  // shapes must now surface as a structured CONFIG_INVALID, not a TypeError.
  it("rejects a custom entry missing id, options, and severity (C7, not a crash)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom" }],
      }),
    });

    const error = await loadConfiguration({ cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).message).toMatch(/config\.rules\[0\]/);
    expect((error as ConfigError).message).toMatch(
      /"id" and "options\.assert"/,
    );
  });

  it("rejects a custom entry with options but no id (C7, not a crash)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            options: { assert: { kind: "allChecked" } },
          },
        ],
      }),
    });

    const error = await loadConfiguration({ cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).message).toMatch(/config\.rules\[0\]/);
  });

  it("rejects a custom entry with severity but no id (C7, not a crash)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom", severity: "warning" }],
      }),
    });

    const error = await loadConfiguration({ cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).message).toMatch(/config\.rules\[0\]/);
  });

  it("rejects a custom entry with id but no options (still CONFIG_INVALID, not a new behavior)", async () => {
    const cwd = await repo({
      "a.md": "# A\n",
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [{ rule: "custom", id: "REQ-1" }],
      }),
    });

    const error = await loadConfiguration({ cwd }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).code).toBe("CONFIG_INVALID");
    expect((error as ConfigError).message).toMatch(/config\.rules\[0\]/);
  });
});

// One document that trips every assert kind at once, so the `exclude` matrix below varies only the
// scope. Duplicated verbatim into `docs/a.md` and `drafts/b.md`, which is also what gives
// `columnUnique` its cross-file duplicates.
const EVERY_ASSERT_DOC = [
  "## Usage",
  "",
  "| ID | Owner | Status | Resolution |",
  "| --- | --- | --- | --- |",
  "| REQ-1 | Ann | done |  |",
  "| bad-id |  | bogus | x |",
  "",
  "## Overview",
  "",
  "TODO",
  "",
  "## Tasks",
  "",
  "- [ ] finish",
  "",
  "[broken](nope.md)",
  "",
  "![missing](nope.png)",
  "",
].join("\n");

type CustomScopeCase = {
  assert: Assertion;
  // Documents reported on with no scope at all…
  control: string[];
  // …and under `exclude: ["drafts/**"]`, in either of its two shapes.
  scoped: string[];
};

const BOTH = ["docs/a.md", "drafts/b.md"];
const IN_SCOPE_ONLY = ["docs/a.md"];

// @boundary-guard shared-exclude
//
// The `satisfies Record<Assertion["kind"], …>` below documents the intended coverage contract, but
// it is NOT what enforces it: no tsconfig in this repo includes `test/**` (`packages/core/
// tsconfig.json` is `include: ["src/**/*.ts", …]`), so `npm run typecheck` never reads this file and
// a 14th assert kind would not fail it — the claim an earlier revision of this comment made
// (P12.06). The enforcement is the runtime key-set assertion in the describe block below; keep it
// there, and prefer runtime assertions for any future coverage guard written in a test file.
const CUSTOM_SCOPE_CASES = {
  requiredColumns: {
    assert: { kind: "requiredColumns", columns: ["Priority"] },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  columnNotEmpty: {
    assert: { kind: "columnNotEmpty", column: "Owner" },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  columnInSet: {
    assert: { kind: "columnInSet", column: "Status", values: ["done"] },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  columnMatches: {
    assert: { kind: "columnMatches", column: "ID", pattern: "^REQ-\\d+$" },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  // The project kind: duplicates only exist *between* the two files, so the second one carries the
  // finding and excluding it leaves nothing behind. This is the M-2 shape itself.
  columnUnique: {
    assert: { kind: "columnUnique", column: "ID" },
    control: ["drafts/b.md"],
    scoped: [],
  },
  crossColumn: {
    assert: {
      kind: "crossColumn",
      when: { column: "Status", equals: "done" },
      then: { column: "Resolution", notEmpty: true },
    },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  sectionPresent: {
    assert: { kind: "sectionPresent", sections: ["Summary"] },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  sectionOrder: {
    assert: { kind: "sectionOrder", order: ["Overview", "Usage"] },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  contentNotMatch: {
    assert: { kind: "contentNotMatch", pattern: "bogus" },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  noPlaceholders: {
    assert: { kind: "noPlaceholders" },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  allChecked: {
    assert: { kind: "allChecked" },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  linkResolves: {
    assert: { kind: "linkResolves" },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
  imageResolves: {
    assert: { kind: "imageResolves" },
    control: BOTH,
    scoped: IN_SCOPE_ONLY,
  },
} as const satisfies Record<Assertion["kind"], CustomScopeCase>;

// Audit L-4. The 12 document kinds share one gate (`custom.ts`, before `runAssertion`) while
// `columnUnique` has its own, threaded into the primitive as a `fileMatches` predicate — which is
// why the project kind is not redundant with TBL-006's coverage.
describe("custom rule file scope (exclude)", () => {
  // The real coverage guard (see the note on CUSTOM_SCOPE_CASES): a new assert kind added to
  // ASSERTION_TARGETS without an `exclude` case here fails this test, which — unlike the `satisfies`
  // — actually runs. Compared against ASSERTION_TARGETS rather than a hand-copied list so there is
  // one place to add a kind, and sorted on both sides so map-insertion order cannot affect it.
  it("covers every assert kind declared in ASSERTION_TARGETS", () => {
    expect(Object.keys(CUSTOM_SCOPE_CASES).sort(compareStrings)).toEqual(
      Object.keys(ASSERTION_TARGETS).sort(compareStrings),
    );
  });

  async function reportedFiles(
    assert: Assertion,
    scope: { files?: string[]; exclude?: string[] },
  ): Promise<string[]> {
    const cwd = await repo({
      "docs/a.md": EVERY_ASSERT_DOC,
      "drafts/b.md": EVERY_ASSERT_DOC,
      "wastech-mdlint.config.json": JSON.stringify({
        rules: [
          {
            rule: "custom",
            id: "SCOPE-CHECK",
            options: { ...scope, assert },
          },
        ],
      }),
    });
    const result = await lintWithConfig(cwd);
    return [
      ...new Set(result.messages.map((message) => message.filePath)),
    ].sort(compareStrings);
  }

  it.each(Object.entries(CUSTOM_SCOPE_CASES))(
    "%s drops an excluded document, with and without `files`",
    async (_kind, { assert, control, scoped }) => {
      expect(await reportedFiles(assert, {})).toEqual(control);
      // The M-2 shape — `exclude` with no `files` beside it to carry the filtering.
      expect(await reportedFiles(assert, { exclude: ["drafts/**"] })).toEqual(
        scoped,
      );
      expect(
        await reportedFiles(assert, {
          files: ["**/*.md"],
          exclude: ["drafts/**"],
        }),
      ).toEqual(scoped);
    },
  );

  // Two same-named keys at different levels, one of the easiest things to conflate:
  // `options.exclude` chooses which documents are scanned, `assert.exclude` which link targets are
  // skipped inside a scanned document. They must compose without either absorbing the other.
  it("composes options.exclude (source documents) with assert.exclude (link targets)", async () => {
    const files = {
      "docs/a.md": "[into drafts](../drafts/x.md)\n[plain](nope.md)\n",
      "drafts/b.md": "[out of drafts](../docs/missing.md)\n",
    };
    const run = async (scope: {
      exclude?: string[];
      assertExclude?: string[];
    }) => {
      const cwd = await repo({
        ...files,
        "wastech-mdlint.config.json": JSON.stringify({
          rules: [
            {
              rule: "custom",
              id: "SCOPE-CHECK",
              options: {
                exclude: scope.exclude,
                assert: { kind: "linkResolves", exclude: scope.assertExclude },
              },
            },
          ],
        }),
      });
      const result = await lintWithConfig(cwd);
      return result.messages
        .map((message) => `${message.filePath}:${String(message.data?.target)}`)
        .sort(compareStrings);
    };

    expect(await run({})).toEqual([
      "docs/a.md:../drafts/x.md",
      "docs/a.md:nope.md",
      "drafts/b.md:../docs/missing.md",
    ]);
    // Source filter only: the document written in `drafts/` is no longer scanned, but a link
    // *pointing* there is still checked.
    expect(await run({ exclude: ["drafts/**"] })).toEqual([
      "docs/a.md:../drafts/x.md",
      "docs/a.md:nope.md",
    ]);
    // Target filter only: both documents are scanned, but the target under `drafts/` is skipped.
    expect(await run({ assertExclude: ["drafts/**"] })).toEqual([
      "docs/a.md:nope.md",
      "drafts/b.md:../docs/missing.md",
    ]);
    expect(
      await run({ exclude: ["drafts/**"], assertExclude: ["drafts/**"] }),
    ).toEqual(["docs/a.md:nope.md"]);
  });

  // W-08 (P13.05): the custom dispatcher hands `assert.exclude` straight to the same `linkResolves`
  // primitive REF-001 uses, so the router branch dropping the option took this family with it —
  // the family where the option is most likely hand-written, and the half no test reached.
  it("honors assert.exclude on a root-relative target when a siteRouter is configured", async () => {
    const run = async (settings: unknown) => {
      const cwd = await repo({
        "docs/a.md": "[gen](/generated/x.md)\n",
        "wastech-mdlint.config.json": JSON.stringify({
          settings,
          rules: [
            {
              rule: "custom",
              id: "SCOPE-CHECK",
              options: {
                assert: { kind: "linkResolves", exclude: ["generated/**"] },
              },
            },
          ],
        }),
      });
      const result = await lintWithConfig(cwd);
      return result.messages.map((message) => String(message.data?.target));
    };

    expect(await run({})).toEqual([]);
    expect(await run({ siteRouter: {} })).toEqual([]);
  });
});
