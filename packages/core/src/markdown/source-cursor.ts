/**
 * Map offsets inside a container's source slice `raw` to 1-based line and column, given the
 * container's own start position. Offsets must be asked for in non-decreasing order: line
 * bookkeeping is carried forward from one call to the next instead of recounting from the start of
 * the container each time, which would make a container with many findings quadratic. Each
 * character is examined once.
 *
 * A line break is CRLF, a lone LF or a lone CR, exactly as micromark counts them for node
 * positions. Counting LF alone put everything after a lone CR on the line before it, so a finding
 * disagreed with the parser — and with an editor — about which line it was on. CRLF is one break,
 * not two: the CR is skipped and the LF that follows it counts.
 */
export function createSourceCursor(
  raw: string,
  start: { line: number; column: number },
): (offset: number) => { line: number; column: number } {
  let cursor = 0;
  let linesBefore = 0;
  // Offset in `raw` of the first character on the current line; 0 while still on the first line.
  let lineStart = 0;

  return (offset) => {
    for (; cursor < offset; cursor += 1) {
      const char = raw[cursor];
      if (char === "\n" || (char === "\r" && raw[cursor + 1] !== "\n")) {
        linesBefore += 1;
        lineStart = cursor + 1;
      }
    }
    return {
      line: start.line + linesBefore,
      // Columns come from offsets in the source itself, so a `> ` blockquote prefix or table pipe
      // before the offset is counted exactly as an editor counts it. Only the first line starts
      // part-way along a physical line, at the container's own column.
      column:
        linesBefore === 0 ? start.column + offset : offset - lineStart + 1,
    };
  };
}
