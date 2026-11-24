import type {
  ParsedDocument,
  ParsedHeading,
} from "../markdown/document-types.js";
import { normalizeText } from "./text-diff.js";

// A document cut into the units a reader reviews one at a time: what comes before the first second-
// or third-level heading, and each such heading with the text up to the next one. The levels are the
// ones an outline lists, so every unit has a place a reader can see and point at; a deeper heading
// belongs to the unit above it, and the title belongs to what comes before the first section.

// The heading levels that start a unit of their own.
const SECTION_DEPTHS = new Set([2, 3]);

export type DocumentSection = {
  /**
   * The section's identity across versions: its heading's slug, or `""` for the text before the
   * first section. A renamed heading has a new slug, and so is a new section.
   */
  key: string;
  heading?: ParsedHeading;
  /** The section's lines, from 1, both included; empty text has `end` below `start`. */
  start: number;
  end: number;
  /** Its own text only — the next section, at whatever level, starts where this one ends. */
  text: string;
};

export function documentSections(document: ParsedDocument): DocumentSection[] {
  const text = normalizeText(document.content);
  const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
  const starts = document.headings.filter((heading) =>
    SECTION_DEPTHS.has(heading.depth),
  );
  const sections: DocumentSection[] = [];
  const section = (
    key: string,
    start: number,
    end: number,
    heading?: ParsedHeading,
  ) => {
    sections.push({
      key,
      ...(heading === undefined ? {} : { heading }),
      start,
      end,
      // Without the blank lines that separate it from the next section: the last section has none
      // after it, and gains them when a section is added below, which is no change to its own text.
      text: lines
        .slice(start - 1, Math.max(start - 1, end))
        .join("\n")
        .replace(/\n\s*$/, ""),
    });
  };
  section("", 1, (starts[0]?.line ?? lines.length + 1) - 1);
  starts.forEach((heading, index) => {
    section(
      heading.slug,
      heading.line,
      (starts[index + 1]?.line ?? lines.length + 1) - 1,
      heading,
    );
  });
  return sections;
}
