import { describe, expect, it } from "vitest";

import { isGlobPattern } from "../src/discovery/globs.js";
import { matchesFileScope } from "../src/engine/rules/scope.js";
import {
  createLineNumberLookup,
  findLineNumber,
} from "../src/engine/text-position.js";
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

describe("isGlobPattern", () => {
  it("classifies plain paths as literals", () => {
    // These are the shapes STR-001 must pin to one location: misclassifying any of them as a glob
    // would send it back to the corpus-only branch and re-open BL-1 for that entry.
    expect(isGlobPattern("README.md")).toBe(false);
    expect(isGlobPattern("LICENSE")).toBe(false);
    expect(isGlobPattern("docs/index.md")).toBe(false);
    expect(isGlobPattern("package.json")).toBe(false);
    expect(isGlobPattern("docs")).toBe(false);
    expect(isGlobPattern("../secret.txt")).toBe(false);
  });

  it("classifies wildcard, globstar, brace and extglob patterns as globs", () => {
    expect(isGlobPattern("docs/adr/*.md")).toBe(true);
    expect(isGlobPattern("**/README.md")).toBe(true);
    expect(isGlobPattern("a{b,c}.md")).toBe(true);
    expect(isGlobPattern("!(x).md")).toBe(true);
  });

  it("normalizes backslashes so a Windows-style path is not read as escapes", () => {
    // Unnormalized, picomatch treats `\R` as an escaped literal and the whole string parses as a
    // glob; the rule would then never probe `docs/README.md` on disk.
    expect(isGlobPattern("docs\\README.md")).toBe(false);
  });
});

describe("findLineNumber", () => {
  it("maps a character offset to a 1-based line", () => {
    const content = "one\ntwo\nthree";
    expect(findLineNumber(content, 0)).toBe(1);
    expect(findLineNumber(content, content.indexOf("two"))).toBe(2);
    expect(findLineNumber(content, content.indexOf("three"))).toBe(3);
  });

  // Deliberately a different formulation from either implementation under test (slice+split rather
  // than a charCode scan or a precomputed index), so agreement means the semantics match rather
  // than the same loop being restated three times.
  function naiveLineNumber(content: string, index: number): number {
    const clamped = Math.max(0, Math.min(index, content.length));

    return content.slice(0, clamped).split("\n").length;
  }

  // `createLineNumberLookup` feeds the `line` of every content-match finding (CTX-003,
  // contentNotMatch, id-ref edges), so a binary-search off-by-one at a line start or past EOF would
  // silently shift user-visible line numbers. Pin both forms to the reference at *every* offset.
  const fixtures: Record<string, string> = {
    lf: "one\ntwo\nthree",
    crlf: "one\r\ntwo\r\nthree",
    empty: "",
    trailingNewline: "a\n",
    blankLines: "a\n\n\nb\n",
    leadingNewline: "\nb",
  };

  for (const [name, content] of Object.entries(fixtures)) {
    it(`agrees with the naive reference at every offset (${name})`, () => {
      // Past both ends: the contract clamps, so out-of-range offsets stay in-range lines.
      for (let index = -2; index <= content.length + 2; index += 1) {
        const expected = naiveLineNumber(content, index);

        expect(findLineNumber(content, index)).toBe(expected);
        expect(createLineNumberLookup(content)(index)).toBe(expected);
      }
    });
  }

  it("resolves offsets queried out of order, as CTX-003 does per alias", () => {
    const lineAt = createLineNumberLookup("a\nb\nc\nd\ne");

    expect([lineAt(8), lineAt(0), lineAt(4), lineAt(2), lineAt(6)]).toEqual([
      5, 1, 3, 2, 4,
    ]);
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
