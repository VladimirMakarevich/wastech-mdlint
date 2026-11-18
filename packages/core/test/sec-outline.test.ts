import { describe, expect, it } from "vitest";

import {
  compileOutline,
  formatOutlineHeading,
  matchOutline,
  type OutlineDivergence,
} from "../src/engine/rules/sec-outline.js";
import { parseDocument } from "../src/markdown/parse-document.js";

function headings(content: string) {
  return parseDocument({ path: "doc.md", content }).headings;
}

function match(
  template: string,
  document: string,
): OutlineDivergence | undefined {
  return matchOutline(compileOutline(headings(template)), headings(document));
}

// Renders a divergence as `expected → actual` heading strings so each case reads at a glance;
// `null` stands for "outline complete" on the left and "end of document" on the right.
function summary(divergence: OutlineDivergence | undefined) {
  if (divergence === undefined) {
    return undefined;
  }
  const render = (heading: OutlineDivergence["expected"]) =>
    heading === undefined ? null : formatOutlineHeading(heading);
  return [render(divergence.expected), render(divergence.actual)];
}

const ABC = "## A\n## B\n## C\n";

describe("matchOutline literal headings", () => {
  it("accepts an exact match", () => {
    expect(match(ABC, ABC)).toBeUndefined();
  });

  it("reports a missing section at the heading that took its place", () => {
    const divergence = match(ABC, "## A\n\ntext\n\n## C\n");
    expect(summary(divergence)).toEqual(["## B", "## C"]);
    expect(divergence?.actual?.line).toBe(5);
    expect(divergence?.expected?.line).toBe(2);
  });

  it("reports a reordered section", () => {
    expect(summary(match(ABC, "## A\n## C\n## B\n"))).toEqual(["## B", "## C"]);
  });

  it("reports an extra section in the middle", () => {
    expect(summary(match(ABC, "## A\n## X\n## B\n## C\n"))).toEqual([
      "## B",
      "## X",
    ]);
  });

  it("reports an extra trailing section with no expected heading", () => {
    expect(summary(match(ABC, `${ABC}## X\n`))).toEqual([null, "## X"]);
  });

  it("reports a section missing at the end as end of document", () => {
    const divergence = match(ABC, "## A\n## B\n");
    expect(summary(divergence)).toEqual(["## C", null]);
  });

  it("treats heading depth as part of the match", () => {
    expect(summary(match("## A\n", "### A\n"))).toEqual(["## A", "### A"]);
  });
});

describe("matchOutline wildcards", () => {
  it("`?` matches exactly one heading", () => {
    const template = "## A\n## ?\n## B\n";
    expect(match(template, "## A\n## X\n## B\n")).toBeUndefined();
    // With nothing between A and B, `?` consumes B and the outline then runs short.
    expect(summary(match(template, "## A\n## B\n"))).toEqual(["## B", null]);
    expect(summary(match(template, "## A\n## X\n## Y\n## B\n"))).toEqual([
      "## B",
      "## Y",
    ]);
  });

  it("`*` matches zero, one or many headings", () => {
    const template = "## A\n## *\n## B\n";
    expect(match(template, "## A\n## B\n")).toBeUndefined();
    expect(match(template, "## A\n## X\n## B\n")).toBeUndefined();
    expect(match(template, "## A\n## X\n## Y\n## Z\n## B\n")).toBeUndefined();
  });

  it("`+` matches one or more headings and names itself when unmet", () => {
    const template = "## A\n## +\n## B\n";
    expect(summary(match(template, "## A\n## B\n"))).toEqual(["## B", null]);
    expect(match(template, "## A\n## X\n## B\n")).toBeUndefined();
    expect(match(template, "## A\n## X\n## Y\n## B\n")).toBeUndefined();
    // The compiled `?`/`*` halves never leak into what a divergence names.
    expect(summary(match("## A\n## +\n# B\n", "## A\n# B\n"))).toEqual([
      "## +",
      "# B",
    ]);
  });

  it("names the earliest unmet requirement when several readings are live", () => {
    expect(summary(match("## *\n## A\n## *\n## B\n", "## A\n# Z\n"))).toEqual([
      "## A",
      "# Z",
    ]);
  });

  it("handles adjacent wildcards", () => {
    expect(match("## *\n## *\n", "")).toBeUndefined();
    expect(match("## *\n## *\n", "## X\n## Y\n")).toBeUndefined();

    expect(match("## ?\n## ?\n", "## X\n## Y\n")).toBeUndefined();
    expect(summary(match("## ?\n## ?\n", "## X\n"))).toEqual(["## ?", null]);
    expect(summary(match("## ?\n## ?\n", "## X\n## Y\n## Z\n"))).toEqual([
      null,
      "## Z",
    ]);

    expect(summary(match("## +\n## *\n", ""))).toEqual(["## +", null]);
    expect(match("## +\n## *\n", "## X\n## Y\n## Z\n")).toBeUndefined();

    expect(summary(match("## ?\n## *\n", ""))).toEqual(["## ?", null]);
    expect(match("## ?\n## *\n", "## X\n")).toBeUndefined();
    expect(match("## ?\n## *\n", "## X\n## Y\n")).toBeUndefined();

    expect(summary(match("## *\n## ?\n", ""))).toEqual(["## ?", null]);
    expect(match("## *\n## ?\n", "## X\n")).toBeUndefined();
    expect(match("## *\n## ?\n", "## X\n## Y\n## Z\n")).toBeUndefined();
  });

  it("accepts a wildcard at the end of the outline", () => {
    expect(match("## A\n## *\n", "## A\n")).toBeUndefined();
    expect(match("## A\n## *\n", "## A\n## X\n## Y\n")).toBeUndefined();

    expect(match("## A\n## +\n", "## A\n## X\n## Y\n")).toBeUndefined();
    const divergence = match("## A\n## +\n", "## A\n");
    expect(summary(divergence)).toEqual(["## +", null]);
    expect(divergence?.actual).toBeUndefined();
  });

  it("lets a wildcard absorb deeper headings but never a shallower one", () => {
    expect(match("## *\n", "## Extra\n### Detail\n")).toBeUndefined();
    expect(summary(match("## *\n", "# Title\n"))).toEqual(["## *", "# Title"]);
    // `?` counts headings, not sections, so a lone `###` heading satisfies `## ?`.
    expect(match("## ?\n", "### Sub\n")).toBeUndefined();
  });

  it("reads `\\*` as a wildcard, since the parser unescapes it to `*`", () => {
    expect(headings("## \\*\n")[0]?.text).toBe("*");
    expect(match("## \\*\n", "## Anything\n")).toBeUndefined();
  });

  it("is deterministic across repeated runs", () => {
    const template = "# ?\n## *\n## +\n## ?\n## C\n";
    const document = "# T\n## X\n### Y\n## Z\n";
    expect(match(template, document)).toEqual(match(template, document));
    // Several readings are live at the end; the earliest unmet requirement is the `+`.
    expect(summary(match(template, document))).toEqual(["## +", null]);
  });
});
