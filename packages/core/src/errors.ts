// Structured error taxonomy (M6) shared by both hosts. Defined once in core — never re-invented in
// cli or mcp-server — so a failure renders the same `{ code, message, hint }` contract on every
// surface. The closed set is the single source of truth for what an error code may be.
//
// Decided 2026-07-02 (audit — P7 error-taxonomy gap):
// - CONFIG_NOT_FOUND       — no config resolved at the requested configPath/cwd.
// - CONFIG_INVALID         — config failed JSONC/schema validation (hint = failing path).
// - FILE_NOT_IN_CORPUS     — requested file/path outside the resolved include set.
// - TARGET_NOT_FOUND       — a slice/impact query or file argument resolved to nothing.
// - COMPILE_CONFIG_MISSING — config.compile absent for compile-context.
// - INVALID_INPUT          — tool arguments failed semantic validation beyond the input schema.
// - INTERNAL_ERROR         — unexpected failure; message is sanitized and never leaks a stack trace.
export const TOOL_ERROR_CODES = [
  "CONFIG_NOT_FOUND",
  "CONFIG_INVALID",
  "FILE_NOT_IN_CORPUS",
  "TARGET_NOT_FOUND",
  "COMPILE_CONFIG_MISSING",
  "INVALID_INPUT",
  "INTERNAL_ERROR"
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
export function isStructuredError(error: unknown): error is Error & StructuredErrorInfo {
  return (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (TOOL_ERROR_CODES as readonly string[]).includes((error as unknown as { code: string }).code)
  );
}
