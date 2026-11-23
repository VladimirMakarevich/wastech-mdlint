import { describe, expect, it } from "vitest";

import { measureDocument } from "../src/engine/document-metrics.js";
import { estimateTokens } from "../src/engine/tokens.js";

describe("measureDocument", () => {
  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    // Four Cyrillic letters are four code units and eight bytes.
    expect(measureDocument("тест").bytes).toBe(8);
    expect(measureDocument("test").bytes).toBe(4);
  });

  it("counts newline characters, so a last line without one is not counted", () => {
    expect(measureDocument("").lines).toBe(0);
    expect(measureDocument("one").lines).toBe(0);
    expect(measureDocument("one\ntwo").lines).toBe(1);
    expect(measureDocument("one\ntwo\n").lines).toBe(2);
  });

  it("counts a CRLF line once", () => {
    expect(measureDocument("one\r\ntwo\r\n").lines).toBe(2);
  });

  it("reports the shared token estimate", () => {
    const content = "# Title\n\nSome words in a paragraph.\n";
    expect(measureDocument(content).tokens).toBe(estimateTokens(content));
  });
});
