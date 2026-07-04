import type { ParsedHeading } from "../markdown/document-types.js";

// `extract-section-body` util (P3.01): return the body text of a section — the lines after a heading
// up to the next heading of the **same or higher** level (so a parent section's body includes its
// subsections, and a leaf section's body is just its own prose). Used by CTX-001 placeholder/empty
// detection.
export function extractSectionBody(
  content: string,
  headings: ParsedHeading[],
  heading: ParsedHeading
): string {
  const lines = content.split("\n");

  // The next heading at depth <= this heading's depth ends the section (nesting-aware).
  let endLine = lines.length + 1;
  for (const candidate of headings) {
    if (candidate.line > heading.line && candidate.depth <= heading.depth) {
      endLine = Math.min(endLine, candidate.line);
    }
  }

  // heading.line is 1-based; body starts on the following line (index heading.line) and runs to
  // endLine-1 inclusive (slice end is exclusive at index endLine-1).
  const body = lines.slice(heading.line, endLine - 1).join("\n");

  return body.replace(/\r/g, "");
}
