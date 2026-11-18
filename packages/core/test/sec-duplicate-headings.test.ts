import { describe, expect, it } from "vitest";

import { duplicateHeadingFindings } from "../src/engine/rules/sec-duplicate-headings.js";
import { parseDocument } from "../src/markdown/parse-document.js";

function findings(content: string, siblingsOnly = false) {
  return duplicateHeadingFindings(parseDocument({ path: "doc.md", content }), {
    siblingsOnly,
  });
}

// `[line, firstLine]` pairs, so each case reads at a glance.
function summary(content: string, siblingsOnly = false) {
  return findings(content, siblingsOnly).map((finding) => [
    finding.line,
    finding.data?.firstLine,
  ]);
}

describe("SEC-005 default mode", () => {
  it("reports the second occurrence once, naming the first's line, across depths", () => {
    expect(findings("# T\n\n## Usage\n\n### Usage\n")).toEqual([
      {
        message: 'Heading "Usage" duplicates the heading on line 3.',
        line: 5,
        data: { text: "Usage", firstLine: 3, depth: 3 },
      },
    ]);
  });

  it("reports every further repeat against the first occurrence", () => {
    expect(summary("## A\n\n## A\n\n## A\n")).toEqual([
      [3, 1],
      [5, 1],
    ]);
  });

  it("compares the rendered text, with inline formatting stripped", () => {
    expect(summary("# **Usage**\n\n## Usage\n")).toEqual([[3, 1]]);
    expect(summary("## `Usage`\n\n## Usage\n")).toEqual([[3, 1]]);
    expect(summary("## [Usage](x.md)\n\n## Usage\n")).toEqual([[3, 1]]);
  });

  // Case-sensitive on purpose: `section` options match exact text, so `Usage` and `usage` are two
  // different sections to every rule that names one.
  it("does not fold case", () => {
    expect(summary("## Usage\n\n## usage\n")).toEqual([]);
  });

  it("ignores empty headings", () => {
    expect(summary("#\n\n#\n")).toEqual([]);
  });

  it("reports headings under different parents when siblingsOnly is off", () => {
    expect(summary("## A\n### X\n## B\n### X\n")).toEqual([[4, 2]]);
  });
});

describe("SEC-005 siblingsOnly", () => {
  it("passes identical headings under different parents", () => {
    expect(summary("## A\n### X\n## B\n### X\n", true)).toEqual([]);
  });

  it("reports identical siblings", () => {
    expect(summary("## A\n### X\n### X\n", true)).toEqual([[3, 2]]);
  });

  it("passes the same text at different depths", () => {
    expect(summary("# T\n## X\n### X\n", true)).toEqual([]);
    // After a level skip the H4 and the H3 share the parent `## A` but not a depth.
    expect(summary("## A\n#### X\n### X\n", true)).toEqual([]);
  });

  it("treats top-level headings as siblings under the document root", () => {
    expect(summary("## X\n\n## X\n", true)).toEqual([[3, 1]]);
  });
});

// The seen-text map and ancestor stack are local to each call, so nothing from one document can
// leak into the next; a repeated call returning the same findings is what pins that.
describe("SEC-005 determinism", () => {
  it("returns the same findings on a repeated call", () => {
    const content = "## A\n### X\n### X\n## A\n";
    expect(findings(content, true)).toEqual(findings(content, true));
    expect(findings(content)).toEqual(findings(content));
  });
});
