import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { checkFileSizes, estimateTokens, resolveMaxBytesForFile } from "../src/rules/size.js";
import type { MarkdownFile } from "../src/types.js";

function createFile(file: Partial<MarkdownFile> & Pick<MarkdownFile, "path" | "absolutePath" | "bytes">): MarkdownFile {
  return {
    ...file
  };
}

describe("estimateTokens", () => {
  it("is deterministic for empty, short, and long text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

describe("resolveMaxBytesForFile", () => {
  it("uses the first matching override", () => {
    const config = {
      ...DEFAULT_CONFIG,
      size: {
        ...DEFAULT_CONFIG.size,
        overrides: [
          { pattern: "CLAUDE.md", maxBytes: 100 },
          { pattern: "**/*.md", maxBytes: 200 }
        ]
      }
    };

    expect(resolveMaxBytesForFile("nested/CLAUDE.md", config)).toBe(100);
  });
});

describe("checkFileSizes", () => {
  it("passes files under the default limit", () => {
    const findings = checkFileSizes({
      files: [
        createFile({
          path: "README.md",
          absolutePath: "/repo/README.md",
          bytes: 1024,
          text: "a".repeat(1024)
        })
      ],
      config: DEFAULT_CONFIG
    });

    expect(findings).toEqual([]);
  });

  it("reports files over the default limit", () => {
    const findings = checkFileSizes({
      files: [
        createFile({
          path: "README.md",
          absolutePath: "/repo/README.md",
          bytes: 70 * 1024,
          text: "a".repeat(128)
        })
      ],
      config: DEFAULT_CONFIG
    });

    expect(findings).toEqual([
      {
        ruleId: "size/max-file-size",
        severity: "warning",
        path: "README.md",
        message:
          "File is over size limit: 71680 bytes exceeds 65536 bytes (9.4% over). Estimated tokens: 32."
      }
    ]);
  });

  it("uses the CLAUDE.md override", () => {
    const findings = checkFileSizes({
      files: [
        createFile({
          path: "CLAUDE.md",
          absolutePath: "/repo/CLAUDE.md",
          bytes: 40 * 1024
        })
      ],
      config: DEFAULT_CONFIG
    });

    expect(findings).toEqual([
      {
        ruleId: "size/max-file-size",
        severity: "warning",
        path: "CLAUDE.md",
        message: "File is over size limit: 40960 bytes exceeds 32768 bytes (25.0% over)."
      }
    ]);
  });

  it("uses the skills/**/SKILL.md override", () => {
    const findings = checkFileSizes({
      files: [
        createFile({
          path: "skills/example/SKILL.md",
          absolutePath: "/repo/skills/example/SKILL.md",
          bytes: 30 * 1024
        })
      ],
      config: DEFAULT_CONFIG
    });

    expect(findings).toEqual([
      {
        ruleId: "size/max-file-size",
        severity: "warning",
        path: "skills/example/SKILL.md",
        message: "File is over size limit: 30720 bytes exceeds 24576 bytes (25.0% over)."
      }
    ]);
  });

  it("keeps token estimate advisory and omits it when text is unavailable", () => {
    const findings = checkFileSizes({
      files: [
        createFile({
          path: "README.md",
          absolutePath: "/repo/README.md",
          bytes: 70 * 1024
        })
      ],
      config: DEFAULT_CONFIG
    });

    expect(findings).toEqual([
      {
        ruleId: "size/max-file-size",
        severity: "warning",
        path: "README.md",
        message: "File is over size limit: 71680 bytes exceeds 65536 bytes (9.4% over)."
      }
    ]);
  });
});
