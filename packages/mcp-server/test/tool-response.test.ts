import { ConfigError } from "@wastech-mdlint/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import {
  errorResult,
  READ_ONLY_ANNOTATIONS,
  successResult,
  withErrorOutput
} from "../src/shared/tool-response.js";

describe("successResult", () => {
  it("carries structuredContent plus a text summary", () => {
    const result = successResult({ summary: "2 files", structured: { count: 2 } });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ count: 2 });
    expect(result.content).toEqual([{ type: "text", text: "2 files" }]);
  });
});

describe("errorResult", () => {
  it("passes a structured error's code/message/hint through verbatim in structuredContent", () => {
    const result = errorResult(new ConfigError("CONFIG_INVALID", "bad config", "fix line 3"));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "CONFIG_INVALID",
      message: "bad config",
      hint: "fix line 3"
    });
    expect(result.content).toEqual([{ type: "text", text: "bad config" }]);
  });

  it("wraps a plain Error as a sanitized INTERNAL_ERROR that never leaks the raw message", () => {
    const error = new Error("kaboom /Users/secret/path exploded");
    const result = errorResult(error);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected internal error occurred."
    });
    // Neither the raw message nor the stack may reach the client.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("kaboom");
    expect(serialized).not.toContain("/Users/secret/path");
    expect(serialized).not.toContain(error.stack ?? "at ");
  });

  it("wraps a non-Error thrown value as a sanitized INTERNAL_ERROR", () => {
    const result = errorResult("leaky /etc/passwd detail");
    expect(result.structuredContent).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected internal error occurred."
    });
    expect(JSON.stringify(result)).not.toContain("/etc/passwd");
  });
});

describe("withErrorOutput", () => {
  it("keeps success fields required while allowing schema-compatible error payloads", () => {
    const schema = z.object(
      withErrorOutput({
        files: z.array(z.string()),
        errorCount: z.number().int()
      })
    );

    expect(() =>
      schema.parse({
        code: "CONFIG_INVALID",
        message: "bad config",
        hint: "fix line 3"
      })
    ).toThrow();

    const result = errorResult(new ConfigError("CONFIG_INVALID", "bad config", "fix line 3"), {
      files: [],
      errorCount: 0
    });

    expect(
      schema.parse(result.structuredContent as Record<string, unknown>)
    ).toEqual({
      files: [],
      errorCount: 0,
      code: "CONFIG_INVALID",
      message: "bad config",
      hint: "fix line 3"
    });
  });
});

describe("READ_ONLY_ANNOTATIONS", () => {
  it("advertises exactly the read-only hint (M7)", () => {
    expect(READ_ONLY_ANNOTATIONS).toEqual({ readOnlyHint: true });
  });
});
