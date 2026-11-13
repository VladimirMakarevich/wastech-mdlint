import type { ParsedDocument } from "../../markdown/document-types.js";
import type { PrimitiveFinding } from "../primitives/types.js";

// Duplicate-heading check for SEC-005. Pure over the parsed document, so it needs no filesystem to
// test. Options arrive with defaults already applied.
export type DuplicateHeadingOptions = {
  siblingsOnly: boolean;
};

// Headings are compared by exact `heading.text`: the parser already renders it (inline formatting
// stripped, so `**Usage**` and `Usage` are the same text), and it is the identity every `section`
// option matches against (`heading.text === section` in the section primitives, `table.section ===
// section` in the TBL rules) — so exact-text repeats are precisely the ones that make `section`
// ambiguous. Case is deliberately not folded: `Usage` and `usage` still collide
// as slugs, but a case-insensitive rule would report headings that `section` tells apart.
//
// With `siblingsOnly`, two headings collide only when they share a parent (the nearest preceding
// shallower heading, or the document root) and a depth, so a changelog's repeated `### Added` under
// different releases passes while two `### Added` under one release do not.
//
// One pass in document order, with the map and stack local to the call, so the findings' order is
// fixed by the document alone and nothing carries over between documents.
export function duplicateHeadingFindings(
  document: ParsedDocument,
  options: DuplicateHeadingOptions,
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];
  const firstLineByKey = new Map<string, number>();
  const ancestors: { index: number; depth: number }[] = [];

  for (const [index, heading] of document.headings.entries()) {
    while (
      ancestors.length > 0 &&
      ancestors[ancestors.length - 1]!.depth >= heading.depth
    ) {
      ancestors.pop();
    }
    const parentIndex = ancestors[ancestors.length - 1]?.index ?? -1;
    ancestors.push({ index, depth: heading.depth });

    // An empty heading (`#` alone) is a different defect; two of them would yield a finding about
    // the text `""`, which tells the reader nothing.
    if (heading.text === "") {
      continue;
    }

    // The first two fields are integers and the text comes last, so the joined key cannot alias two
    // different triples whatever characters the text holds.
    const key = options.siblingsOnly
      ? `${parentIndex}\u0000${heading.depth}\u0000${heading.text}`
      : heading.text;
    const firstLine = firstLineByKey.get(key);
    if (firstLine === undefined) {
      firstLineByKey.set(key, heading.line);
      continue;
    }

    // Every repeat names the first occurrence rather than the previous one, so a third copy is its
    // own finding pointing at the same original.
    findings.push({
      message: `Heading "${heading.text}" duplicates the heading on line ${firstLine}.`,
      line: heading.line,
      data: { text: heading.text, firstLine, depth: heading.depth },
    });
  }

  return findings;
}
