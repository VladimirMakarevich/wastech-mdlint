import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LintMessage } from "@wastech-mdlint/core";
import { afterEach, describe, expect, it } from "vitest";

import { handleLint } from "../src/tools/lint.js";
import {
  lintMessagesAsRows,
  readLintFindingLines,
  readLintSummaryLine,
} from "../../core/test/support/output-parity.js";

// P7.02 exercises the computational layer (`handleLint`) directly — wire-level McpServer testing is
// deferred to P7.05 — so these assert the structured output / error contract without a transport.

function structured(
  result: ReturnType<typeof handleLint>,
): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("handleLint", () => {
  it("returns structured findings and a text summary for a firing rule", () => {
    const result = handleLint({
      content: "# Title\n\nsome body\nmore body\n",
      rules: [{ rule: "SIZE-001", options: { lines: { error: 1 } } }],
    });

    expect(result.isError).toBeFalsy();
    const output = structured(result);
    const messages = output.messages as LintMessage[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.ruleId).toBe("SIZE-001");
    expect(messages[0]!.severity).toBe("error");
    expect(output.errorCount).toBe(1);
    expect(output.warningCount).toBe(0);
    expect((result.content[0] as { text: string }).text).toContain("SIZE-001");
  });

  // W-24: the two lint tools return deliberately different documents, and the divergence was found
  // twice by inspection without either pass noticing. Pinned by test on both tools so the difference
  // is a decision the guide's host table states, not a drift a third reader re-discovers.
  it("returns the narrower ad-hoc shape: no `files` list, counts at the top level", () => {
    const result = handleLint({
      content: "# Title\n\nsome body\nmore body\n",
      rules: [{ rule: "SIZE-001", options: { lines: { error: 1 } } }],
    });

    // An ad-hoc document is not a corpus, so `files` is absent here where `lint-files` carries it.
    expect(Object.keys(structured(result)).sort()).toEqual([
      "errorCount",
      "messages",
      "warningCount",
    ]);
  });

  // @boundary-guard host-parity
  //
  // W-57 / P16.01 §5, on the ad-hoc tool: the text block must render exactly the messages
  // `structuredContent` carries. Worth its own assertion rather than inheriting `lint-files`' — this
  // tool builds a narrower structured document (no `files`) from the same `LintResult`, and dropping a
  // field on the way out is precisely the class of defect the reading passes kept missing.
  it("renders its own structured messages in the text block", () => {
    const result = handleLint({
      // Both the `-` and the `line:column` branches of the human formatter, plus both severities.
      content: "# Title\n\n[broken](does-not-exist-here.md)\n\nmore\nlines\n",
      rules: [
        { rule: "REF-001" },
        { rule: "SIZE-001", options: { lines: { warn: 2 } } },
      ],
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    const output = structured(result);
    const rows = readLintFindingLines(text);

    expect(rows).toEqual(lintMessagesAsRows(output.messages as LintMessage[]));
    expect(rows.map((row) => row.location).sort()).toEqual(["-", "3:1"]);
    // Every row is attributed to the synthetic path, which is the only file name a caller of this tool
    // ever sees in either document.
    expect([...new Set(rows.map((row) => row.filePath))]).toEqual([
      "content.md",
    ]);
    expect(readLintSummaryLine(text)).toEqual({
      total: (output.errorCount as number) + (output.warningCount as number),
      errors: output.errorCount as number,
      warnings: output.warningCount as number,
    });
  });

  // W-35: `helpUri` crosses the wire schema, so the value change from a bare rule id to a URL is
  // caller-visible. Asserted at the tool boundary, not only in core.
  it("crosses `helpUri` as a documentation URL, not a rule id", () => {
    const result = handleLint({
      content: "# Title\n\nsome body\nmore body\n",
      rules: [{ rule: "SIZE-001", options: { lines: { error: 1 } } }],
    });

    const messages = structured(result).messages as LintMessage[];
    expect(messages[0]!.helpUri).toBe(
      "https://github.com/VladimirMakarevich/wastech-mdlint/blob/main/docs/guide/rules/SIZE-001.md",
    );
  });

  it("filters a rule requested with severity `off` after resolving it", () => {
    const result = handleLint({
      content: "# Title\n\nsome body\nmore body\n",
      rules: [
        { rule: "SIZE-001", severity: "off", options: { lines: { error: 1 } } },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(structured(result).messages as LintMessage[]).toHaveLength(0);
  });

  it("maps an unknown rule id to INVALID_INPUT with a suggestion", () => {
    const result = handleLint({
      content: "# Title\n",
      rules: [{ rule: "SIZE-002" }],
    });

    expect(result.isError).toBe(true);
    const output = structured(result);
    expect(output.code).toBe("INVALID_INPUT");
    expect(output.hint).toContain("SIZE-001");
  });

  // W-19/P14.05. The text block is what a host renders and what a model reads, so dropping the
  // did-you-mean there left the actionable half of the error visible only to a client that also
  // inspects `structuredContent`. The CLI prints both sentences together for the same typo.
  it("renders the did-you-mean hint in the text block, not only in structuredContent", () => {
    const result = handleLint({
      content: "# Title\n",
      rules: [{ rule: "SIZE-002" }],
    });

    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Unknown rule "SIZE-002"');
    expect(text).toContain(structured(result).hint as string);
    expect(text).toContain('Did you mean "SIZE-001"?');
  });

  // The negative half of the same contract: the hint is optional by design, so a bare unknown id
  // with no near-miss must render the message alone rather than an empty trailing separator.
  it("renders the message alone when an unknown rule has no near-miss suggestion", () => {
    const result = handleLint({
      content: "# Title\n",
      rules: [{ rule: "NOPE-999" }],
    });

    expect(result.isError).toBe(true);
    const output = structured(result);
    expect(output.hint).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toBe(output.message);
  });

  it("maps invalid per-rule options to INVALID_INPUT", () => {
    const result = handleLint({
      content: "# Title\n",
      rules: [{ rule: "SIZE-001", options: { lines: "nope" } }],
    });

    expect(result.isError).toBe(true);
    expect(structured(result).code).toBe("INVALID_INPUT");
  });

  it("runs a declarative document-scope custom rule (M8)", () => {
    // P12.04 direction (A): a `custom` entry is pure data, so ad-hoc lint executes it exactly as
    // `lint-files` would from config — no code plugin is ever loaded.
    const result = handleLint({
      content: "| ID | Owner |\n| --- | --- |\n| REQ-1 |  |\n",
      rules: [
        {
          rule: "custom",
          id: "REQ-OWNER",
          options: { assert: { kind: "columnNotEmpty", column: "Owner" } },
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    const output = structured(result);
    const messages = output.messages as LintMessage[];
    expect(messages).toHaveLength(1);
    // `error` is the default resolveCustomRule derives for a custom rule (it asserts an invariant).
    expect(messages[0]).toMatchObject({
      ruleId: "REQ-OWNER",
      severity: "error",
    });
    expect(output.errorCount).toBe(1);
  });

  it("applies a `severity` override to a custom rule request", () => {
    const result = handleLint({
      content: "| ID | Owner |\n| --- | --- |\n| REQ-1 |  |\n",
      rules: [
        {
          rule: "custom",
          id: "REQ-OWNER",
          severity: "warning",
          options: { assert: { kind: "columnNotEmpty", column: "Owner" } },
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    const output = structured(result);
    expect((output.messages as LintMessage[])[0]!.severity).toBe("warning");
    expect(output.warningCount).toBe(1);
  });

  it("runs a project-scope custom assert (columnUnique) without tripping R4", () => {
    // `columnUnique` is the one project-scope assert; the tool's corpus-of-one satisfies R4's
    // fail-fast, so it must report intra-document duplicates instead of degrading to INTERNAL_ERROR.
    // A corpus of one can only ever see duplicates *within* `content` — cross-file uniqueness needs
    // `lint-files`.
    const result = handleLint({
      content: "| ID |\n| --- |\n| X-1 |\n| X-1 |\n",
      rules: [
        {
          rule: "custom",
          id: "UNIQUE-ID",
          options: { assert: { kind: "columnUnique", column: "ID" } },
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ruleId: "UNIQUE-ID" });
    expect(messages[0]!.message).toMatch(/Duplicate value "X-1"/);
  });

  it("maps a malformed `custom` entry to a guided INVALID_INPUT, not a schema crash", () => {
    // The wire schema keeps a permissive branch precisely so this shape reaches the handler: the SDK
    // validates input before the handler runs, so a wire rejection would surface as a bare protocol
    // error with none of the M6 guidance. Also the boundary guard for P11.07's
    // canonicalizeRuleId(undefined) crash, since `handleLint` is called directly here.
    const result = handleLint({
      content: "# Title\n",
      rules: [{ rule: "custom" }],
    });

    expect(result.isError).toBe(true);
    const output = structured(result);
    expect(output.code).toBe("INVALID_INPUT");
    expect(output.message).toMatch(/"id" and "options\.assert"/);
    expect(output.hint).toContain("id");
  });

  it("rejects a custom id under a reserved built-in prefix (C7)", () => {
    // resolveCustomRule's own RuleResolutionError must translate through the existing
    // toToolInputError path rather than escaping as a sanitized INTERNAL_ERROR.
    const result = handleLint({
      content: "# Title\n",
      rules: [
        {
          rule: "custom",
          id: "REF-999",
          options: { assert: { kind: "allChecked" } },
        },
      ],
    });

    expect(result.isError).toBe(true);
    const output = structured(result);
    expect(output.code).toBe("INVALID_INPUT");
    expect(output.hint).toMatch(/reserved built-in prefix/);
  });

  it("selects nothing when a custom rule's `files` glob misses the synthetic path", () => {
    // The document is always `content.md`, so a caller-supplied glob scoped to a directory silently
    // matches no file — the foot-gun the tool description now discloses.
    const result = handleLint({
      content: "| ID | Owner |\n| --- | --- |\n| REQ-1 |  |\n",
      rules: [
        {
          rule: "custom",
          id: "REQ-OWNER",
          options: {
            files: ["docs/**/*.md"],
            assert: { kind: "columnNotEmpty", column: "Owner" },
          },
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(structured(result).messages as LintMessage[]).toHaveLength(0);
  });

  it("returns a normal REF-001 finding (not INTERNAL_ERROR) for an unresolved link", () => {
    // Guards the no-filesystem contract: REF-001 resolves targets against the corpus only, so a
    // corpus miss must surface as a finding rather than crash into a sanitized INTERNAL_ERROR.
    const result = handleLint({
      content: "# Title\n\n[missing](does-not-exist-anywhere.md)\n",
      rules: [{ rule: "REF-001" }],
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(messages.some((message) => message.ruleId === "REF-001")).toBe(true);
  });

  it("applies inline-disable suppression (R8) to ad-hoc content", () => {
    // A `disable-next-line` directive must drop the finding on the following line, matching
    // lint-files' behavior on the same directive-bearing content.
    const suppressed = handleLint({
      content:
        "# Title\n\n<!-- wastech-mdlint-disable-next-line REF-001 -->\n[missing](nope.md)\n",
      rules: [{ rule: "REF-001" }],
    });
    expect(suppressed.isError).toBeFalsy();
    expect(structured(suppressed).messages as LintMessage[]).toHaveLength(0);

    // Sanity check the same content fires REF-001 without the directive, so the assertion above
    // proves suppression, not that the rule simply never matched.
    const unsuppressed = handleLint({
      content: "# Title\n\n[missing](nope.md)\n",
      rules: [{ rule: "REF-001" }],
    });
    expect(
      (structured(unsuppressed).messages as LintMessage[]).length,
    ).toBeGreaterThan(0);
  });

  it("reports SEC-003's config-attributed finding for a missing template (no crash)", () => {
    // SEC-003 loads its reference template via core's normal resolution (corpus, then disk under the
    // server cwd). A template that exists in neither must yield the config-attributed
    // "template ... was not found" finding, never a crash into INTERNAL_ERROR.
    const result = handleLint({
      content: "# Title\n\n## Overview\n",
      rules: [
        {
          rule: "SEC-003",
          options: { template: "does-not-exist-template.md" },
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(
      messages.some((message) => /was not found/.test(message.message)),
    ).toBe(true);
  });

  it("honors an existing on-disk template for SEC-003 (core disk fallback preserved)", () => {
    // The repo-root README.md is guaranteed present under the test cwd; SEC-003 must load it via
    // core's disk fallback and check conformance against it — proving ad-hoc lint reuses core's
    // normal template loading rather than misreporting a real template as missing.
    const result = handleLint({
      content: "# Title\n",
      rules: [{ rule: "SEC-003", options: { template: "README.md" } }],
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(
      messages.every((message) => !/was not found/.test(message.message)),
    ).toBe(true);
  });

  it("rejects an absolute SEC-003 template path — closes the MCP host-read attack surface (audit H-2)", async () => {
    // The `lint` tool takes its whole `rules` array from the caller and hard-codes
    // `rootDir: process.cwd()`; an absolute `template` must be rejected before any read, not just
    // reported as "not found" — otherwise a prompt-injected caller turns this read-only tool into a
    // host file-read primitive.
    const outsideRoot = await mkdtemp(
      path.join(os.tmpdir(), "wastech-mdlint-mcp-sec-"),
    );
    tempDirs.push(outsideRoot);
    const secretPath = path.join(outsideRoot, "secret.md");
    await writeFile(secretPath, "# Secret\n## TopSecretSection\n", "utf8");

    const result = handleLint({
      content: "# Title\n\n## Overview\n",
      rules: [{ rule: "SEC-003", options: { template: secretPath } }],
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(
      messages.some((message) =>
        /escapes the analyzed root/.test(message.message),
      ),
    ).toBe(true);
    expect(
      messages.some((message) => message.message.includes("TopSecretSection")),
    ).toBe(false);
  });

  it("rejects an absolute STR-001 required path — same containment as SEC-003", async () => {
    // STR-001's disk probe (P11.12) is reachable from the same caller-supplied `rules` array, so it
    // is held to the same boundary: rejected outright, never answered as present/absent.
    const outsideRoot = await mkdtemp(
      path.join(os.tmpdir(), "wastech-mdlint-mcp-str-"),
    );
    tempDirs.push(outsideRoot);
    await writeFile(
      path.join(outsideRoot, "secret.txt"),
      "top secret\n",
      "utf8",
    );

    const result = handleLint({
      content: "# Title\n",
      rules: [
        {
          rule: "STR-001",
          options: { files: [path.join(outsideRoot, "secret.txt")] },
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.message).toMatch(/escapes the analyzed root/);
  });

  it("satisfies an in-root STR-001 required file via the disk probe", () => {
    // The repo-root package.json exists under the test cwd but is never in a Markdown corpus —
    // exactly the BL-1 shape, checked at the MCP surface.
    const result = handleLint({
      content: "# Title\n",
      rules: [{ rule: "STR-001", options: { files: ["package.json"] } }],
    });

    expect(result.isError).toBeFalsy();
    expect(structured(result).messages as LintMessage[]).toEqual([]);
  });

  it("resolves an existing on-disk REF-001 target via core's standard disk fallback", () => {
    // A link to a file that really exists under the server cwd (repo-root package.json) resolves,
    // exactly as it would under `lint-files` — ad-hoc lint reuses core REF resolution unchanged.
    const result = handleLint({
      content: "# Title\n\n[real file on disk](package.json)\n",
      rules: [{ rule: "REF-001" }],
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(messages.some((message) => message.ruleId === "REF-001")).toBe(
      false,
    );
  });
});

/**
 * W-58's structural half.
 *
 * The behavioral tests above pass whether this handler calls core's `lintContent` or re-assembles the
 * sequence itself — that is exactly why the duplication survived two review passes. So this asserts
 * the shape instead: the step primitives are no longer named here, which is what makes "a step added
 * to the core entry point reaches this tool" true by construction rather than by a differential test
 * that has to be kept in step with the sequence (`packages/core/test/lint-content.test.ts` holds the
 * behavioral half, between `lintContent` and `lintFiles`).
 *
 * Reading source from a test follows the precedent of `test/tool-context.test.ts`'s seventh-handler
 * guard and `packages/core/test/boundary-guards.test.ts`.
 */
describe("the ad-hoc lint step order lives in core, not in this handler", () => {
  const source = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/tools/lint.ts",
    ),
    "utf8",
  );

  it("imports the core entry point and none of the steps it composes", () => {
    expect(source).toContain("lintContent");
    // `parseDocument` + `runRules` + `createSuppressionChecker` were the hand-assembled sequence.
    // Asserted as one object so a failure names every primitive that came back, not just the first.
    const named = Object.fromEntries(
      ["parseDocument", "runRules", "createSuppressionChecker"].map((step) => [
        step,
        source.includes(step),
      ]),
    );

    expect(named).toEqual({
      parseDocument: false,
      runRules: false,
      createSuppressionChecker: false,
    });
  });
});
