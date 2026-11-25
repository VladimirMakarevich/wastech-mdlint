// A UTF-8 byte order mark is U+FEFF at the very start of a file. It marks the encoding and is not
// part of the text: editors hide it, and micromark drops it before tokenizing. `readFile(…, "utf8")`
// keeps it, though, and a `--fix` write must keep it too, so the mark stays in `content`.
// `parseDocument` moves every tree offset past it, so the offsets a `ParsedDocument` exposes already
// index `content` with the mark included and must not be shifted again. Only code that derives its
// own positions from `content` - the start of the first line, say - still has to skip it.
// Core-internal, like `newline.ts`.
const BYTE_ORDER_MARK = "\uFEFF";

/**
 * How many UTF-16 code units of `content` are a leading byte order mark: `1` when it starts with
 * U+FEFF, `0` otherwise. Only offset 0 counts - a U+FEFF anywhere else is a zero-width no-break
 * space in the text, and micromark keeps it.
 */
export function byteOrderMarkLength(content: string): number {
  return content.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK.length : 0;
}
