import { describe, expect, it } from "vitest";

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
    expect(lineRange("#L0-L3", 12)).toEqual({ first: 1, last: 3 });
    expect(lineRange("#L40", 12)).toBeUndefined();
  });

  it("selects nothing for any other fragment", () => {
    expect(lineRange("", 12)).toBeUndefined();
    expect(lineRange("#setup", 12)).toBeUndefined();
    expect(lineRange("#L2-5", 12)).toBeUndefined();
  });
});
