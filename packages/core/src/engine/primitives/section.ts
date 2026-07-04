import type { ParsedDocument, ParsedHeading } from "../../markdown/document-types.js";
import type { PrimitiveFinding } from "./types.js";

export type SectionPresentOptions = { sections: string[] };

// sectionPresent — each required section (by heading text) must appear (SEC-001). Absent sections
// have no line, so they report at line 0 (the P3.03 "section absent" convention).
export function sectionPresent(
  document: ParsedDocument,
  options: SectionPresentOptions
): PrimitiveFinding[] {
  const present = new Set(document.sections);

  return options.sections
    .filter((section) => !present.has(section))
    .map((section) => ({
      message: `Required section "${section}" is missing.`,
      line: 0,
      data: { section }
    }));
}

export type SectionOrderOptions = {
  order: string[];
  // Only consider headings at this depth (e.g. 2 = `##`); undefined = all depths.
  level?: number;
  // Restrict the check to the run of headings belonging to this parent section.
  section?: string;
};

// Restrict headings to the contiguous run that belongs to `section`: everything after the section
// heading, up to the next heading of same-or-higher level (flat ownership, audit 5.3).
function headingsInSection(headings: ParsedHeading[], section: string): ParsedHeading[] {
  const startIndex = headings.findIndex((heading) => heading.text === section);

  if (startIndex === -1) {
    return [];
  }

  const parentDepth = headings[startIndex]!.depth;
  const scoped: ParsedHeading[] = [];

  for (let index = startIndex + 1; index < headings.length; index += 1) {
    if (headings[index]!.depth <= parentDepth) {
      break;
    }
    scoped.push(headings[index]!);
  }

  return scoped;
}

// sectionOrder — sections listed in `order` must appear in that relative order (SEC-002). Only
// present sections are ordered (presence is SEC-001's job); the first inversion is reported.
export function sectionOrder(
  document: ParsedDocument,
  options: SectionOrderOptions
): PrimitiveFinding[] {
  let headings = options.section
    ? headingsInSection(document.headings, options.section)
    : document.headings;

  if (options.level !== undefined) {
    headings = headings.filter((heading) => heading.depth === options.level);
  }

  const findings: PrimitiveFinding[] = [];
  let lastMatchedIndex = -1;
  let lastMatchedSection: string | undefined;

  for (const wanted of options.order) {
    const headingIndex = headings.findIndex((heading) => heading.text === wanted);

    if (headingIndex === -1) {
      continue;
    }

    if (headingIndex < lastMatchedIndex) {
      findings.push({
        message: `Section "${wanted}" appears before "${lastMatchedSection}" but should come after it.`,
        line: headings[headingIndex]!.line,
        data: { section: wanted, expectedAfter: lastMatchedSection }
      });
      continue;
    }

    lastMatchedIndex = headingIndex;
    lastMatchedSection = wanted;
  }

  return findings;
}
