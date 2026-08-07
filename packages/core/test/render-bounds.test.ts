import { describe, expect, it } from "vitest";

import { CYCLE_PATH_HOP_LIMIT, formatCyclePath } from "../src/render-bounds.js";

// The cycle path is the one line in either human renderer whose length follows graph shape rather
// than an authored list, so the fixture corpus (a 3-node cycle) cannot exercise the bound. These
// cases are what keep "no line is a multi-KB blob" true of the product and not only of the fixture.

describe("formatCyclePath", () => {
  it("renders a short cycle in full", () => {
    expect(formatCyclePath(["a.md", "b.md", "a.md"])).toBe(
      "a.md -> b.md -> a.md",
    );
  });

  it("renders exactly the limit in full", () => {
    const cycle = Array.from(
      { length: CYCLE_PATH_HOP_LIMIT },
      (_unused, index) => `n${index}.md`,
    );

    expect(formatCyclePath(cycle)).toBe(cycle.join(" -> "));
    expect(formatCyclePath(cycle)).not.toContain("...");
  });

  it("elides the middle past the limit and states how many hops were dropped", () => {
    const cycle = Array.from(
      { length: 50 },
      (_unused, index) => `n${index}.md`,
    );

    const rendered = formatCyclePath(cycle);

    // Head keeps the entry point, tail keeps the closing node, so the two facts a reader uses
    // survive the elision.
    expect(rendered.startsWith("n0.md -> n1.md -> ")).toBe(true);
    expect(rendered).toBe(
      "n0.md -> n1.md -> n2.md -> n3.md -> n4.md -> n5.md -> n6.md -> ... -> n49.md (+42 more hops)",
    );
    // ASCII, not U+2026: this reaches a Windows terminal whose code page may not carry it.
    expect(rendered).not.toContain("…");
  });

  it("keeps a 500-node cycle bounded rather than emitting a multi-KB line", () => {
    const cycle = Array.from(
      { length: 500 },
      (_unused, index) => `docs/area-01/topic-${index}.md`,
    );

    expect(formatCyclePath(cycle).length).toBeLessThan(400);
  });
});
