import { describe, expect, it } from "vitest";

import { ConfigError } from "../src/config/config-error.js";
import { CompileConfigMissingError } from "../src/compile/compile-context.js";
import { isStructuredError, TOOL_ERROR_CODES } from "../src/errors.js";
import { ImpactAnalysisError } from "../src/graph/impact-analysis.js";

describe("isStructuredError", () => {
  it("accepts core's coded error classes", () => {
    expect(isStructuredError(new ConfigError("CONFIG_INVALID", "bad"))).toBe(true);
    expect(isStructuredError(new ImpactAnalysisError("missing.md"))).toBe(true);
    expect(isStructuredError(new CompileConfigMissingError())).toBe(true);
  });

  it("rejects a plain Error with no code", () => {
    expect(isStructuredError(new Error("boom"))).toBe(false);
  });

  it("rejects a Node-style error whose code is outside the closed set", () => {
    // A raw fs error carries a string `.code` (ENOENT) but must not duck-type through — otherwise
    // an unrelated system code could leak to an MCP client instead of a sanitized INTERNAL_ERROR.
    const enoent = Object.assign(new Error("no such file"), { code: "ENOENT" });
    expect(isStructuredError(enoent)).toBe(false);
  });

  it("rejects a non-Error thrown value even if it structurally has a valid code", () => {
    expect(isStructuredError({ code: "CONFIG_INVALID", message: "x" })).toBe(false);
    expect(isStructuredError("CONFIG_INVALID")).toBe(false);
  });

  it("keeps the type and the runtime allowlist in sync", () => {
    // INTERNAL_ERROR is the catch-all wrap target and must always be a member.
    expect(TOOL_ERROR_CODES).toContain("INTERNAL_ERROR");
  });
});
