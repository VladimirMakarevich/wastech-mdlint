import { isStructuredError, TOOL_ERROR_CODES, type ToolErrorCode } from "@wastech-mdlint/core";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

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

// The error contract { code, message, hint } (M6), carried in `structuredContent` as the public
// machine result (per M1's "carry a code with structured output"). Structured errors from core pass
// through verbatim; everything else is wrapped as a sanitized INTERNAL_ERROR. The stack is never
// included, so the human-readable `content` message and the structured payload only ever expose
// vetted text.
//
// For this to round-trip over the wire on the five tools that declare an `outputSchema`, each such
// error payload may need schema-compatible placeholder success fields attached to it: a
// spec-compliant client validates any present `structuredContent` against the advertised schema,
// even on `isError` results. `compile-context` has no `outputSchema`, so it passes no placeholders.
export function errorResult(
  error: unknown,
  successFields?: Readonly<Record<string, unknown>>
): CallToolResult {
  const structured: { code: ToolErrorCode; message: string; hint?: string } = isStructuredError(error)
    ? { code: error.code, message: error.message, hint: error.hint }
    : { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE };

  return {
    isError: true,
    content: [{ type: "text", text: structured.message }],
    structuredContent: successFields === undefined ? structured : { ...successFields, ...structured }
  };
}

// The error object folded into every schema-carrying tool's advertised `outputSchema` so an
// `errorResult` payload validates as structured output. `code` is constrained to the closed
// `TOOL_ERROR_CODES` taxonomy (M6), not a bare string, so the advertised schema still documents the
// exact recoverable codes. Fields stay optional because the success schema remains the primary
// contract and only some results carry error metadata.
const ERROR_OUTPUT_SHAPE = {
  code: z.enum(TOOL_ERROR_CODES).optional(),
  message: z.string().optional(),
  hint: z.string().optional()
} as const;

// Extend a success output shape with the optional M6 error fields WITHOUT weakening the success
// contract. The pinned MCP SDK (1.29) validates any present `structuredContent` against the
// advertised schema even on errors, but it only advertises object schemas — a Zod union / `oneOf`
// is silently dropped. So the safe expressible shape is "success schema plus optional error
// metadata", and each tool's error path supplies schema-compatible placeholder success fields via
// `errorResult(..., successFields)`.
export function withErrorOutput(
  success: Readonly<Record<string, z.ZodTypeAny>>
): Record<string, z.ZodTypeAny> {
  return { ...success, ...ERROR_OUTPUT_SHAPE };
}
