import path from "node:path";

import { CompileConfigMissingError, ConfigError } from "@wastech-mdlint/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { ToolInputError } from "../src/shared/tool-input-error.js";
import {
  errorResult,
  READ_ONLY_ANNOTATIONS,
  successResult,
  withErrorOutput,
} from "../src/shared/tool-response.js";

// A synthetic Node errno exception. Built here rather than provoked from the filesystem so the
// classifier's branches are exercised identically on Windows, macOS, and Linux — the real triggers
// (an unreadable directory, a `readdir` on a vanished path) are platform-conditional, and their
// end-to-end coverage lives in `lint-files.test.ts` / `stdio-integration.test.ts`.
function errnoError(params: {
  code: string;
  path?: string;
  message?: string;
}): Error {
  const error = new Error(
    params.message ??
      `${params.code}: permission denied, scandir '${params.path ?? ""}'`,
  );
  return Object.assign(error, {
    code: params.code,
    ...(params.path === undefined ? {} : { path: params.path }),
  });
}

const CWD = path.resolve("/analyzed/project");

function textOf(result: ReturnType<typeof errorResult>): string {
  return (result.content[0] as { text: string }).text;
}

describe("successResult", () => {
  it("carries structuredContent plus a text summary", () => {
    const result = successResult({
      summary: "2 files",
      structured: { count: 2 },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ count: 2 });
    expect(result.content).toEqual([{ type: "text", text: "2 files" }]);
  });
});

describe("errorResult", () => {
  it("passes a structured error's code/message/hint through verbatim in structuredContent", () => {
    const result = errorResult(
      new ConfigError("CONFIG_INVALID", "bad config", "fix line 3"),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "CONFIG_INVALID",
      message: "bad config",
      hint: "fix line 3",
    });
    expect(result.content).toEqual([
      { type: "text", text: "bad config fix line 3" },
    ]);
  });

  it("wraps a plain Error as a sanitized INTERNAL_ERROR that never leaks the raw message", () => {
    const error = new Error("kaboom /Users/secret/path exploded");
    const result = errorResult(error);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected internal error occurred.",
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
      message: "An unexpected internal error occurred.",
    });
    expect(JSON.stringify(result)).not.toContain("/etc/passwd");
  });

  // W-19/P14.05: the hint is the actionable half and a host that renders only `content[].text` was
  // never shown it.
  it("appends a hint the message does not already contain to the text block", () => {
    const result = errorResult(
      new ToolInputError('Unknown rule "REF-01".', 'Did you mean "REF-001"?'),
    );
    expect(textOf(result)).toBe(
      'Unknown rule "REF-01". Did you mean "REF-001"?',
    );
  });

  it("does not repeat a hint the error already interpolated into its message", () => {
    // `CompileConfigMissingError` and `ImpactAnalysisError` build their message *from* their hint
    // (as does a `CONFIG_INVALID` `ConfigError`), so a blind concatenation would print it twice.
    const error = new CompileConfigMissingError();
    const result = errorResult(error);
    expect(textOf(result)).toBe(error.message);
    expect(textOf(result)).toContain(error.hint);
    expect(textOf(result).indexOf(error.hint)).toBe(
      textOf(result).lastIndexOf(error.hint),
    );
  });

  it("renders the message alone when there is no hint", () => {
    const result = errorResult(new ToolInputError('Unknown rule "NOPE-999".'));
    expect(textOf(result)).toBe('Unknown rule "NOPE-999".');
  });

  // W-21/P14.05: an errno naming a path inside the analyzed directory is the host's environment
  // failing, not an unexpected internal fault, and errno-plus-path is the whole actionable content —
  // the same sentence the CLI prints before exiting 2.
  it("classifies an errno inside the cwd as OPERATIONAL_ERROR with a repo-relative POSIX path", () => {
    const result = errorResult(
      errnoError({ code: "EACCES", path: path.join(CWD, "docs", "locked") }),
      { cwd: CWD },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "OPERATIONAL_ERROR",
      message: "Operational error: EACCES on docs/locked",
    });
    // No hint: an errno-specific remedy would be guesswork, so this is the conditional-hint
    // assertion's negative case.
    expect(textOf(result)).toBe("Operational error: EACCES on docs/locked");
    expect(JSON.stringify(result)).not.toContain(CWD);
  });

  it("names the analyzed directory itself as `.` when it is the failing path", () => {
    // `path.relative(cwd, cwd)` is `""`, which would render as a blank mid-sentence. Reachable in
    // practice: `stat` on a `0o000` directory succeeds (the permission bit that matters lives on the
    // parent), so the P14.01 `cwd` guard passes and the corpus walk's `readdir` is what fails.
    const result = errorResult(errnoError({ code: "EACCES", path: CWD }), {
      cwd: CWD,
    });
    expect((result.structuredContent as { message: string }).message).toBe(
      "Operational error: EACCES on .",
    );
  });

  it("sanitizes an errno whose path escapes the cwd rather than naming it", () => {
    // Stricter than the CLI, which renders a `../` chain. Here "no payload ever carries a path
    // outside the analyzed root" outweighs naming the file.
    const outside = path.resolve(CWD, "..", "elsewhere", "secret.md");
    const result = errorResult(errnoError({ code: "EACCES", path: outside }), {
      cwd: CWD,
    });

    expect(result.structuredContent).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected internal error occurred.",
    });
    expect(JSON.stringify(result)).not.toContain("secret.md");
    expect(JSON.stringify(result)).not.toContain("elsewhere");
  });

  it("sanitizes an errno that names no path", () => {
    // `ENOSPC: no space left on device, write` — and, on POSIX, `EISDIR` raised by the `read`
    // syscall — carry no `path`, so there is nothing to render and the raw message stays withheld.
    const result = errorResult(
      errnoError({
        code: "ENOSPC",
        message: "ENOSPC: no space left on device, write",
      }),
      { cwd: CWD },
    );

    expect(result.structuredContent).toEqual({
      code: "INTERNAL_ERROR",
      message: "An unexpected internal error occurred.",
    });
    expect(JSON.stringify(result)).not.toContain("no space left");
  });

  it("leaves the errno branch unreachable when the caller supplies no cwd", () => {
    // `lint`'s siblings all pass one; the guard exists because there is no base to render against
    // and inventing one would name a path relative to the wrong directory.
    const result = errorResult(
      errnoError({ code: "EACCES", path: path.join(CWD, "docs", "locked") }),
    );
    expect((result.structuredContent as { code: string }).code).toBe(
      "INTERNAL_ERROR",
    );
    expect(JSON.stringify(result)).not.toContain("locked");
  });

  it("keeps a structured error structured even when a cwd is available", () => {
    // Classification order matters: `ConfigError` carries a taxonomy code, so it must pass through
    // verbatim rather than being re-read as an errno.
    const result = errorResult(
      new ConfigError("CONFIG_NOT_FOUND", "no config"),
      {
        cwd: CWD,
      },
    );
    expect((result.structuredContent as { code: string }).code).toBe(
      "CONFIG_NOT_FOUND",
    );
  });
});

describe("withErrorOutput", () => {
  it("keeps success fields required while allowing schema-compatible error payloads", () => {
    const schema = z.object(
      withErrorOutput({
        files: z.array(z.string()),
        errorCount: z.number().int(),
      }),
    );

    expect(() =>
      schema.parse({
        code: "CONFIG_INVALID",
        message: "bad config",
        hint: "fix line 3",
      }),
    ).toThrow();

    const result = errorResult(
      new ConfigError("CONFIG_INVALID", "bad config", "fix line 3"),
      { successFields: { files: [], errorCount: 0 } },
    );

    expect(
      schema.parse(result.structuredContent as Record<string, unknown>),
    ).toEqual({
      files: [],
      errorCount: 0,
      code: "CONFIG_INVALID",
      message: "bad config",
      hint: "fix line 3",
    });
  });
});

describe("READ_ONLY_ANNOTATIONS", () => {
  it("advertises exactly the read-only hint (M7)", () => {
    expect(READ_ONLY_ANNOTATIONS).toEqual({ readOnlyHint: true });
  });
});
