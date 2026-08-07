// `find-line-number` util: convert a 0-based character offset in `content` to a 1-based
// line number. Newline-agnostic (`\n` count; `\r\n` shares the `\n`). Used by content primitives to
// attribute regex matches to a line.

// One-shot form: allocates nothing and stops at `index`. Callers that resolve *many* offsets in the
// same string must hoist a `createLineNumberLookup` instead of calling this in a loop — the scan
// restarts from offset zero every time, which is an O(M·L) hot path.
export function findLineNumber(content: string, index: number): number {
  const clamped = Math.max(0, Math.min(index, content.length));
  let line = 1;

  for (let position = 0; position < clamped; position += 1) {
    if (content.charCodeAt(position) === 10 /* \n */) {
      line += 1;
    }
  }

  return line;
}

export type LineNumberLookup = (index: number) => number;

/**
 * Build a reusable offset→line resolver for one string: O(L) to index the line starts, then
 * O(log L) per query, so anchoring M matches costs O(L + M·log L) instead of O(M·L).
 *
 * Results are identical to `findLineNumber` for every input, including out-of-range offsets
 * (clamped the same way) and CRLF content (line starts are derived from `\n` alone).
 */
export function createLineNumberLookup(content: string): LineNumberLookup {
  // Index 0 always opens line 1, and each `\n` opens the next line at the following offset — the
  // same model as counting newlines before an offset, just precomputed.
  const lineStarts = [0];

  for (let position = 0; position < content.length; position += 1) {
    if (content.charCodeAt(position) === 10 /* \n */) {
      lineStarts.push(position + 1);
    }
  }

  return (index) => {
    const clamped = Math.max(0, Math.min(index, content.length));

    // Binary search rather than a monotonic cursor: CTX-003 queries offsets out of order (it
    // restarts `matchAll` at offset zero for each glossary alias against the same text), so a
    // cursor that only moves forward would resolve later aliases against a stale position.
    let low = 0;
    let high = lineStarts.length - 1;

    while (low < high) {
      // Bias the midpoint upward so `low` can advance; `(low + high) / 2` would stall at high - 1.
      const middle = Math.floor((low + high + 1) / 2);

      if (lineStarts[middle] <= clamped) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return low + 1;
  };
}
