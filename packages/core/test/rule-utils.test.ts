import { describe, expect, it } from "vitest";

import {
  isGlobPattern,
  matchesConfigGlob,
  normalizeConfigGlob,
} from "../src/discovery/globs.js";
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

// W-01 (audit F1). The absence of an ordered-negation case here is what let the shared matcher ship
// with `isMatch(input, patterns)`, a first-truthy OR in which a `!` entry compiles to an *inverting*
// matcher — so every one of these expectations was the opposite before P13.01.
describe("matchesConfigGlob ordered negation (W-01)", () => {
  it("subtracts a negated entry from a top-level include", () => {
    const include = ["docs/**", "!docs/private/**"];

    expect(matchesConfigGlob("docs/public/a.md", include)).toBe(true);
    expect(matchesConfigGlob("docs/private/secret.md", include)).toBe(false);
    // The reproduced failure shape: under the OR, a path matching *neither* positive pattern was
    // still "included", because it satisfies the inverted one.
    expect(matchesConfigGlob("src/a.md", include)).toBe(false);
  });

  it("keeps a negated exclude from swallowing the whole corpus", () => {
    const exclude = ["docs/private/**", "!docs/private/keepme.md"];

    // The blocker: `README.md` is not `docs/private/keepme.md`, so it matched the inverted entry and
    // every file in the repository was excluded — an empty corpus that exits 0 with findings unseen.
    expect(matchesConfigGlob("README.md", exclude)).toBe(false);
    expect(matchesConfigGlob("docs/private/other.md", exclude)).toBe(true);
    expect(matchesConfigGlob("docs/private/keepme.md", exclude)).toBe(false);
  });

  it("does not widen a rule-level files scope through the shared scope helper", () => {
    const scope = { files: ["docs/**", "!docs/private/**"] };

    expect(matchesFileScope("docs/a.md", scope)).toBe(true);
    expect(matchesFileScope("docs/private/p.md", scope)).toBe(false);
    // Every rule's `files`/`exclude` inherits the shared matcher, so the widening reached each of
    // them: a third file the rule was never scoped to used to be linted.
    expect(matchesFileScope("src/a.md", scope)).toBe(false);
  });

  it("applies the depth-agnostic prefix to the body of a slash-free negation", () => {
    // `**/!keep.md` (the old output) is a literal-filename pattern, so a bare `!keep.md` was a silent
    // no-op rather than a negation.
    expect(normalizeConfigGlob("!keep.md")).toBe("!**/keep.md");

    const include = ["**/*.md", "!keep.md"];
    expect(matchesConfigGlob("a.md", include)).toBe(true);
    // Slash-free negation is depth-agnostic in the same direction as slash-free inclusion.
    expect(matchesConfigGlob("keep.md", include)).toBe(false);
    expect(matchesConfigGlob("docs/keep.md", include)).toBe(false);
  });

  it("lets a later positive entry re-include what an earlier negation removed", () => {
    const include = ["docs/**", "!docs/private/**", "docs/private/keep.md"];

    expect(matchesConfigGlob("docs/a.md", include)).toBe(true);
    expect(matchesConfigGlob("docs/private/keep.md", include)).toBe(true);
    expect(matchesConfigGlob("docs/private/x.md", include)).toBe(false);

    // Order decides: the same three entries with the negation last subtract again.
    expect(
      matchesConfigGlob("docs/private/keep.md", [
        "docs/**",
        "docs/private/keep.md",
        "!docs/private/**",
      ]),
    ).toBe(false);
  });

  it("reads an all-negated list as a subtraction from everything", () => {
    expect(matchesConfigGlob("src/a.md", ["!docs/**"])).toBe(true);
    expect(matchesConfigGlob("docs/a.md", ["!docs/**"])).toBe(false);

    // "Everything" is literally every path, not every Markdown path — the reason the guide tells you
    // to keep a positive entry alongside a negation rather than relying on the fallback.
    expect(matchesConfigGlob("notes.txt", ["!docs/**"])).toBe(true);
    expect(matchesConfigGlob("notes.txt", ["**/*.md", "!docs/**"])).toBe(false);
  });

  it("strips a `./` that a negation prefix hides", () => {
    // picomatch's `./` strip is relative to the pattern start it advances past for a negation, so
    // `!./docs/**` anchors like `!docs/**` with no help from normalizeConfigGlob.
    const include = ["**/*.md", "!./docs/**"];

    expect(matchesConfigGlob("src/a.md", include)).toBe(true);
    expect(matchesConfigGlob("docs/a.md", include)).toBe(false);

    // Which makes `!./keep.md` the root-only negation the guide documents, where `!keep.md` subtracts
    // at any depth.
    expect(matchesConfigGlob("keep.md", ["**/*.md", "!./keep.md"])).toBe(false);
    expect(matchesConfigGlob("docs/keep.md", ["**/*.md", "!./keep.md"])).toBe(
      true,
    );
  });

  it("matches nothing for an empty pattern list", () => {
    expect(matchesConfigGlob("a.md", [])).toBe(false);
  });

  it("leaves a leading `!(` as the extglob it is", () => {
    // Peeling this as a negation would rewrite the working `**/!(x).md` into `!**/(x).md`, silently
    // inverting a rule's scope. picomatch opens an extglob for `!(` and only negates otherwise.
    expect(normalizeConfigGlob("!(x).md")).toBe("**/!(x).md");
    expect(matchesConfigGlob("y.md", ["!(x).md"])).toBe(true);
    expect(matchesConfigGlob("docs/y.md", ["!(x).md"])).toBe(true);
    expect(matchesConfigGlob("x.md", ["!(x).md"])).toBe(false);
  });

  it("cancels an even number of leading `!`, like picomatch", () => {
    // The prefix is re-attached verbatim, so `!!` cancels in the depth-agnostic branch exactly as it
    // already did in the slash-containing branch that passes through untouched.
    expect(normalizeConfigGlob("!!keep.md")).toBe("!!**/keep.md");
    expect(matchesConfigGlob("keep.md", ["!!keep.md"])).toBe(true);
    expect(matchesConfigGlob("a.md", ["!!keep.md"])).toBe(false);
  });

  it("matches a filename that starts with `!` through a bracket class", () => {
    // The escape hatch a user needs and the one `escapeGlobPath` (discovery/repo-scan.ts) emits. A
    // backslash escape is not it: normalizeConfigGlob rewrites every `\` to `/` for Windows paths,
    // so `\!keep.md` becomes `/!keep.md` and matches nothing — pre-existing, and why the escaper
    // uses bracket classes.
    expect(matchesConfigGlob("!keep.md", ["[!]keep.md"])).toBe(true);
    expect(matchesConfigGlob("docs/!keep.md", ["[!]keep.md"])).toBe(true);
    expect(matchesConfigGlob("keep.md", ["[!]keep.md"])).toBe(false);
  });
});

// W-03 (field F-14). The anchoring rule is now stated for users in `docs/guide/configuration.md`;
// these pin the four shapes that document answers, so the prose cannot drift from the matcher.
describe("matchesConfigGlob anchoring (W-03)", () => {
  it("matches a slash-free pattern at any depth", () => {
    expect(matchesConfigGlob("NOTE.md", ["NOTE.md"])).toBe(true);
    expect(matchesConfigGlob("docs/NOTE.md", ["NOTE.md"])).toBe(true);
    expect(matchesConfigGlob("x.md", ["*.md"])).toBe(true);
    expect(matchesConfigGlob("docs/deep/x.md", ["*.md"])).toBe(true);
  });

  it("root-anchors a pattern that contains a slash, including a leading `./`", () => {
    expect(matchesConfigGlob("NOTE.md", ["./NOTE.md"])).toBe(true);
    expect(matchesConfigGlob("docs/NOTE.md", ["./NOTE.md"])).toBe(false);

    // Why `README.md:127`'s old `node_modules/**` under-excluded a monorepo, and why `**/` is the
    // form to copy — a globstar segment matches zero segments, so the root copy stays covered.
    expect(matchesConfigGlob("node_modules/l/a.md", ["node_modules/**"])).toBe(
      true,
    );
    expect(
      matchesConfigGlob("packages/f/node_modules/l/a.md", ["node_modules/**"]),
    ).toBe(false);
    expect(
      matchesConfigGlob("packages/f/node_modules/l/a.md", [
        "**/node_modules/**",
      ]),
    ).toBe(true);
    expect(
      matchesConfigGlob("node_modules/l/a.md", ["**/node_modules/**"]),
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
