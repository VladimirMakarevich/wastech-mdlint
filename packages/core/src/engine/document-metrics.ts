import { estimateTokens } from "./tokens.js";

// A document's size, measured once for every surface that reports it. SIZE-001 checks its budgets
// against these numbers and a host that lists or filters documents by size shows the same ones, so
// a file the rule calls 2,731 tokens is never a different number in a table beside it.

export type DocumentMetrics = {
  // UTF-8 bytes of the content as parsed: what the file costs on disk and over the wire.
  bytes: number;
  // Newline characters. A last line without a trailing newline is not counted, which is the line
  // metric SIZE-001 budgets have always been written against.
  lines: number;
  // `estimateTokens`, so swapping the heuristic moves every reported token count together.
  tokens: number;
};

export function measureDocument(content: string): DocumentMetrics {
  let lines = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  return {
    bytes: Buffer.byteLength(content, "utf8"),
    lines,
    tokens: estimateTokens(content),
  };
}
