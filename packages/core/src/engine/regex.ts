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

// Compile a validated pattern. Callers pass strings that already passed `regexStringSchema`, so this
// only throws on a genuine programming error.
export function compileRegex(pattern: string, flags?: string): RegExp {
  return new RegExp(pattern, flags);
}

// Escape regex metacharacters so a runtime string (a directory/zone name, a glossary alias) can be
// embedded in a RegExp source as a literal instead of a pattern. Un-escaped interpolation is exactly
// what let a directory named "c++" crash the whole lint run and "node.js" match more than intended.
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
