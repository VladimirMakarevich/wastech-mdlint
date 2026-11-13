import type {
  FrontmatterValue,
  ParsedDocument,
} from "../../markdown/document-types.js";
import { compareStrings } from "../../deterministic-sort.js";
import { compileRegex } from "../regex.js";
import type { PrimitiveFinding } from "./types.js";

// Front matter primitives (FM-001 and the `frontmatter*` custom kinds). They read the YAML value
// the parse pass already produced on `document.frontmatter.parsed`; nothing here parses YAML.
//
// Every finding about a present block is reported over the block's own line range (opening to
// closing fence), because the parsed value carries no per-key positions and the block is short
// enough that its range locates the problem.

type FrontmatterMapping = { [key: string]: FrontmatterValue };

type ResolvedFrontmatter =
  | { kind: "absent" }
  | { kind: "unusable"; finding: PrimitiveFinding }
  | {
      kind: "mapping";
      value: FrontmatterMapping;
      line: number;
      endLine: number;
    };

function isMapping(value: FrontmatterValue): value is FrontmatterMapping {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Classify a document's front matter once for every primitive. A block that is not valid YAML, or
// whose root is not a mapping, yields the single finding that explains why — and every primitive
// reports it rather than skipping the document. Skipping would let a custom rule used without
// FM-001 pass green over a block it never managed to read, which is indistinguishable from a block
// that satisfies it.
export function resolveFrontmatter(
  document: ParsedDocument,
): ResolvedFrontmatter {
  const frontmatter = document.frontmatter;
  if (frontmatter === null) {
    return { kind: "absent" };
  }

  const { parsed, startLine, endLine } = frontmatter;
  if (!parsed.ok) {
    return {
      kind: "unusable",
      finding: {
        message: `Front matter is not valid YAML: ${parsed.error.message.replace(/\.+$/u, "")}.`,
        line: parsed.error.line,
        data: { error: parsed.error.message },
      },
    };
  }

  // An empty block (`---` immediately followed by `---`) parses to `null`; it declares no keys,
  // which is exactly an empty mapping, so required-key checks report each key as missing rather
  // than complaining about the block's shape.
  if (parsed.value === null) {
    return { kind: "mapping", value: {}, line: startLine, endLine };
  }
  if (!isMapping(parsed.value)) {
    return {
      kind: "unusable",
      finding: {
        message: "Front matter must be a YAML mapping of keys to values.",
        line: startLine,
        endLine,
      },
    };
  }
  return { kind: "mapping", value: parsed.value, line: startLine, endLine };
}

// Resolve a dot-separated key path (`owner.team`) through nested mappings. Only own properties are
// consulted, so a path segment such as `constructor` or `__proto__` never resolves to something the
// author did not write. A key whose own name contains a dot cannot be addressed by a path; that is
// the price of a flat string syntax for nesting.
export function lookupKeyPath(
  mapping: FrontmatterMapping,
  path: string,
): { found: true; value: FrontmatterValue } | { found: false } {
  let current: FrontmatterValue = mapping;
  for (const segment of path.split(".")) {
    if (!isMapping(current) || !Object.hasOwn(current, segment)) {
      return { found: false };
    }
    current = current[segment]!;
  }
  return { found: true, value: current };
}

// The string values a key holds, for the value checks: a scalar is one value, a list is checked item
// by item (so `tags: [a, b]` can be held to an allowed set), and `null` reads as "" because an empty
// value is what the author sees. `undefined` means the value is a mapping, or a list containing a
// collection, which no string check can judge.
function scalarValues(value: FrontmatterValue): string[] | undefined {
  const items = Array.isArray(value) ? value : [value];
  const values: string[] = [];
  for (const item of items) {
    if (item !== null && typeof item === "object") {
      return undefined;
    }
    values.push(item ?? "");
  }
  return values;
}

export type FrontmatterRequiredOptions = { keys: string[] };

// frontmatterRequired — every listed key path is present. A document without front matter is
// missing every key, so it is reported at line 0 (the whole-file sentinel) since there is no block
// to point at.
export function frontmatterRequired(
  document: ParsedDocument,
  options: FrontmatterRequiredOptions,
): PrimitiveFinding[] {
  const resolved = resolveFrontmatter(document);
  if (resolved.kind === "unusable") {
    return [resolved.finding];
  }

  const keys = [...new Set(options.keys)].sort(compareStrings);
  if (resolved.kind === "absent") {
    return keys.map((key) => ({
      message: `Document has no front matter; required key "${key}" is missing.`,
      line: 0,
      data: { key },
    }));
  }

  const findings: PrimitiveFinding[] = [];
  for (const key of keys) {
    if (!lookupKeyPath(resolved.value, key).found) {
      findings.push({
        message: `Front matter is missing required key "${key}".`,
        line: resolved.line,
        endLine: resolved.endLine,
        data: { key },
      });
    }
  }
  return findings;
}

// Shared walk for the two value checks: an absent block or an absent key is not their concern (that
// is what `frontmatterRequired` is for, mirroring how `columnInSet` skips a table without the
// column), while an unusable block and a value of the wrong shape are each reported once.
function checkValues(
  document: ParsedDocument,
  key: string,
  violation: (value: string) => PrimitiveFinding | undefined,
): PrimitiveFinding[] {
  const resolved = resolveFrontmatter(document);
  if (resolved.kind === "absent") {
    return [];
  }
  if (resolved.kind === "unusable") {
    return [resolved.finding];
  }

  const lookup = lookupKeyPath(resolved.value, key);
  if (!lookup.found) {
    return [];
  }

  const position = { line: resolved.line, endLine: resolved.endLine };
  const values = scalarValues(lookup.value);
  if (values === undefined) {
    return [
      {
        message: `Front matter key "${key}" must be a scalar or a list of scalars.`,
        ...position,
        data: { key },
      },
    ];
  }

  const findings: PrimitiveFinding[] = [];
  for (const value of values) {
    const finding = violation(value);
    if (finding !== undefined) {
      findings.push({ ...finding, ...position });
    }
  }
  return findings;
}

export type FrontmatterInSetOptions = { key: string; values: string[] };

// frontmatterInSet — the key's value (each item, for a list) is one of an allowed set. Compared
// exactly: under the failsafe schema the value is the parsed YAML string with no type resolution,
// so there is no number, boolean or case folding to account for.
export function frontmatterInSet(
  document: ParsedDocument,
  options: FrontmatterInSetOptions,
): PrimitiveFinding[] {
  const allowed = new Set(options.values);
  return checkValues(document, options.key, (value) =>
    allowed.has(value)
      ? undefined
      : {
          message: `Front matter value "${value}" for key "${options.key}" is not one of the allowed values: ${options.values.join(", ")}.`,
          line: 0,
          data: { key: options.key, value, allowed: options.values },
        },
  );
}

export type FrontmatterMatchesOptions = {
  key: string;
  pattern: string;
  flags?: string;
};

// frontmatterMatches — the key's value (each item, for a list) matches a regex.
export function frontmatterMatches(
  document: ParsedDocument,
  options: FrontmatterMatchesOptions,
): PrimitiveFinding[] {
  const regex = compileRegex(options.pattern, options.flags);
  return checkValues(document, options.key, (value) => {
    // `g`/`y` flags make a RegExp stateful: `test()` advances `lastIndex` across calls, even across
    // different strings. Reset before each list item so one item's match state cannot decide
    // whether the next one passes.
    regex.lastIndex = 0;
    return regex.test(value)
      ? undefined
      : {
          message: `Front matter value "${value}" for key "${options.key}" does not match ${options.pattern}.`,
          line: 0,
          data: { key: options.key, value, pattern: options.pattern },
        };
  });
}
