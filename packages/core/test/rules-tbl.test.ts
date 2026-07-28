import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { applyEdits, applyFixes, FixWriteError } from "../src/engine/fix.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-tbl-"));
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

const TABLE = [
  "| ID | Owner | Status |",
  "| --- | --- | --- |",
  "| REQ-1 | Ann | open |",
  "| REQ-2 |  | bogus |",
].join("\n");

describe("TBL rules", () => {
  it("TBL-001 flags a missing required column (error)", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE });
    const result = await lint(cwd, [
      rule("TBL-001", { requiredColumns: ["ID", "Priority"] }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      ruleId: "TBL-001",
      severity: "error",
      data: { column: "Priority" },
    });
  });

  it("TBL-002 flags empty cells (warning) and honors column scoping", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE });
    const result = await lint(cwd, [rule("TBL-002", { columns: ["Owner"] })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      ruleId: "TBL-002",
      severity: "warning",
      line: 4,
      fixable: true,
    });
  });

  it("TBL-003 flags values outside the allowed set", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE });
    const result = await lint(cwd, [
      rule("TBL-003", { column: "Status", values: ["open", "done"] }),
    ]);
    expect(result.messages.map((message) => message.data?.value)).toEqual([
      "bogus",
    ]);
  });

  it("TBL-004 flags values failing the pattern", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE });
    const result = await lint(cwd, [
      rule("TBL-004", { column: "ID", pattern: "^BUG-" }),
    ]);
    expect(result.messages).toHaveLength(2);
  });

  it('TBL-004 is order-independent under a stateful "g" flag', async () => {
    const cwd = await fixtureRepo({
      "a.md": ["| ID |", "| --- |", "| REQ-1 |", "| REQ-2 |", "| BUG-1 |"].join(
        "\n",
      ),
    });
    const result = await lint(cwd, [
      rule("TBL-004", { column: "ID", pattern: "^REQ-\\d+$", flags: "g" }),
    ]);
    expect(result.messages.map((message) => message.data?.value)).toEqual([
      "BUG-1",
    ]);
  });

  it("TBL-005 enforces a cross-column conditional", async () => {
    const cwd = await fixtureRepo({
      "a.md": ["| Status | Resolution |", "| --- | --- |", "| done |  |"].join(
        "\n",
      ),
    });
    const result = await lint(cwd, [
      rule("TBL-005", {
        when: { column: "Status", equals: "done" },
        then: { column: "Resolution", notEmpty: true },
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.ruleId).toBe("TBL-005");
  });

  it("TBL-006 flags duplicate IDs across files (project)", async () => {
    const cwd = await fixtureRepo({
      "a.md": "| ID |\n| --- |\n| REQ-1 |\n",
      "b.md": "| ID |\n| --- |\n| REQ-1 |\n",
    });
    const result = await lint(cwd, [rule("TBL-006", { column: "ID" })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      ruleId: "TBL-006",
      filePath: "b.md",
      data: { firstSeenIn: "a.md" },
    });
  });

  it("TBL-006 honors an exclude-only scope (no files) without false duplicates", async () => {
    const cwd = await fixtureRepo({
      "a.md": "| ID |\n| --- |\n| REQ-1 |\n",
      "archive/old.md": "| ID |\n| --- |\n| REQ-1 |\n",
    });
    const result = await lint(cwd, [
      rule("TBL-006", { column: "ID", exclude: ["archive/**"] }),
    ]);
    expect(result.messages).toHaveLength(0);
  });

  it("TBL-006 honors the same exclude alongside an explicit files list", async () => {
    const cwd = await fixtureRepo({
      "a.md": "| ID |\n| --- |\n| REQ-1 |\n",
      "archive/old.md": "| ID |\n| --- |\n| REQ-1 |\n",
    });
    const result = await lint(cwd, [
      rule("TBL-006", {
        column: "ID",
        files: ["**/*.md"],
        exclude: ["archive/**"],
      }),
    ]);
    expect(result.messages).toHaveLength(0);
  });
});

// Audit L-4: the shared `files`/`exclude` shape had no end-to-end coverage on any document-scope
// rule, which is how M-2 shipped. Both fixture documents violate every case below, so the only
// variable across the three runs is the scope the rule was given.
const FILE_SCOPE_CASES: readonly { id: string; options: object }[] = [
  { id: "TBL-001", options: { requiredColumns: ["ID", "Priority"] } },
  { id: "TBL-002", options: { columns: ["Owner"] } },
  { id: "TBL-003", options: { column: "Status", values: ["open", "done"] } },
  { id: "TBL-004", options: { column: "ID", pattern: "^BUG-" } },
  {
    id: "TBL-005",
    options: {
      when: { column: "Status", equals: "bogus" },
      then: { column: "Owner", notEmpty: true },
    },
  },
];

describe("TBL file scope (exclude)", () => {
  // Distinct paths rather than the raw message list: these runs ask *which documents the rule
  // looked at*, and TBL-004 reports twice per file.
  async function reportedFiles(
    cwd: string,
    configured: ConfiguredRule,
  ): Promise<string[]> {
    const result = await lint(cwd, [configured]);
    return [
      ...new Set(result.messages.map((message) => message.filePath)),
    ].sort(compareStrings);
  }

  it.each(FILE_SCOPE_CASES)(
    "$id drops an excluded document, with and without `files`",
    async ({ id, options }) => {
      const cwd = await fixtureRepo({
        "docs/a.md": TABLE,
        "drafts/b.md": TABLE,
      });

      expect(await reportedFiles(cwd, rule(id, options))).toEqual([
        "docs/a.md",
        "drafts/b.md",
      ]);
      // The M-2 shape — `exclude` with no `files` beside it to carry the filtering.
      expect(
        await reportedFiles(
          cwd,
          rule(id, { ...options, exclude: ["drafts/**"] }),
        ),
      ).toEqual(["docs/a.md"]);
      expect(
        await reportedFiles(
          cwd,
          rule(id, { ...options, files: ["**/*.md"], exclude: ["drafts/**"] }),
        ),
      ).toEqual(["docs/a.md"]);
    },
  );
});

describe("TBL-002 --fix", () => {
  it("replaces empty cells with TODO and clears the finding on re-lint", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE });

    const before = await lint(cwd, [rule("TBL-002", { columns: ["Owner"] })]);
    expect(before.messages).toHaveLength(1);

    await applyFixes({
      cwd,
      config: { rules: [] },
      rules: [rule("TBL-002", { columns: ["Owner"] })],
      settings: {},
    });

    const written = await readFile(path.join(cwd, "a.md"), "utf8");
    expect(written).toContain("| REQ-2 | TODO | bogus |");

    const after = await lint(cwd, [rule("TBL-002", { columns: ["Owner"] })]);
    expect(after.messages).toEqual([]);
  });

  // The fix path has its own scope gate because `applyFixes` has none: it walks every loaded
  // document and calls each hook, so a hook that ignores `exclude` rewrites files the rule's own
  // `check` never looked at. Found while writing P12.01's `exclude` matrix.
  it("leaves an excluded file byte-unchanged on the --fix path", async () => {
    const cwd = await fixtureRepo({ "docs/a.md": TABLE, "drafts/b.md": TABLE });
    const scoped = rule("TBL-002", {
      columns: ["Owner"],
      exclude: ["drafts/**"],
    });

    const written = await applyFixes({
      cwd,
      config: { rules: [] },
      rules: [scoped],
      settings: {},
    });
    expect(written.fixedFiles).toEqual(["docs/a.md"]);

    await expect(
      readFile(path.join(cwd, "docs", "a.md"), "utf8"),
    ).resolves.toContain("| REQ-2 | TODO | bogus |");
    await expect(
      readFile(path.join(cwd, "drafts", "b.md"), "utf8"),
    ).resolves.toBe(TABLE);
  });

  // `emptyCellEdits` only ever edits *between* a row's pipes, so its offsets were already CRLF-safe
  // (`content.split("\n")` leaves the `\r` outside the cell range) — this pins that down so the
  // P11.09 newline normalization on the write path cannot regress it in the other direction.
  it("fills the cell without disturbing a CRLF document's line endings", async () => {
    const cwd = await fixtureRepo({ "a.md": TABLE.replace(/\n/g, "\r\n") });

    await applyFixes({
      cwd,
      config: { rules: [] },
      rules: [rule("TBL-002", { columns: ["Owner"] })],
      settings: {},
    });

    const written = await readFile(path.join(cwd, "a.md"), "utf8");
    expect(written).toBe(
      [
        "| ID | Owner | Status |",
        "| --- | --- | --- |",
        "| REQ-1 | Ann | open |",
        "| REQ-2 | TODO | bogus |",
      ].join("\r\n"),
    );
    expect(written.replace(/\r\n/g, "")).not.toContain("\n");
    expect(written).not.toContain("\r\r");
  });
});

// Root can write into a 0o555 directory, so the fault this relies on does not exist there; Windows
// has no equivalent directory-permission model.
describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "applyFixes write failures",
  () => {
    it("fails fast with a FixWriteError naming the unwritten file and the ones already fixed", async () => {
      const cwd = await fixtureRepo({ "a.md": TABLE, "sub/b.md": TABLE });
      const readOnlyDir = path.join(cwd, "sub");
      // `r-x` keeps `sub/b.md` readable (so it still enters the corpus) while making the temp write
      // inside `sub/` fail — the closest thing to a real mid-write fault without a fault injector.
      await chmod(readOnlyDir, 0o555);

      try {
        const failure = await applyFixes({
          cwd,
          config: { rules: [] },
          rules: [rule("TBL-002", { columns: ["Owner"] })],
          settings: {},
        }).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(FixWriteError);
        expect(failure).toMatchObject({
          filePath: "sub/b.md",
          fixedFiles: ["a.md"],
          errnoCode: "EACCES",
        });
        expect((failure as FixWriteError).message).toContain(
          "--fix could not write sub/b.md (EACCES); it is unchanged on disk.",
        );
        expect((failure as FixWriteError).message).toContain(
          "Already fixed: a.md.",
        );

        // The documents that did get written are committed; the failed one is byte-unchanged and has
        // no temp left beside it.
        await expect(
          readFile(path.join(cwd, "a.md"), "utf8"),
        ).resolves.toContain("| REQ-2 | TODO | bogus |");
        await expect(
          readFile(path.join(readOnlyDir, "b.md"), "utf8"),
        ).resolves.toBe(TABLE);
        await expect(readdir(readOnlyDir)).resolves.toEqual(["b.md"]);
      } finally {
        // Without this the shared afterEach `rm(..., { recursive: true })` fails with EACCES.
        await chmod(readOnlyDir, 0o755);
      }
    });
  },
);

describe("applyEdits", () => {
  it("applies non-overlapping edits from the end and skips overlaps", () => {
    // Replace "bb" (2..4) and "d" (5..6); both non-overlapping.
    expect(
      applyEdits("aabbcd", [
        { start: 2, end: 4, newText: "XX" },
        { start: 5, end: 6, newText: "Y" },
      ]),
    ).toBe("aaXXcY");

    // Overlapping edits: the later-starting one wins, the overlapping earlier one is skipped.
    expect(
      applyEdits("aabbcd", [
        { start: 2, end: 5, newText: "Z" },
        { start: 3, end: 6, newText: "Q" },
      ]),
    ).toBe("aabQ");
  });
});
