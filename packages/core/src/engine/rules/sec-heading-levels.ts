import type { ParsedDocument } from "../../markdown/document-types.js";
import {
  lookupKeyPath,
  resolveFrontmatter,
} from "../primitives/frontmatter.js";
import type { PrimitiveFinding } from "../primitives/types.js";

// Outline-integrity checks for SEC-004. Pure over the parsed document, so it needs no filesystem to
// test. Options arrive with defaults already applied, so every branch here reads a plain value.
export type HeadingLevelOptions = {
  increment: boolean;
  singleTitle: boolean;
  title: boolean;
  level: number;
  titleKey: string;
};

// Passes when the first rendered block is a heading at `level`, or when front matter carries
// `titleKey` with any value — presence only, because judging the value is what FM-001's `patterns`
// is for. Front matter that cannot be read is not reported here (FM-001 owns that error); the
// heading branch is still tried, and if it fails too the message says why the front matter could
// not rescue the document, so the outcome is never a silent pass.
function titleFinding(
  document: ParsedDocument,
  options: HeadingLevelOptions,
): PrimitiveFinding | undefined {
  const { firstBlock } = document;
  // `firstBlock` skips nothing a heading could be, so when it is a heading it is `headings[0]`.
  if (
    firstBlock?.type === "heading" &&
    document.headings[0]?.depth === options.level
  ) {
    return undefined;
  }

  const frontmatter = resolveFrontmatter(document);
  if (
    frontmatter.kind === "mapping" &&
    lookupKeyPath(frontmatter.value, options.titleKey).found
  ) {
    return undefined;
  }

  const suffix =
    frontmatter.kind === "unusable" ? " (front matter could not be read)" : "";
  return {
    message: `Document does not start with an H${options.level} heading or declare a front matter "${options.titleKey}" key${suffix}.`,
    // Line 0 is the "no specific line" sentinel: an empty or front-matter-only document has no
    // block to point at.
    line: firstBlock?.line ?? 0,
    data: { check: "title", level: options.level, titleKey: options.titleKey },
  };
}

// Findings come out as the title finding first, then one pass over the headings in document order,
// so the output order is fixed by the document alone.
export function headingLevelFindings(
  document: ParsedDocument,
  options: HeadingLevelOptions,
): PrimitiveFinding[] {
  const findings: PrimitiveFinding[] = [];

  if (options.title) {
    const finding = titleFinding(document, options);
    if (finding !== undefined) {
      findings.push(finding);
    }
  }

  // A front matter title is deliberately not counted as a top-level heading here: whether the
  // renderer shows it is site-specific, and counting it would make one `# Title` fail on some
  // documents and not others depending on metadata the reader never sees.
  let firstTitleLine: number | undefined;
  const { headings } = document;
  for (const [index, heading] of headings.entries()) {
    // The first heading never counts as a skip: where the document starts is the title check's
    // concern, and reporting it twice would be two findings for one defect. Going shallower by any
    // amount is fine, since it closes sections rather than skipping a level.
    const previous = index > 0 ? headings[index - 1] : undefined;
    if (
      options.increment &&
      previous !== undefined &&
      heading.depth > previous.depth + 1
    ) {
      findings.push({
        message: `Heading level skips from H${previous.depth} to H${heading.depth}; expected H${previous.depth + 1} or shallower.`,
        line: heading.line,
        data: {
          check: "increment",
          depth: heading.depth,
          previousDepth: previous.depth,
          previousLine: previous.line,
        },
      });
    }

    if (heading.depth === options.level) {
      if (firstTitleLine === undefined) {
        firstTitleLine = heading.line;
      } else if (options.singleTitle) {
        findings.push({
          message: `Document has more than one H${options.level} heading; the first is on line ${firstTitleLine}.`,
          line: heading.line,
          data: {
            check: "singleTitle",
            level: options.level,
            firstLine: firstTitleLine,
          },
        });
      }
    }
  }

  return findings;
}
