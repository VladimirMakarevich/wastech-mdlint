// Splices generated content between a BEGIN/END marker pair.
//
// generate-docs.mjs used to pass the generated table as the *replacement string* of
// String.prototype.replace, where `$` is a metacharacter — a `$&`, `` $` ``, `$'`, `$n` or `$$` in
// any rule or MCP tool description would have expanded instead of being written. The `$1`/`$2` in
// the very same template are deliberate back-references, which is precisely why the payload spliced
// beside them cannot be assumed inert. The damage would have been a README with the END marker
// somewhere in the middle and then a docs-sync failure on bytes nobody wrote.
//
// A replacer function's return value is used literally, so routing every splice through this one
// helper closes the class rather than escaping it case by case — the same reason
// packages/core/src/discovery/repo-scan.ts uses a replacer for glob-special characters.

/**
 * Replace the content between `markers`' two captured marker comments with `generated`, wrapped in
 * the `<!-- prettier-ignore -->` scaffolding the docs-sync tests extract on.
 *
 * @param {string} document Markdown source containing the marker pair.
 * @param {RegExp} markers Pattern capturing the BEGIN marker as group 1 and the END marker as group 2.
 * @param {string} generated Content to splice in, used literally however it is punctuated.
 * @returns {string} The document with the block replaced.
 */
export function replaceGeneratedBlock(document, markers, generated) {
  // Without this a marker pair that was renamed or lost silently no-ops, and the only thing that
  // notices is a docs-sync test in another package comparing bytes — a failure a long way from its
  // cause. Safe to test-then-replace because these patterns carry no `g` flag and so have no
  // `lastIndex` state to carry between the two calls (the `determinism` boundary guard exists
  // because a `g`-flagged RegExp's `lastIndex` did exactly that once).
  if (!markers.test(document)) {
    throw new Error(
      `Document is missing the generated-block markers ${String(markers)}`,
    );
  }

  return document.replace(
    markers,
    (_match, begin, end) =>
      `${begin}\n<!-- prettier-ignore -->\n${generated}\n\n${end}`,
  );
}
