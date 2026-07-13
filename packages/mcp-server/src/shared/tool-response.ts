import { isStructuredError, type ToolErrorCode } from "@wastech-mdlint/core";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

// Output/error/annotation conventions (P7.01, task step 3) as reusable wrappers so every tool
// renders the same success/error shape without re-deriving it.

// Exactly the annotation M7 locks in. openWorldHint/idempotentHint are intentionally omitted — they
// are not part of the decided read-only contract, and adding them would advertise hints the shipped
// tools never agreed to.
export const READ_ONLY_ANNOTATIONS: ToolAnnotations = { readOnlyHint: true };

// Success: a machine-readable structuredContent (validated against the tool's own outputSchema by
// the SDK) plus a human-readable text summary (M1).
export function successResult(params: {
  summary: string;
  structured: Record<string, unknown>;
}): CallToolResult {
  return {
    content: [{ type: "text", text: params.summary }],
    structuredContent: params.structured
  };
}

// Fixed, source-independent text for the INTERNAL_ERROR catch-all. A non-taxonomy throwable is
// unexpected, so its raw message must never reach the client: `error.message`/`String(error)` can
// carry absolute paths, stack fragments, or other internal detail (M6/security requires
// INTERNAL_ERROR be sanitized). Structured errors keep their own vetted messages; only this
// fallthrough is redacted.
const INTERNAL_ERROR_MESSAGE = "An unexpected internal error occurred.";

// The error contract { code, message, hint } (M6). Structured errors from core pass through
// verbatim; everything else is wrapped as a sanitized INTERNAL_ERROR. The stack is never included —
// on the error path the SDK skips outputSchema validation, so this shape need not reconcile with any
// tool's success outputSchema.
export function errorResult(error: unknown): CallToolResult {
  const structured: { code: ToolErrorCode; message: string; hint?: string } = isStructuredError(error)
    ? { code: error.code, message: error.message, hint: error.hint }
    : { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE };

  return {
    isError: true,
    content: [{ type: "text", text: structured.message }],
    structuredContent: structured
  };
}
