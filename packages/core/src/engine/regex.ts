import { z } from "zod";

// `regex-string` util, shared by the primitives and re-exported for rule use.
//
// Config carries regexes as strings (JSON has no RegExp literal). This validator rejects an invalid
// pattern at config-load time with a clear message instead of throwing mid-lint.

function isValidRegex(pattern: string, flags?: string): boolean {
  try {
    new RegExp(pattern, flags);
    return true;
  } catch {
    return false;
  }
}

export const regexStringSchema = z
  .string()
  .refine((value) => isValidRegex(value), {
    message: "expected a valid regular expression",
  });

// Optional JS regex flag string (subset of d,g,i,m,s,u,y). Validated so a bad flag surfaces as a
// config error rather than a runtime throw.
export const regexFlagsSchema = z
  .string()
  .refine((value) => isValidRegex(".", value), {
    message: "expected valid regular-expression flags",
  });

// Cross-field check for an options object carrying both `pattern` and `flags`. Validating each field
// alone is not enough: a pattern can be valid without flags and the flags valid on `.`, yet the pair
// fail to compile — `\u{110000}` is a harmless literal without `u` and an out-of-range code point
// with it. Such a config would load cleanly and then throw from `compileRegex` mid-lint, aborting
// the whole run; checking the pair here turns it into a config error at the offending `pattern`.
// Used as `.refine(isValidPatternWithFlags, patternWithFlagsIssue)` on the object schema.
export function isValidPatternWithFlags(value: {
  pattern: string;
  flags?: string | undefined;
}): boolean {
  return isValidRegex(value.pattern, value.flags);
}

export const patternWithFlagsIssue = {
  message: "expected a valid regular expression under the given flags",
  path: ["pattern"],
};

// Compile a validated pattern. Callers pass strings that already passed `regexStringSchema` and, where
// flags are configured, `isValidPatternWithFlags`, so this only throws on a genuine programming error.
export function compileRegex(pattern: string, flags?: string): RegExp {
  return new RegExp(pattern, flags);
}

// Escape regex metacharacters so a runtime string (a directory/zone name, a glossary alias) can be
// embedded in a RegExp source as a literal instead of a pattern. Un-escaped interpolation is exactly
// what let a directory named "c++" crash the whole lint run and "node.js" match more than intended.
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
