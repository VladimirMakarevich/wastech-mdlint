import { compareStrings } from "../deterministic-sort.js";
import {
  validateSkill,
  type SkillValidationIssue,
  type SkillValidationResult,
} from "./skill-model.js";

// Read and validate a committed `skills/<id>/SKILL.md` for CI. This reader hand-parses the
// *controlled* subset our static skills are authored in — the subset `synthesize` hand-renders —
// rather than accepting whatever a general YAML parser would: top-level `key: "double-quoted-scalar"`
// lines plus a single two-space-indented `metadata:` map. Anything outside that subset (a bare/unquoted value, tab indent, a stray nesting level) is
// surfaced as a validation issue, never silently mis-parsed — CI would rather fail loud than accept a
// skill it did not actually understand.
//
// Every failure path routes into `SkillValidationResult.issues` instead of throwing: the CI check validates
// all skills in one pass and reports every bad file, so a malformed frontmatter must not abort the run.

// Match a `key: value` (or bare `key:`) line, capturing indentation width so top-level entries and the
// two-space `metadata` children are told apart deterministically without depending on parse order.
const ENTRY_PATTERN = /^( *)([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.+))?$/;

function makeIssue(path: string, message: string): SkillValidationResult {
  return { ok: false, issues: [{ path, message }] };
}

// Derive the skill id from the directory that owns the SKILL.md, matching the on-disk `skills/<id>/`
// layout. Split on `/` (the path is already repo-relative POSIX by contract) and take the segment
// before the filename; a path too shallow to carry a directory is a caller error surfaced as an issue.
function deriveId(repoRelativePath: string): string | null {
  const segments = repoRelativePath.split("/");
  if (segments.length < 2) {
    return null;
  }
  return segments[segments.length - 2] ?? null;
}

export function parseStaticSkill(
  content: string,
  repoRelativePath: string,
): SkillValidationResult {
  const blockLines = frontmatterBlockLines(content);
  if (!Array.isArray(blockLines)) {
    return blockLines;
  }

  const reader = createFrontmatterReader();
  for (const rawLine of blockLines) {
    readFrontmatterLine(reader, rawLine);
  }
  const { frontmatter, issues } = reader;

  if (issues.length > 0) {
    // Sort so a multi-issue report is deterministic regardless of source line order, matching the
    // ordering `validateSkill` already applies to schema issues.
    issues.sort(
      (a, b) =>
        compareStrings(a.path, b.path) || compareStrings(a.message, b.message),
    );
    return { ok: false, issues };
  }

  const id = deriveId(repoRelativePath);
  if (id === null) {
    return makeIssue(
      "path",
      "path must contain a skill directory segment (skills/<id>/SKILL.md)",
    );
  }

  // Delegate to the single schema-backed validator (strict unknown-key rejection + the
  // repository-relative POSIX-path invariant) so static and generated skills validate one way.
  return validateSkill({
    id,
    kind: "static",
    path: repoRelativePath,
    frontmatter,
  });
}

// The lines between the frontmatter fences, or the issue that says why there is no such block.
function frontmatterBlockLines(
  content: string,
): string[] | SkillValidationResult {
  // Normalize CRLF/CR to LF before any fence detection or line splitting: a Windows checkout commits
  // `SKILL.md` with `\r\n` endings, and without this the LF-only fence/line logic below would reject
  // every otherwise-valid skill — defeating the cross-platform CI check this reader exists for.
  const normalized = content.replace(/\r\n?/g, "\n");

  // The frontmatter is the first `---`-fenced block. Match fences line-by-line and require each fence
  // to be exactly `---` (not merely a line *starting* with `---`): a substring check would accept
  // malformed terminators like `----` or `--- extra` as valid and let a broken file pass validation.
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    return makeIssue(
      "frontmatter",
      "SKILL.md must begin with a '---' frontmatter fence",
    );
  }
  const closingLine = lines.indexOf("---", 1);
  if (closingLine === -1) {
    return makeIssue(
      "frontmatter",
      "frontmatter fence is not terminated with a closing '---'",
    );
  }
  return lines.slice(1, closingLine);
}

// What reading the frontmatter block line by line builds up, and the state carried between lines.
type FrontmatterReader = {
  readonly frontmatter: Record<string, unknown>;
  // The metadata map is only the *active* parent while indented lines follow it directly. A later
  // top-level key dedents out of it (see `readTopLevelEntry`), so a stray indented line after that
  // dedent has no open parent and must be rejected — matching YAML, where `metadata:` does not stay
  // open forever.
  activeMap: Record<string, unknown> | undefined;
  readonly issues: SkillValidationIssue[];
  // YAML would reject a mapping with duplicate keys; a plain-object model silently lets the last
  // occurrence win, so track seen keys per scope and surface a duplicate as a validation issue rather
  // than letting a malformed skill (two `name:` lines, two `metadata.homepage:` lines) pass CI.
  readonly seenTop: Set<string>;
  readonly seenMeta: Set<string>;
};

function createFrontmatterReader(): FrontmatterReader {
  return {
    frontmatter: {},
    activeMap: undefined,
    issues: [],
    seenTop: new Set<string>(),
    seenMeta: new Set<string>(),
  };
}

function readFrontmatterLine(reader: FrontmatterReader, rawLine: string): void {
  if (rawLine.trim() === "") {
    return;
  }

  const match = ENTRY_PATTERN.exec(rawLine);
  if (match === null) {
    reader.issues.push({
      path: "frontmatter",
      message: `unparseable frontmatter line: ${rawLine}`,
    });
    return;
  }

  const [, indent, key = "", rawValue] = match;
  const value = rawValue ?? "";

  if (indent === "") {
    readTopLevelEntry(reader, key, value);
  } else if (indent === "  ") {
    readMetadataEntry(reader, key, value);
  } else {
    reader.issues.push({
      path: "frontmatter",
      message: `unexpected indentation for '${key}'`,
    });
  }
}

function readTopLevelEntry(
  reader: FrontmatterReader,
  key: string,
  value: string,
): void {
  if (reader.seenTop.has(key)) {
    reader.issues.push({
      path: `frontmatter.${key}`,
      message: `duplicate frontmatter key '${key}'`,
    });
    return;
  }
  reader.seenTop.add(key);

  // `metadata:` opens a nested map; every other top-level key must carry an inline scalar and
  // dedents out of any open map so trailing indented lines cannot re-attach to it.
  if (key === "metadata" && value === "") {
    const metadata: Record<string, unknown> = {};
    reader.frontmatter.metadata = metadata;
    reader.activeMap = metadata;
    return;
  }
  reader.activeMap = undefined;
  const parsed = parseScalar(value);
  if (parsed.ok) {
    reader.frontmatter[key] = parsed.value;
  } else {
    reader.issues.push({ path: `frontmatter.${key}`, message: parsed.message });
  }
}

function readMetadataEntry(
  reader: FrontmatterReader,
  key: string,
  value: string,
): void {
  const activeMap = reader.activeMap;
  if (activeMap === undefined) {
    reader.issues.push({
      path: "frontmatter",
      message: `indented entry '${key}' has no open parent map`,
    });
    return;
  }
  if (reader.seenMeta.has(key)) {
    reader.issues.push({
      path: `frontmatter.metadata.${key}`,
      message: `duplicate metadata key '${key}'`,
    });
    return;
  }
  reader.seenMeta.add(key);

  const parsed = parseScalar(value);
  if (parsed.ok) {
    activeMap[key] = parsed.value;
  } else {
    reader.issues.push({
      path: `frontmatter.metadata.${key}`,
      message: parsed.message,
    });
  }
}

// Scalars are authored as JSON double-quoted strings; `JSON.parse` both unquotes them and rejects the
// bare/single-quoted forms our subset does not accept, turning any deviation into a reportable issue.
function parseScalar(
  raw: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (raw === "") {
    return { ok: false, message: "expected a double-quoted value" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, message: `value is not a valid JSON scalar: ${raw}` };
  }
}
