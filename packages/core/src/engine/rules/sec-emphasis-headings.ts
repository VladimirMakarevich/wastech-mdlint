import type { ParsedDocument } from "../../markdown/document-types.js";
import type { PrimitiveFinding } from "../primitives/types.js";

// Emphasis-as-heading check for SEC-006. Pure over the parsed document, so it needs no filesystem
// to test. Options arrive with defaults already applied.
export type EmphasisHeadingOptions = {
  punctuation: string;
};

// markdownlint MD036's default trailing-punctuation set: ASCII `.,;:!?` plus the full-width forms
// used in CJK text. A paragraph ending in one of these reads as a sentence or a lead-in (`**Note:**`)
// rather than a title, so it is not reported.
export const DEFAULT_EMPHASIS_PUNCTUATION = ".,;:!?。，；：！？";

// The parser has already restricted `emphasisParagraphs` to top-level paragraphs holding a single
// strong/emphasis run of plain text; this applies the two remaining MD036 conditions, which depend
// on rule config or are cheap to decide here:
//
// - Text spanning more than one line is skipped: a bold run wrapped across lines is a sentence
//   emphasised in place, not a one-line title.
// - Text whose last character is in `punctuation` is skipped. The last character is taken by code
//   point (`Array.from`), not UTF-16 unit, so an astral final character such as an emoji is compared
//   whole rather than as half a surrogate pair, and a punctuation set given as a string is split the
//   same way.
//
// One pass in document order with all state local to the call, so the findings' order is fixed by
// the document alone and nothing carries over between documents.
export function emphasisHeadingFindings(
  document: ParsedDocument,
  options: EmphasisHeadingOptions,
): PrimitiveFinding[] {
  const punctuation = new Set(Array.from(options.punctuation));
  const findings: PrimitiveFinding[] = [];

  for (const paragraph of document.emphasisParagraphs) {
    if (paragraph.text.includes("\n")) {
      continue;
    }
    const text = paragraph.text.trim();
    const last = Array.from(text).at(-1);
    if (last === undefined || punctuation.has(last)) {
      continue;
    }
    findings.push({
      message: `Emphasis used instead of a heading: "${text}".`,
      line: paragraph.line,
      data: { text, kind: paragraph.kind },
    });
  }

  return findings;
}
