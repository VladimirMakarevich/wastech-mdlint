import { z } from "zod";

// `regex-string` util (used by primitives now; re-exported as a P3.01 shared util).
//
// Config carries regexes as strings (JSON has no RegExp literal). This validator rejects an invalid
// pattern at config-load time with a clear C7 message instead of throwing mid-lint.

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
  .refine((value) => isValidRegex(value), { message: "expected a valid regular expression" });

// Optional JS regex flag string (subset of d,g,i,m,s,u,y). Validated so a bad flag surfaces as a
// config error rather than a runtime throw.
export const regexFlagsSchema = z
  .string()
  .refine((value) => isValidRegex(".", value), { message: "expected valid regular-expression flags" });

// Compile a validated pattern. Callers pass strings that already passed `regexStringSchema`, so this
// only throws on a genuine programming error.
export function compileRegex(pattern: string, flags?: string): RegExp {
  return new RegExp(pattern, flags);
}
