import { describe, expect, it } from "vitest";

import { detectNewline, normalizeNewlines } from "../src/markdown/newline.js";

describe("detectNewline", () => {
  it("detects LF and CRLF documents", () => {
    expect(detectNewline("# A\n\n## B\n")).toBe("\n");
    expect(detectNewline("# A\r\n\r\n## B\r\n")).toBe("\r\n");
  });

  it("falls back to LF for a document with no terminator, and for a lone classic-Mac CR", () => {
    expect(detectNewline("")).toBe("\n");
    expect(detectNewline("# A")).toBe("\n");
    // A lone `\r` is not a style `applyEdits` can preserve, so it degrades to the LF default rather
    // than becoming a third case the write path would have to model.
    expect(detectNewline("# A\r## B")).toBe("\n");
  });

  it("lets the first terminator win in a mixed document", () => {
    expect(detectNewline("# A\r\nmixed\nrest\n")).toBe("\r\n");
    expect(detectNewline("# A\nmixed\r\nrest\n")).toBe("\n");
  });

  it("does not treat a leading LF as CRLF when there is no character before it", () => {
    expect(detectNewline("\r\n")).toBe("\r\n");
    expect(detectNewline("\nbody")).toBe("\n");
  });
});

describe("normalizeNewlines", () => {
  it("round-trips between the two styles without doubling a CR", () => {
    const lf = "\n## Summary\n\nTODO\n";
    const crlf = "\r\n## Summary\r\n\r\nTODO\r\n";

    expect(normalizeNewlines(lf, "\r\n")).toBe(crlf);
    expect(normalizeNewlines(crlf, "\n")).toBe(lf);
    expect(normalizeNewlines(crlf, "\r\n")).toBe(crlf);
    expect(normalizeNewlines(lf, "\n")).toBe(lf);
  });

  it("leaves text with no terminators alone", () => {
    expect(normalizeNewlines(" TODO ", "\r\n")).toBe(" TODO ");
    expect(normalizeNewlines(" TODO ", "\n")).toBe(" TODO ");
  });
});
