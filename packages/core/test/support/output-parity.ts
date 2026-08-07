// Readers that turn a **human** rendering back into structured rows, so it can be compared against
// the structured payload the same run produced — plus the lint corpus those readers are exercised on,
// which belongs here for the same reason: it is chosen to make the comparison non-vacuous.
//
// Process-boundary rendering was a whole bucket of missed defects:
// nothing diffed human text against the structured payload, and three defects lived in that gap at
// once — a dropped `hint`, a `json` vocabulary collision, and a `summary` missing its `excluded` key.
// Each was found by reading code. A test can only find them by parsing what the reader actually sees,
// which is what these do.
//
// The pattern, and why it is a shared module rather than one test: an assertion is only parity if the
// two sides come from **different formulations**. Recomputing the human side with the same helper the
// renderer uses asserts nothing about either format. So the text is parsed back out, and
// `lintMessagesAsRows` deliberately restates the location rule instead of importing
// `formatLintResultText`'s `formatLocation` — the same second-formulation discipline
// `rule-utils.test.ts` applies to glob anchoring.
//
// Imports **nothing from any package's `src`**: packages/cli and packages/mcp-server import this
// across the workspace, so pulling core's source into their Vitest module graph would couple those
// suites to core's internal layout (the constraint `large-corpus.ts` states and follows).

/**
 * The corpus every lint-parity comparison writes, and the location set it must produce.
 *
 * It lives beside the readers because it is what makes them non-vacuous: the three location shapes the
 * human formatter branches on — `-` for a whole-file finding (`SIZE-001`, twice), a bare `line`
 * (`TBL-002` on the empty `Owner` cell) and `line:column` (`REF-001` on the unresolved link) — are the
 * reason a fixture with only one of them would let two branches silently disagree. That is a property
 * of this corpus and this rule set together, so restating either in each suite meant a change to the
 * location vocabulary had to be chased through three files.
 *
 * Callers write the files with their own fixture helper (each package already has one) and compare
 * their parsed locations against {@link PARITY_LINT_FIXTURE.locations}. A suite that needs more — the
 * cross-host guard also needs a graph with real edges — extends the map rather than restating it.
 */
export const PARITY_LINT_FIXTURE: {
  readonly files: Readonly<Record<string, string>>;
  /** Sorted, so a caller compares `rows.map((row) => row.location).sort()` against it. */
  readonly locations: readonly string[];
} = {
  files: {
    "a.md": "# A\n\n[broken](missing.md)\n\nmore\nlines\nhere\n",
    "b.md": "# B\n\n| ID | Owner |\n| --- | --- |\n| REQ-1 |  |\n",
    "wastech-mdlint.config.json": JSON.stringify({
      rules: [
        { rule: "REF-001" },
        { rule: "SIZE-001", options: { lines: { warn: 2 } } },
        { rule: "TBL-002", options: { columns: ["Owner"] } },
      ],
    }),
  },
  locations: ["-", "-", "3:1", "5"],
};

/** The subset of a `LintMessage` these comparisons read. Restated so this module needs no core import. */
export type ParityLintMessage = {
  ruleId: string;
  severity: string;
  message: string;
  filePath: string;
  line: number;
  column?: number;
};

export type LintFindingRow = {
  filePath: string;
  location: string;
  severity: string;
  message: string;
  ruleId: string;
};

// `label (N):`, with the header's own indent already stripped by the caller below. Requiring a
// non-space first character after that strip is what keeps one nesting level from reading another's
// headers: at `headerIndent = ""` a `  files outside corpus (N):` is skipped, and at `"  "` a
// top-level `reading order (N):` is. One level per call, so a section's items are never the wrong
// block's. (`  cluster 1 (76 files):` is excluded at every level by the `(\d+)` — the count is not
// bare there, which is the one place the human format varies on purpose.)
const SECTION_HEADER = /^(?<label>[^\s].*) \((?<count>\d+)\):$/;

/**
 * Read every `label (N):` section of a human report into `label -> items`.
 *
 * Items are the immediately following lines prefixed by `indent`; the section ends at the first line
 * that is not. Throws when a header's own count disagrees with the items emitted under it — the
 * header would otherwise be a claim the section contradicts, and every caller wants that to fail.
 *
 * `headerIndent` selects which nesting level to read. It exists because the graph format's coverage
 * block nests one path-bearing section (`  files outside corpus (N):`, items at four spaces), and a
 * reader that could not be pointed at it left the newest section as the one nothing compared —
 * exactly the omission shape the shared readers exist to close.
 */
export function readHumanSections(
  text: string,
  indent = "  ",
  headerIndent = "",
): Record<string, string[]> {
  // Newlines normalized so a byte comparison of parsed rows holds on Windows too.
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const sections: Record<string, string[]> = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const header = line.startsWith(headerIndent)
      ? SECTION_HEADER.exec(line.slice(headerIndent.length))
      : null;
    if (header === null) {
      continue;
    }

    const items: string[] = [];
    while (index + 1 < lines.length && lines[index + 1]!.startsWith(indent)) {
      index += 1;
      items.push(lines[index]!.slice(indent.length));
    }

    const label = header.groups!.label!;
    const claimed = Number(header.groups!.count!);
    if (claimed !== items.length) {
      throw new Error(
        `Section "${label}" claims ${claimed} items but ${items.length} follow it.`,
      );
    }
    sections[label] = items;
  }

  return sections;
}

// One finding line: `  <location>  <severity>  <message>  <ruleId>`. The message is matched greedily
// so the *last* two-space run before a trailing bare token ends it — a message that itself contains
// two consecutive spaces would otherwise split in the wrong place.
const FINDING_LINE =
  /^ {2}(?<location>\S+) {2}(?<severity>error|warning) {2}(?<message>.*) {2}(?<ruleId>\S+)$/;

/**
 * Read `formatLintResultText`'s findings back into rows, attributing each to the file header above it.
 *
 * The grouping is the part worth parsing rather than assuming: the human format prints a path once and
 * then its findings, so a message attributed to the wrong file is invisible in the text unless the
 * grouping is reconstructed.
 */
export function readLintFindingLines(text: string): LintFindingRow[] {
  const rows: LintFindingRow[] = [];
  let currentFile: string | undefined;

  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    const finding = FINDING_LINE.exec(line);
    if (finding !== null) {
      if (currentFile === undefined) {
        throw new Error(`Finding line before any file header: ${line}`);
      }
      rows.push({
        filePath: currentFile,
        location: finding.groups!.location!,
        severity: finding.groups!.severity!,
        message: finding.groups!.message!,
        ruleId: finding.groups!.ruleId!,
      });
      continue;
    }
    // A file header is the only other non-empty unindented line except the `✖ …` total.
    if (line !== "" && !line.startsWith(" ") && !line.startsWith("✖")) {
      currentFile = line;
    }
  }

  return rows;
}

/** `✖ N problems (E errors, W warnings)`, or `undefined` for the clean report. */
export function readLintSummaryLine(
  text: string,
): { total: number; errors: number; warnings: number } | undefined {
  const match =
    /^✖ (?<total>\d+) problems? \((?<errors>\d+) errors?, (?<warnings>\d+) warnings?\)$/m.exec(
      text.replaceAll("\r\n", "\n"),
    );
  return match === null
    ? undefined
    : {
        total: Number(match.groups!.total!),
        errors: Number(match.groups!.errors!),
        warnings: Number(match.groups!.warnings!),
      };
}

/**
 * Project structured lint messages into the same rows {@link readLintFindingLines} produces.
 *
 * The location rule (`-` for a whole-file finding, `line`, or `line:column`) is restated here on
 * purpose rather than imported from core: sharing one implementation would make both sides of the
 * comparison the same code, which is not parity. If the two ever disagree, one of them is the defect —
 * that is the point.
 */
export function lintMessagesAsRows(
  messages: readonly ParityLintMessage[],
): LintFindingRow[] {
  return messages.map((message) => ({
    filePath: message.filePath,
    location:
      message.line <= 0
        ? "-"
        : message.column === undefined
          ? `${message.line}`
          : `${message.line}:${message.column}`,
    severity: message.severity,
    message: message.message,
    ruleId: message.ruleId,
  }));
}
