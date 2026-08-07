import type { ToolErrorCode } from "@wastech-mdlint/core";

// Error wrapping lives on the MCP boundary (architecture split: "error wrapping" is a host concern),
// so this class translates a throwable that carries no `ToolErrorCode` into one `errorResult` will
// pass through verbatim. Without it, `isStructuredError`'s allowlist rejects the throwable and it
// degrades to a sanitized `INTERNAL_ERROR`, losing exactly the actionable text the error contract exists to preserve
// — the "did you mean" suggestion behind `lint`'s `RuleResolutionError`, or the offending path behind
// a bad tool `cwd`.
//
// Shared *within mcp-server* (it started local to `tools/lint.ts` when there was one call site, and
// `shared/tool-context.ts` is the second). Still deliberately not promoted to core: the
// codes it produces are host-boundary input judgements, and core's own errors already carry their own
// taxonomy codes.
export class ToolInputError extends Error {
  readonly code: ToolErrorCode = "INVALID_INPUT";
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "ToolInputError";
    this.hint = hint;
  }
}
