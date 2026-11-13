import { describe, expect, it } from "vitest";

import {
  headingLevelFindings,
  type HeadingLevelOptions,
} from "../src/engine/rules/sec-heading-levels.js";
import { parseDocument } from "../src/markdown/parse-document.js";

const DEFAULTS: HeadingLevelOptions = {
  increment: true,
  singleTitle: true,
  title: true,
  level: 1,
  titleKey: "title",
};

function findings(content: string, options: Partial<HeadingLevelOptions> = {}) {
  return headingLevelFindings(parseDocument({ path: "doc.md", content }), {
    ...DEFAULTS,
    ...options,
  });
}

// `[check, line]` pairs, so each case reads at a glance.
function summary(content: string, options: Partial<HeadingLevelOptions> = {}) {
  return findings(content, options).map((finding) => [
    finding.data?.check,
    finding.line,
  ]);
}

describe("SEC-004 increment", () => {
  it("reports a skipped level at the deeper heading", () => {
    expect(findings("# T\n\n## A\n\n#### B\n")).toEqual([
      {
        message: "Heading level skips from H2 to H4; expected H3 or shallower.",
        line: 5,
        data: {
          check: "increment",
          depth: 4,
          previousDepth: 2,
          previousLine: 3,
        },
      },
    ]);
  });

  it("accepts stepping in by one and stepping out by any amount", () => {
    expect(summary("# T\n## A\n### B\n## C\n### D\n")).toEqual([]);
    expect(summary("# T\n## A\n### B\n#### C\n## D\n")).toEqual([]);
  });

  it("never reports the first heading as a skip", () => {
    expect(summary("## A\n### B\n", { title: false })).toEqual([]);
  });
});

describe("SEC-004 singleTitle", () => {
  it("reports every top-level heading after the first at its own line", () => {
    const result = findings("# A\n\n# B\n\n# C\n");
    expect(result.map((finding) => [finding.line, finding.data])).toEqual([
      [3, { check: "singleTitle", level: 1, firstLine: 1 }],
      [5, { check: "singleTitle", level: 1, firstLine: 1 }],
    ]);
  });

  it("follows the configured level", () => {
    expect(summary("# A\n# B\n", { level: 2, title: false })).toEqual([]);
    expect(summary("## A\n## B\n", { level: 2 })).toEqual([["singleTitle", 2]]);
  });

  it("does not count a front matter title as a top-level heading", () => {
    expect(summary("---\ntitle: X\n---\n# A\n")).toEqual([]);
  });
});

describe("SEC-004 title", () => {
  it("reports leading prose at the prose line", () => {
    expect(findings("Intro.\n\n# T\n")).toEqual([
      {
        message:
          'Document does not start with an H1 heading or declare a front matter "title" key.',
        line: 1,
        data: { check: "title", level: 1, titleKey: "title" },
      },
    ]);
  });

  it("reports a first heading at the wrong level", () => {
    expect(summary("## A\n")).toEqual([["title", 1]]);
  });

  it("skips a leading comment or directive but not a rendered badge", () => {
    expect(summary("<!-- wastech-mdlint-disable CTX-001 -->\n# T\n")).toEqual(
      [],
    );
    expect(summary('<img src="badge.svg">\n\n# T\n')).toEqual([["title", 1]]);
  });

  it("accepts a front matter title key, empty value included", () => {
    expect(summary("---\ntitle: X\n---\n\nIntro.\n")).toEqual([]);
    expect(summary("---\ntitle:\n---\n\nIntro.\n")).toEqual([]);
  });

  it("reports at the prose line when front matter lacks the key", () => {
    expect(summary("---\nname: x\n---\n\nIntro.\n")).toEqual([["title", 5]]);
  });

  it("resolves a dotted titleKey through nested mappings", () => {
    const content = "---\nmeta:\n  title: X\n---\n\nIntro.\n";
    expect(summary(content, { titleKey: "meta.title" })).toEqual([]);
    expect(summary(content)).toEqual([["title", 6]]);
  });

  it("falls back to the heading when front matter is unreadable, without reporting the YAML", () => {
    expect(summary("---\n: [\n---\n\n# T\n")).toEqual([]);
    const [finding] = findings("---\n: [\n---\n\nIntro.\n");
    expect(finding?.message).toBe(
      'Document does not start with an H1 heading or declare a front matter "title" key (front matter could not be read).',
    );
    expect(finding?.line).toBe(5);
  });

  it("reports an empty or front-matter-only document at line 0", () => {
    expect(summary("")).toEqual([["title", 0]]);
    expect(summary("---\nname: x\n---\n")).toEqual([["title", 0]]);
  });
});

describe("SEC-004 switches", () => {
  // Trips all three checks: prose first, a skip from H1 to H3, and a second H1.
  const ALL = "Intro.\n\n# A\n\n### B\n\n# C\n";

  it("emits the title finding first, then heading findings in document order", () => {
    expect(summary(ALL)).toEqual([
      ["title", 1],
      ["increment", 5],
      ["singleTitle", 7],
    ]);
  });

  it("suppresses only the check that is turned off", () => {
    expect(summary(ALL, { title: false })).toEqual([
      ["increment", 5],
      ["singleTitle", 7],
    ]);
    expect(summary(ALL, { increment: false })).toEqual([
      ["title", 1],
      ["singleTitle", 7],
    ]);
    expect(summary(ALL, { singleTitle: false })).toEqual([
      ["title", 1],
      ["increment", 5],
    ]);
  });

  it("is deterministic across repeated runs", () => {
    expect(findings(ALL)).toEqual(findings(ALL));
  });
});
