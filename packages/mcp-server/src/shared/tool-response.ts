import {
  isStructuredError,
  TOOL_ERROR_CODES,
  type StructuredErrorInfo,
} from "@wastech-mdlint/core";
import type {
  CallToolResult,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { toOperationalErrorInfo } from "./operational-error.js";

// Output/error/annotation conventions as reusable wrappers so every tool
// renders the same success/error shape without re-deriving it.

// The annotation every tool carries. openWorldHint/idempotentHint are intentionally omitted — they
// are not part of the decided read-only contract, and adding them would advertise hints the shipped
// tools never agreed to.
export const READ_ONLY_ANNOTATIONS: ToolAnnotations = { readOnlyHint: true };

// Success: a machine-readable structuredContent (validated against the tool's own outputSchema by
// the SDK) plus a human-readable text summary.
export function successResult(params: {
  summary: string;
  structured: Record<string, unknown>;
}): CallToolResult {
  return {
    content: [{ type: "text", text: params.summary }],
    structuredContent: params.structured,
  };
}

// Fixed, source-independent text for the INTERNAL_ERROR catch-all. A non-taxonomy throwable is
// unexpected, so its raw message must never reach the client: `error.message`/`String(error)` can
// carry absolute paths, stack fragments, or other internal detail (the error contract requires
// INTERNAL_ERROR be sanitized). Structured errors keep their own vetted messages; only this
// fallthrough is redacted.
const INTERNAL_ERROR_MESSAGE = "An unexpected internal error occurred.";

/**
 * The text block a host renders and a model reads. It carries the `hint` too: the
 * structured payload had the actionable sentence and the text did not, so a host that renders only
 * `content[].text` — the common case — saw `Unknown rule "SIZE-002".` with the did-you-mean dropped,
 * while the CLI prints both for the same typo.
 *
 * The `includes` test is not defensive noise, it is the whole reason this is a function. Some core
 * errors already interpolate their hint INTO the message — `CompileConfigMissingError` and
 * `ImpactAnalysisError` build theirs from it, and a `CONFIG_INVALID` `ConfigError`'s hint is the
 * first of the issue lines its message lists — so a blind concatenation would print those sentences
 * twice. Others do not (`CONFIG_NOT_FOUND`, `ToolInputError`), which is why the choice is per-error
 * rather than per-class. Doing it here rather than at the one offending call site is what makes a
 * newly added error path inherit the behavior.
 */
function renderErrorText(structured: StructuredErrorInfo): string {
  if (
    structured.hint === undefined ||
    structured.message.includes(structured.hint)
  ) {
    return structured.message;
  }
  return `${structured.message} ${structured.hint}`;
}

// The error contract { code, message, hint }, carried in `structuredContent` as the public
// machine result: every error carries a code alongside structured output. Three-way classification, in
// order: a structured error from core (or `ToolInputError`) passes through verbatim; a raw errno
// naming a path inside `options.cwd` becomes an OPERATIONAL_ERROR; everything else is
// wrapped as a sanitized INTERNAL_ERROR. The stack is never included, so the human-readable
// `content` message and the structured payload only ever expose vetted text.
//
// `cwd` is optional because the classifier needs a base to render the failing path against and
// cannot invent one — without it the errno branch is skipped and the old INTERNAL_ERROR behavior
// stands, which is the safe direction.
//
// For this to round-trip over the wire on the five tools that declare an `outputSchema`, each such
// error payload may need schema-compatible placeholder success fields attached to it: a
// spec-compliant client validates any present `structuredContent` against the advertised schema,
// even on `isError` results. `compile-context` has no `outputSchema`, so it passes no placeholders.
// An options object rather than positional parameters so that tool — which supplies a `cwd` and no
// placeholders — does not have to pass a mid-list `undefined`.
export function errorResult(
  error: unknown,
  options: {
    successFields?: Readonly<Record<string, unknown>>;
    cwd?: string;
  } = {},
): CallToolResult {
  const structured: StructuredErrorInfo = isStructuredError(error)
    ? { code: error.code, message: error.message, hint: error.hint }
    : ((options.cwd === undefined
        ? undefined
        : toOperationalErrorInfo(error, options.cwd)) ?? {
        code: "INTERNAL_ERROR",
        message: INTERNAL_ERROR_MESSAGE,
      });

  return {
    isError: true,
    content: [{ type: "text", text: renderErrorText(structured) }],
    // Spread unconditionally, including when there are no placeholders: `structuredContent` is typed
    // as an index-signature record, and a named interface does not satisfy one without being widened
    // into a fresh object literal. Spreading `undefined` is a no-op, so this is also the shorter form.
    structuredContent: { ...options.successFields, ...structured },
  };
}

// The error object folded into every schema-carrying tool's advertised `outputSchema` so an
// `errorResult` payload validates as structured output. `code` is constrained to the closed
// `TOOL_ERROR_CODES` taxonomy, not a bare string, so the advertised schema still documents the
// exact recoverable codes. Fields stay optional because the success schema remains the primary
// contract and only some results carry error metadata.
const ERROR_OUTPUT_SHAPE = {
  code: z.enum(TOOL_ERROR_CODES).optional(),
  message: z.string().optional(),
  hint: z.string().optional(),
} as const;

// Extend a success output shape with the optional error fields WITHOUT weakening the success
// contract. The pinned MCP SDK (1.29) validates any present `structuredContent` against the
// advertised schema even on errors, but it only advertises object schemas — a Zod union / `oneOf`
// is silently dropped. So the safe expressible shape is "success schema plus optional error
// metadata", and each tool's error path supplies schema-compatible placeholder success fields via
// `errorResult(..., successFields)`.
export function withErrorOutput(
  success: Readonly<Record<string, z.ZodTypeAny>>,
): Record<string, z.ZodTypeAny> {
  return { ...success, ...ERROR_OUTPUT_SHAPE };
}
