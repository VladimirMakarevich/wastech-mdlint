import { describe, expect, it } from "vitest";

import { parseLineFragment } from "@wastech-mdlint/core";

import { lineRange } from "../src/client/source-lines.js";

// The page marks every line a `#L…` fragment selects, one step per line, so the range is cut to the
// file: a fragment naming line 999999999 would otherwise freeze the tab.
describe("lineRange", () => {
  it("selects one line or a range, written either way round", () => {
    expect(lineRange("#L4", 10)).toEqual({ first: 4, last: 4 });
    expect(lineRange("#L2-L5", 10)).toEqual({ first: 2, last: 5 });
    expect(lineRange("#L5-L2", 10)).toEqual({ first: 2, last: 5 });
  });

  it("cuts the range to the lines the file has", () => {
    expect(lineRange("#L1-L999999999", 12)).toEqual({ first: 1, last: 12 });
    expect(lineRange("#L40", 12)).toBeUndefined();
  });

  it("selects nothing for any other fragment", () => {
    expect(lineRange("", 12)).toBeUndefined();
    expect(lineRange("#setup", 12)).toBeUndefined();
    expect(lineRange("#L2-5", 12)).toBeUndefined();
  });
});

// The browser cannot import core, so the page script reads line fragments itself. Both readings are
// held to this one table: a link the review of a branch calls a range of code lines is a range this
// page marks, and a fragment one of them refuses the other refuses too.
const FRAGMENTS: [string, { start: number; end: number } | undefined][] = [
  ["L4", { start: 4, end: 4 }],
  ["L2-L5", { start: 2, end: 5 }],
  ["L5-L2", { start: 2, end: 5 }],
  ["L5C3", { start: 5, end: 5 }],
  ["L10C5-L12C3", { start: 10, end: 12 }],
  ["L12C1-L10", { start: 10, end: 12 }],
  ["L0", undefined],
  ["L0-L3", undefined],
  ["L05", undefined],
  ["L", undefined],
  ["Lx", undefined],
  ["l5", undefined],
  ["L2-5", undefined],
  ["L5C0", undefined],
  ["L5-", undefined],
  ["top", undefined],
  ["setup", undefined],
  ["", undefined],
];

describe("one reading of line fragments in core and in the page", () => {
  it.each(FRAGMENTS)("reads %j the same on both sides", (fragment, lines) => {
    expect(parseLineFragment(fragment)).toEqual(lines);
    expect(lineRange(`#${fragment}`, Number.MAX_SAFE_INTEGER)).toEqual(
      lines === undefined ? undefined : { first: lines.start, last: lines.end },
    );
  });
});
