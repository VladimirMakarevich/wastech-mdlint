import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMPHASIS_PUNCTUATION,
  emphasisHeadingFindings,
} from "../src/engine/rules/sec-emphasis-headings.js";
import { parseDocument } from "../src/markdown/parse-document.js";

function findings(content: string, punctuation = DEFAULT_EMPHASIS_PUNCTUATION) {
  return emphasisHeadingFindings(parseDocument({ path: "doc.md", content }), {
    punctuation,
  });
}

function lines(content: string, punctuation?: string) {
  return findings(content, punctuation).map((finding) => finding.line);
}

describe("SEC-006 default punctuation", () => {
  it("reports a standalone strong or emphasis paragraph", () => {
    expect(findings("**Installation**\n\n_Usage_\n")).toEqual([
      {
        message: 'Emphasis used instead of a heading: "Installation".',
        line: 1,
        data: { text: "Installation", kind: "strong" },
      },
      {
        message: 'Emphasis used instead of a heading: "Usage".',
        line: 3,
        data: { text: "Usage", kind: "emphasis" },
      },
    ]);
  });

  it("passes a bold sentence ending in punctuation", () => {
    expect(lines("**A bold sentence.**\n")).toEqual([]);
  });

  it("exempts every default mark, full-width forms included", () => {
    for (const mark of Array.from(DEFAULT_EMPHASIS_PUNCTUATION)) {
      expect(lines(`**Note${mark}**\n`)).toEqual([]);
    }
    expect(lines("**注意：**\n")).toEqual([]);
    expect(lines("**完了。**\n")).toEqual([]);
  });

  // A bold run wrapped across lines is an emphasised sentence, not a title.
  it("passes multi-line emphasis", () => {
    expect(lines("**First line\nsecond line**\n")).toEqual([]);
  });

  it("compares an astral final character whole", () => {
    expect(lines("**Done 🎉**\n")).toEqual([1]);
    expect(lines("**Done 🎉**\n", "🎉")).toEqual([]);
  });
});

describe("SEC-006 custom punctuation", () => {
  it("reports a lead-in once its mark is not in the set", () => {
    expect(lines("**Note:**\n", ".")).toEqual([1]);
    expect(lines("**Note.**\n", ".")).toEqual([]);
  });

  it("reports everything with an empty set", () => {
    expect(lines("**Note:**\n\n**End.**\n", "")).toEqual([1, 3]);
  });
});

describe("SEC-006 determinism", () => {
  it("returns findings in document order, the same on a repeated call", () => {
    const content = "**B**\n\n**A**\n\n**C**\n";
    expect(lines(content)).toEqual([1, 3, 5]);
    expect(findings(content)).toEqual(findings(content));
  });
});
