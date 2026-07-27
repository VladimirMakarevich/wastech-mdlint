// Newline handling for the `--fix` write path (P11.09, audit L-6). Core-internal: nothing outside
// core needs it, so it stays out of the public barrel (same treatment as `engine/path-resolve.ts`).
//
// Only the two terminators Markdown tooling actually round-trips are modelled. A document's own
// style is detected from its bytes and never from `os.EOL`: the host that runs the linter is not
// necessarily the host that authored the file (a CRLF tree checked out on Linux CI is ordinary), so
// deriving the terminator from the platform is exactly the bug that produces mixed line endings.
export type DocumentNewline = "\n" | "\r\n";

/**
 * The document's newline style: whatever terminates its *first* line wins. A file with mixed
 * endings has no single truthful answer, and picking the first one keeps the fix consistent with the
 * part of the file a reader sees first. Files with no terminator at all (and files using a lone
 * classic-Mac `\r`, which `applyEdits` has no way to preserve meaningfully) fall back to `"\n"`.
 */
export function detectNewline(content: string): DocumentNewline {
  const firstLineFeed = content.indexOf("\n");
  return firstLineFeed > 0 && content[firstLineFeed - 1] === "\r"
    ? "\r\n"
    : "\n";
}

/**
 * Rewrites every `\n`/`\r\n` in `text` to `newline`. Used on fix-edit content so inserted text
 * adopts the host document's style instead of forcing LF into a CRLF file. The `\r\n` alternative is
 * matched first so an already-CRLF input is not doubled into `\r\r\n`.
 */
export function normalizeNewlines(
  text: string,
  newline: DocumentNewline,
): string {
  return newline === "\n"
    ? text.replace(/\r\n/g, "\n")
    : text.replace(/\r\n|\n/g, "\r\n");
}
