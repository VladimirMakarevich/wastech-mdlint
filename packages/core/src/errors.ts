// Structured error taxonomy shared by both hosts. Defined once in core — never re-invented in
// cli or mcp-server — so a failure renders the same `{ code, message, hint }` contract on every
// surface. The closed set is the single source of truth for what an error code may be.
//
// The closed set, and what each member means:
// - CONFIG_NOT_FOUND       — no config resolved at the requested configPath/cwd.
// - CONFIG_INVALID         — config failed JSONC/schema validation (hint = failing path).
// - FILE_NOT_IN_CORPUS     — requested file/path outside the resolved include set.
// - TARGET_NOT_FOUND       — a slice/impact query or file argument resolved to nothing.
// - COMPILE_CONFIG_MISSING — config.compile absent for compile-context.
// - INVALID_INPUT          — tool arguments failed semantic validation beyond the input schema.
// - INTERNAL_ERROR         — unexpected failure; message is sanitized and never leaks a stack trace.
//
// Amended 2026-08-06, with the decision log's entry updated in the same change:
// - OPERATIONAL_ERROR      — the host's environment failed rather than the input: an errno (EACCES,
//                            EISDIR, …) naming a path inside the analyzed directory. Split out of
//                            INTERNAL_ERROR because errno-plus-path IS the actionable content, and
//                            the CLI already prints exactly that before exiting 2.
export const TOOL_ERROR_CODES = [
  "CONFIG_NOT_FOUND",
  "CONFIG_INVALID",
  "FILE_NOT_IN_CORPUS",
  "TARGET_NOT_FOUND",
  "COMPILE_CONFIG_MISSING",
  "INVALID_INPUT",
  "OPERATIONAL_ERROR",
  "INTERNAL_ERROR",
] as const;

// Derived from the runtime array so the type and the membership check cannot drift apart.
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export interface StructuredErrorInfo {
  code: ToolErrorCode;
  message: string;
  hint?: string;
}

// Membership must be an allowlist against TOOL_ERROR_CODES, not "has a string `.code`": Node fs
// errors (ENOENT, etc.) also carry a `.code`, and duck-typing them through would leak an unrelated
// system error to an MCP client instead of falling through to a sanitized INTERNAL_ERROR.
//
// OPERATIONAL_ERROR does not weaken that: no error class carries it, and nothing throws it. A host
// classifier produces the payload from a raw errno only after vetting the code and rewriting the
// path (mcp-server's `toOperationalErrorInfo`), which is what keeps the allowlist's rationale intact
// — an fs error still reaches this predicate as a non-member and still falls through.
export function isStructuredError(
  error: unknown,
): error is Error & StructuredErrorInfo {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (TOOL_ERROR_CODES as readonly string[]).includes(
      (error as unknown as { code: string }).code,
    )
  );
}
