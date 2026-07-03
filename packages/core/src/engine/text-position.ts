// `find-line-number` util (P3.01): convert a 0-based character offset in `content` to a 1-based
// line number. Newline-agnostic (`\n` count; `\r\n` shares the `\n`). Used by content primitives to
// attribute regex matches to a line.

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
