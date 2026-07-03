import type { ParsedDocument } from "../../markdown/document-types.js";
import { compileRegex } from "../regex.js";
import { extractSectionBody } from "../section-body.js";
import { findLineNumber } from "../text-position.js";
import type { PrimitiveFinding } from "./types.js";

export type ContentNotMatchOptions = { pattern: string; flags?: string };

// contentNotMatch — the raw content must NOT match the pattern; each match is reported at its line.
export function contentNotMatch(
  document: ParsedDocument,
  options: ContentNotMatchOptions
): PrimitiveFinding[] {
  // matchAll requires the global flag; add it if the caller omitted it.
  const flags = options.flags?.includes("g") ? options.flags : `${options.flags ?? ""}g`;
  const regex = compileRegex(options.pattern, flags);

  const findings: PrimitiveFinding[] = [];

  for (const match of document.content.matchAll(regex)) {
    findings.push({
      message: `Content matches disallowed pattern ${options.pattern}: "${match[0]}".`,
      line: findLineNumber(document.content, match.index ?? 0),
      data: { pattern: options.pattern, match: match[0] }
    });
  }

  return findings;
}

// Locked default placeholder set (audit 3.1). The `placeholders` option *extends* this (union).
export const DEFAULT_PLACEHOLDERS = ["TBD", "TODO", "WIP", "FIXME", "N/A"] as const;

export type NoPlaceholdersOptions = { section?: string; placeholders?: string[] };

// Whole-body placeholder check (case-insensitive, optional trailing `:`) — NOT substring, so prose
// that merely mentions a token is not flagged (audit 3.1).
function classifyBody(body: string, placeholders: Set<string>): "empty" | "placeholder" | undefined {
  const trimmed = body.trim();

  if (trimmed.length === 0) {
    return "empty";
  }

  const normalized = trimmed.replace(/:$/, "").trim().toLowerCase();

  return placeholders.has(normalized) ? "placeholder" : undefined;
}

// noPlaceholders — sections must have real content: neither empty nor a bare placeholder token
// (CTX-001). With `section`, only that section is checked; otherwise every section is.
export function noPlaceholders(
  document: ParsedDocument,
  options: NoPlaceholdersOptions
): PrimitiveFinding[] {
  const placeholders = new Set(
    [...DEFAULT_PLACEHOLDERS, ...(options.placeholders ?? [])].map((token) => token.toLowerCase())
  );

  const headings =
    options.section === undefined
      ? document.headings
      : document.headings.filter((heading) => heading.text === options.section);

  const findings: PrimitiveFinding[] = [];

  for (const heading of headings) {
    const body = extractSectionBody(document.content, document.headings, heading);
    const classification = classifyBody(body, placeholders);

    if (classification === undefined) {
      continue;
    }

    findings.push({
      message:
        classification === "empty"
          ? `Section "${heading.text}" is empty.`
          : `Section "${heading.text}" contains only a placeholder.`,
      line: heading.line,
      data: { section: heading.text, kind: classification }
    });
  }

  return findings;
}
