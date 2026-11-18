import type { ParsedDocument } from "../../markdown/document-types.js";
import type { PrimitiveFinding } from "../primitives/types.js";

// Missing image alt text check for CTX-005. Pure over the parsed document, so it needs no
// filesystem to test.
//
// An image is reported when its alt is empty after trimming. Whitespace-only alt (`![ ](a.png)`, a
// non-breaking space, a wrapped newline) counts as empty because it gives a reader nothing either;
// `String.prototype.trim` covers the Unicode space separators as well as ASCII whitespace, and
// needs no RegExp. The edges of the check are kept deliberately narrow so it stays predictable:
//
// - Punctuation-only alt (`![-](x.png)`) and filename-like alt (`![a.png](a.png)`) are not
//   reported. Telling a poor description from a good one is a heuristic quality judgment; this
//   check answers only "is there any text at all".
// - An image inside a link (`[![](badge.svg)](url)`) is judged like any other: the alt is still
//   all a model gets of the image, whatever the link around it says.
// - There is no decorative-image escape. CommonMark has no marker for a purely decorative image,
//   so the rule cannot tell one apart; an inline disable or the `exclude` option covers that case.
// - Reference images (`![alt][ref]`, `![alt][]`, `![alt]`) take their alt from their own brackets,
//   exactly as inline images do. One whose definition is missing never reaches `images` — the
//   dangling reference is a reference-integrity finding, not an alt-text one.
// - Raw HTML `<img>` is not a parsed image, so it is not checked.
//
// One pass over `images` in document order with all state local to the call, so the findings'
// order is fixed by the document alone.
export function imageAltFindings(document: ParsedDocument): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];

  for (const image of document.images) {
    if (image.alt.trim().length > 0) {
      continue;
    }
    findings.push({
      message: `Image "${image.rawTarget}" has no alt text; describe what the image shows.`,
      line: image.line,
      ...(image.column === undefined ? {} : { column: image.column }),
      data: { target: image.rawTarget },
    });
  }

  return findings;
}
