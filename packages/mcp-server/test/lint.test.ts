import type { LintMessage } from "@wastech-mdlint/core";
import { describe, expect, it } from "vitest";

import { handleLint } from "../src/tools/lint.js";

// P7.02 exercises the computational layer (`handleLint`) directly — wire-level McpServer testing is
// deferred to P7.05 — so these assert the structured output / error contract without a transport.

function structured(result: ReturnType<typeof handleLint>): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

describe("handleLint", () => {
  it("returns structured findings and a text summary for a firing rule", () => {
    const result = handleLint({
      content: "# Title\n\nsome body\nmore body\n",
      rules: [{ rule: "SIZE-001", options: { lines: { error: 1 } } }]
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

  it("filters a rule requested with severity `off` after resolving it", () => {
    const result = handleLint({
      content: "# Title\n\nsome body\nmore body\n",
      rules: [{ rule: "SIZE-001", severity: "off", options: { lines: { error: 1 } } }]
    });

    expect(result.isError).toBeFalsy();
    expect((structured(result).messages as LintMessage[])).toHaveLength(0);
  });

  it("maps an unknown rule id to INVALID_INPUT with a suggestion", () => {
    const result = handleLint({ content: "# Title\n", rules: [{ rule: "SIZE-002" }] });

    expect(result.isError).toBe(true);
    const output = structured(result);
    expect(output.code).toBe("INVALID_INPUT");
    expect(output.hint).toContain("SIZE-001");
  });

  it("maps invalid per-rule options to INVALID_INPUT", () => {
    const result = handleLint({
      content: "# Title\n",
      rules: [{ rule: "SIZE-001", options: { lines: "nope" } }]
    });

    expect(result.isError).toBe(true);
    expect(structured(result).code).toBe("INVALID_INPUT");
  });

  it("rejects a `custom` rule request as INVALID_INPUT", () => {
    // Pins the deliberate non-support: no registry entry is id'd "custom"; the declarative
    // custom-rule path (resolveCustomRule) is intentionally not reachable from ad-hoc lint.
    const result = handleLint({ content: "# Title\n", rules: [{ rule: "custom" }] });

    expect(result.isError).toBe(true);
    expect(structured(result).code).toBe("INVALID_INPUT");
  });

  it("returns a normal REF-001 finding (not INTERNAL_ERROR) for an unresolved link", () => {
    // Guards the no-filesystem contract: REF-001 resolves targets against the corpus only, so a
    // corpus miss must surface as a finding rather than crash into a sanitized INTERNAL_ERROR.
    const result = handleLint({
      content: "# Title\n\n[missing](does-not-exist-anywhere.md)\n",
      rules: [{ rule: "REF-001" }]
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(messages.some((message) => message.ruleId === "REF-001")).toBe(true);
  });

  it("applies inline-disable suppression (R8) to ad-hoc content", () => {
    // A `disable-next-line` directive must drop the finding on the following line, matching
    // lint-files' behavior on the same directive-bearing content.
    const suppressed = handleLint({
      content: "# Title\n\n<!-- wastech-mdlint-disable-next-line REF-001 -->\n[missing](nope.md)\n",
      rules: [{ rule: "REF-001" }]
    });
    expect(suppressed.isError).toBeFalsy();
    expect((structured(suppressed).messages as LintMessage[])).toHaveLength(0);

    // Sanity check the same content fires REF-001 without the directive, so the assertion above
    // proves suppression, not that the rule simply never matched.
    const unsuppressed = handleLint({
      content: "# Title\n\n[missing](nope.md)\n",
      rules: [{ rule: "REF-001" }]
    });
    expect((structured(unsuppressed).messages as LintMessage[]).length).toBeGreaterThan(0);
  });

  it("reports SEC-003's config-attributed finding for a missing template (no crash)", () => {
    // SEC-003 loads its reference template via core's normal resolution (corpus, then disk under the
    // server cwd). A template that exists in neither must yield the config-attributed
    // "template ... was not found" finding, never a crash into INTERNAL_ERROR.
    const result = handleLint({
      content: "# Title\n\n## Overview\n",
      rules: [{ rule: "SEC-003", options: { template: "does-not-exist-template.md" } }]
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(messages.some((message) => /was not found/.test(message.message))).toBe(true);
  });

  it("honors an existing on-disk template for SEC-003 (core disk fallback preserved)", () => {
    // The repo-root README.md is guaranteed present under the test cwd; SEC-003 must load it via
    // core's disk fallback and check conformance against it — proving ad-hoc lint reuses core's
    // normal template loading rather than misreporting a real template as missing.
    const result = handleLint({
      content: "# Title\n",
      rules: [{ rule: "SEC-003", options: { template: "README.md" } }]
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(messages.every((message) => !/was not found/.test(message.message))).toBe(true);
  });

  it("resolves an existing on-disk REF-001 target via core's standard disk fallback", () => {
    // A link to a file that really exists under the server cwd (repo-root package.json) resolves,
    // exactly as it would under `lint-files` — ad-hoc lint reuses core REF resolution unchanged.
    const result = handleLint({
      content: "# Title\n\n[real file on disk](package.json)\n",
      rules: [{ rule: "REF-001" }]
    });

    expect(result.isError).toBeFalsy();
    const messages = structured(result).messages as LintMessage[];
    expect(messages.some((message) => message.ruleId === "REF-001")).toBe(false);
  });
});
