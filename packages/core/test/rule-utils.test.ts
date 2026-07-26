import { describe, expect, it } from "vitest";

import { matchesFileScope } from "../src/engine/rules/scope.js";
import { findLineNumber } from "../src/engine/text-position.js";
import { extractSectionBody } from "../src/engine/section-body.js";
import { escapeRegExp, regexStringSchema } from "../src/engine/regex.js";
import { resolveRoutedUrl } from "../src/engine/site-router.js";
import { parseDocument } from "../src/markdown/parse-document.js";

describe("matchesFileScope (glob-match, R7)", () => {
  it("includes matching files and lets exclude win", () => {
    expect(matchesFileScope("docs/a.md", { files: ["docs/**"] })).toBe(true);
    expect(matchesFileScope("src/a.md", { files: ["docs/**"] })).toBe(false);
    expect(
      matchesFileScope("docs/legacy/a.md", {
        files: ["docs/**"],
        exclude: ["**/legacy/**"],
      }),
    ).toBe(false);
  });

  it("matches dotfiles (dot: true)", () => {
    expect(
      matchesFileScope(".claude/skills/SKILL.md", { files: ["**/*.md"] }),
    ).toBe(true);
  });
});

describe("findLineNumber", () => {
  it("maps a character offset to a 1-based line", () => {
    const content = "one\ntwo\nthree";
    expect(findLineNumber(content, 0)).toBe(1);
    expect(findLineNumber(content, content.indexOf("two"))).toBe(2);
    expect(findLineNumber(content, content.indexOf("three"))).toBe(3);
  });
});

describe("extractSectionBody", () => {
  it("returns body up to the next same-or-higher heading (nesting-aware)", () => {
    const content = [
      "# Top",
      "intro",
      "## Sub",
      "detail",
      "# Next",
      "after",
    ].join("\n");
    const doc = parseDocument({ path: "d.md", content });

    const top = doc.headings.find((heading) => heading.text === "Top")!;
    const sub = doc.headings.find((heading) => heading.text === "Sub")!;

    // Top includes its subsection; Sub is just its own prose.
    expect(extractSectionBody(content, doc.headings, top)).toContain("## Sub");
    expect(extractSectionBody(content, doc.headings, top)).not.toContain(
      "after",
    );
    expect(extractSectionBody(content, doc.headings, sub).trim()).toBe(
      "detail",
    );
  });
});

describe("regexStringSchema", () => {
  it("accepts valid patterns and rejects invalid ones", () => {
    expect(regexStringSchema.safeParse("^REQ-\\d+$").success).toBe(true);
    expect(regexStringSchema.safeParse("(unclosed").success).toBe(false);
  });
});

describe("escapeRegExp", () => {
  it("escapes metacharacters so a raw string embeds as a literal, not a pattern", () => {
    // "c++" is itself an invalid regex ("nothing to repeat") — go through
    // `regexStringSchema` rather than a literal `new RegExp("c++")` here, since the
    // no-invalid-regexp lint rule would (rightly) flag that as unescaped regex source.
    expect(regexStringSchema.safeParse("c++").success).toBe(false);
    expect(new RegExp(escapeRegExp("c++")).test("c++")).toBe(true);

    expect(() => new RegExp(escapeRegExp("we)ird"))).not.toThrow();

    const dotRegex = new RegExp(escapeRegExp("node.js"));
    expect(dotRegex.test("node.js")).toBe(true);
    expect(dotRegex.test("nodeXjs")).toBe(false);
  });
});

describe("resolveRoutedUrl (site-router, Starlight)", () => {
  it("maps a root-relative URL to content-dir candidates", () => {
    const candidates = resolveRoutedUrl("/guide/intro", {
      preset: "starlight",
      contentDir: "src/content/docs",
    });
    expect(candidates).toContain("src/content/docs/guide/intro.md");
    expect(candidates).toContain("src/content/docs/guide/intro/index.md");
  });

  it("resolves same-locale first for a non-default-locale source", () => {
    const candidates = resolveRoutedUrl(
      "/guide",
      {
        preset: "starlight",
        contentDir: "src/content/docs",
        defaultLocale: "en",
      },
      "de",
    );
    expect(candidates[0]).toBe("src/content/docs/de/guide.md");
    expect(candidates).toContain("src/content/docs/guide.md");
  });

  it("treats unknown presets as repo-root-relative", () => {
    expect(resolveRoutedUrl("/x/y", { preset: "other" })).toEqual(["x/y"]);
  });
});
