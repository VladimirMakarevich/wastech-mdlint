import { describe, expect, it } from "vitest";

import {
  analyzeDirectives,
  createSuppressionChecker,
} from "../src/engine/suppression.js";
import { parseDocument } from "../src/markdown/parse-document.js";

// Directives are built through the real parser so the grammar and the engine are exercised as the
// lint pipeline exercises them, rather than through hand-written objects that could drift from
// what the parser actually emits.
function analyze(lines: string[]) {
  const document = parseDocument({
    path: "doc.md",
    content: lines.join("\n"),
  });
  return analyzeDirectives(document.directives);
}

// One row per line 1..count: whether `ruleId` is suppressed there.
function suppressedLines(
  isSuppressed: (ruleId: string, line: number) => boolean,
  ruleId: string,
  count: number,
): boolean[] {
  return Array.from({ length: count }, (_, index) =>
    isSuppressed(ruleId, index + 1),
  );
}

describe("analyzeDirectives · existing block and next-line semantics", () => {
  it("keeps disable/enable ranges and disable-next-line unchanged", () => {
    const { isSuppressed } = analyze([
      "<!-- wastech-mdlint-disable -->",
      "x",
      "<!-- wastech-mdlint-enable REF-001 -->",
      "x",
      "<!-- wastech-mdlint-enable -->",
      "<!-- wastech-mdlint-disable-next-line TBL-001 -->",
      "x",
      "x",
    ]);

    expect(suppressedLines(isSuppressed, "REF-001", 8)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(suppressedLines(isSuppressed, "TBL-001", 8)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      true,
      false,
    ]);
    expect(isSuppressed("REF-001", 0)).toBe(false);
  });
});

describe("analyzeDirectives · disable-file", () => {
  it("suppresses lines above it and whole-file findings, for the listed rule only", () => {
    const { isSuppressed } = analyze([
      "x",
      "x",
      "<!-- wastech-mdlint-disable-file REF-001 -->",
    ]);

    expect(suppressedLines(isSuppressed, "REF-001", 3)).toEqual([
      true,
      true,
      true,
    ]);
    expect(isSuppressed("REF-001", 0)).toBe(true);
    expect(isSuppressed("TBL-001", 1)).toBe(false);
    expect(isSuppressed("TBL-001", 0)).toBe(false);
  });

  it("with no ids suppresses every rule", () => {
    const { isSuppressed } = analyze([
      "x",
      "<!-- wastech-mdlint-disable-file -->",
    ]);

    expect(isSuppressed("REF-001", 1)).toBe(true);
    expect(isSuppressed("CUSTOM-RULE", 0)).toBe(true);
  });

  it("is overridden from a later enable's line, and restore cannot undo it", () => {
    const { isSuppressed } = analyze([
      "x",
      "<!-- wastech-mdlint-capture -->",
      "<!-- wastech-mdlint-restore -->",
      "<!-- wastech-mdlint-enable REF-001 -->",
      "x",
      "<!-- wastech-mdlint-disable-file REF-001 -->",
    ]);

    expect(suppressedLines(isSuppressed, "REF-001", 6)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("stays in force after a restore of a capture taken inside an enable", () => {
    const { isSuppressed } = analyze([
      "<!-- wastech-mdlint-capture -->",
      "<!-- wastech-mdlint-enable -->",
      "<!-- wastech-mdlint-restore -->",
      "x",
      "<!-- wastech-mdlint-disable-file REF-001 -->",
    ]);

    expect(suppressedLines(isSuppressed, "REF-001", 4)).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });
});

describe("analyzeDirectives · capture / restore", () => {
  it("returns exactly to a non-trivial captured state", () => {
    const { isSuppressed, diagnostics } = analyze([
      "<!-- wastech-mdlint-disable -->",
      "<!-- wastech-mdlint-enable REF-001 -->",
      "<!-- wastech-mdlint-capture -->",
      "<!-- wastech-mdlint-enable -->",
      "<!-- wastech-mdlint-disable REF-001 -->",
      "x",
      "<!-- wastech-mdlint-restore -->",
      "x",
    ]);

    expect(diagnostics).toEqual([]);
    // Captured state: everything disabled except REF-001.
    for (const line of [3, 7, 8]) {
      expect(isSuppressed("REF-001", line)).toBe(false);
      expect(isSuppressed("TBL-001", line)).toBe(true);
    }
    // Inside the block: everything enabled except REF-001.
    expect(isSuppressed("REF-001", 6)).toBe(true);
    expect(isSuppressed("TBL-001", 6)).toBe(false);
  });

  it("nests: each restore returns to its own capture", () => {
    const { isSuppressed, diagnostics } = analyze([
      "<!-- wastech-mdlint-disable TBL-001 -->", // 1: A-state = {TBL-001 off}
      "<!-- wastech-mdlint-capture -->", // 2
      "<!-- wastech-mdlint-disable REF-001 -->", // 3
      "<!-- wastech-mdlint-capture -->", // 4: B-state = {TBL-001, REF-001 off}
      "<!-- wastech-mdlint-enable -->", // 5: everything on
      "<!-- wastech-mdlint-disable CTX-001 -->", // 6
      "<!-- wastech-mdlint-restore -->", // 7: back to B
      "<!-- wastech-mdlint-restore -->", // 8: back to A
    ]);

    expect(diagnostics).toEqual([]);
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((line) =>
      ["TBL-001", "REF-001", "CTX-001"].map((ruleId) =>
        isSuppressed(ruleId, line),
      ),
    );
    expect(rows).toEqual([
      [true, false, false],
      [true, false, false],
      [true, true, false],
      [true, true, false],
      [false, false, false],
      [false, false, true],
      [true, true, false],
      [true, false, false],
    ]);
  });

  it("an unclosed capture is harmless and reports nothing", () => {
    const { isSuppressed, diagnostics } = analyze([
      "<!-- wastech-mdlint-capture -->",
      "<!-- wastech-mdlint-disable REF-001 -->",
      "x",
    ]);

    expect(diagnostics).toEqual([]);
    expect(isSuppressed("REF-001", 3)).toBe(true);
  });
});

describe("analyzeDirectives · categories", () => {
  it("a category selects every rule in that family and nothing else", () => {
    const { isSuppressed } = analyze([
      "<!-- wastech-mdlint-disable ref -->",
      "x",
    ]);

    expect(isSuppressed("REF-001", 2)).toBe(true);
    expect(isSuppressed("REF-009", 2)).toBe(true);
    expect(isSuppressed("REFX-1", 2)).toBe(false);
    expect(isSuppressed("CTX-001", 2)).toBe(false);
  });

  it("re-enables a family after a bare disable", () => {
    const { isSuppressed } = analyze([
      "<!-- wastech-mdlint-disable -->",
      "<!-- wastech-mdlint-enable REF -->",
      "x",
    ]);

    expect(isSuppressed("REF-002", 3)).toBe(false);
    expect(isSuppressed("TBL-001", 3)).toBe(true);
  });

  it("works in disable-next-line and disable-file", () => {
    const { isSuppressed } = analyze([
      "<!-- wastech-mdlint-disable-next-line TBL -->",
      "x",
      "x",
      "<!-- wastech-mdlint-disable-file SIZE -->",
    ]);

    expect(isSuppressed("TBL-003", 2)).toBe(true);
    expect(isSuppressed("TBL-003", 3)).toBe(false);
    expect(isSuppressed("SIZE-001", 0)).toBe(true);
  });
});

describe("analyzeDirectives · rule aliases", () => {
  it("suppresses the next line by alias", () => {
    const { isSuppressed, diagnostics } = analyze([
      "<!-- wastech-mdlint-disable-next-line no-broken-anchors -->",
      "x",
      "x",
    ]);

    expect(isSuppressed("REF-002", 2)).toBe(true);
    expect(isSuppressed("REF-002", 3)).toBe(false);
    expect(isSuppressed("REF-001", 2)).toBe(false);
    // An alias is dashed, so it is never mistaken for an unknown category.
    expect(diagnostics).toEqual([]);
  });

  it("works in disable, enable and disable-file, in any case", () => {
    const { isSuppressed, diagnostics } = analyze([
      "<!-- wastech-mdlint-disable No-Broken-Links -->",
      "x",
      "<!-- wastech-mdlint-enable NO-BROKEN-LINKS -->",
      "x",
      "<!-- wastech-mdlint-disable-file file-size-budget -->",
    ]);

    expect(suppressedLines(isSuppressed, "REF-001", 4)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(isSuppressed("SIZE-001", 0)).toBe(true);
    expect(diagnostics).toEqual([]);
  });

  it("an id and its alias name the same rule", () => {
    const { isSuppressed } = analyze([
      "<!-- wastech-mdlint-disable REF-002 -->",
      "<!-- wastech-mdlint-enable no-broken-anchors -->",
      "x",
    ]);

    expect(isSuppressed("REF-002", 3)).toBe(false);
  });
});

describe("analyzeDirectives · diagnostics", () => {
  it("reports an unknown category with the known ones in code-point order", () => {
    const { isSuppressed, diagnostics } = analyze([
      "x",
      "<!-- wastech-mdlint-disable FOO, REF-001 -->",
      "x",
    ]);

    expect(diagnostics).toEqual([
      {
        line: 2,
        message:
          'Unknown rule category "FOO" in wastech-mdlint-disable; known categories: CTX, FM, GRP, LLM, REF, SEC, SIZE, STR, TBL.',
        data: { directive: "disable", token: "FOO" },
      },
    ]);
    // The unknown token matches nothing - not even a custom id sharing its prefix - and the valid
    // id beside it still acts.
    expect(isSuppressed("FOO-001", 3)).toBe(false);
    expect(isSuppressed("REF-001", 3)).toBe(true);
  });

  it("reports a restore with no open capture and leaves the state untouched", () => {
    const { isSuppressed, diagnostics } = analyze([
      "<!-- wastech-mdlint-capture -->",
      "<!-- wastech-mdlint-restore -->",
      "<!-- wastech-mdlint-disable REF-001 -->",
      "<!-- wastech-mdlint-restore -->",
      "x",
    ]);

    expect(diagnostics).toEqual([
      {
        line: 4,
        message:
          "wastech-mdlint-restore has no matching wastech-mdlint-capture; it was ignored.",
        data: { directive: "restore" },
      },
    ]);
    expect(isSuppressed("REF-001", 5)).toBe(true);
  });

  it("reports ids written on capture/restore but still acts on the directive", () => {
    const { isSuppressed, diagnostics } = analyze([
      "<!-- wastech-mdlint-capture REF-001 -->",
      "<!-- wastech-mdlint-disable -->",
      "<!-- wastech-mdlint-restore REF -->",
      "x",
    ]);

    expect(diagnostics.map((diagnostic) => diagnostic.line)).toEqual([1, 3]);
    expect(diagnostics[0]?.message).toBe(
      "wastech-mdlint-capture takes no rule IDs; ignored: REF-001.",
    );
    expect(isSuppressed("TBL-001", 4)).toBe(false);
  });
});

// `createSuppressionChecker` is public and has no config to consult, so it must still read only
// the built-in families as categories: a custom rule's prefix is not one, in any directive kind.
describe("createSuppressionChecker · custom-rule prefixes", () => {
  it("never lets a custom prefix select a custom rule", () => {
    const document = parseDocument({
      path: "doc.md",
      content: [
        "<!-- wastech-mdlint-disable REQ -->",
        "<!-- wastech-mdlint-disable-next-line REQ -->",
        "x",
        "<!-- wastech-mdlint-disable-file REQ -->",
      ].join("\n"),
    });
    const isSuppressed = createSuppressionChecker(document.directives);

    for (const line of [0, 1, 2, 3, 4]) {
      expect(isSuppressed("REQ-OWNER", line)).toBe(false);
    }
  });

  it("still selects a built-in family", () => {
    const document = parseDocument({
      path: "doc.md",
      content: "<!-- wastech-mdlint-disable REF -->\nx",
    });
    const isSuppressed = createSuppressionChecker(document.directives);

    expect(isSuppressed("REF-001", 2)).toBe(true);
  });
});
