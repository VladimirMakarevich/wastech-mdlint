import { describe, expect, it } from "vitest";

import { parseStaticSkill } from "../src/skills/parse-static-skill.js";

const PATH = "skills/wastech-mdlint-init/SKILL.md";

function frontmatter(lines: string[]): string {
  return `---\n${lines.join("\n")}\n---\n\n# Body\n`;
}

describe("parseStaticSkill", () => {
  it("accepts a full frontmatter block and derives the id from the path", () => {
    const result = parseStaticSkill(
      frontmatter([
        'name: "wastech-mdlint-init"',
        'description: "Bootstrap the tool."',
        'license: "MIT"',
        'compatibility: "coupled: same tag"',
        "metadata:",
        '  homepage: "https://example.com"',
        '  source: "https://example.com"'
      ]),
      PATH
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skill.id).toBe("wastech-mdlint-init");
      expect(result.skill.kind).toBe("static");
      expect(result.skill.path).toBe(PATH);
      expect(result.skill.frontmatter.metadata?.homepage).toBe("https://example.com");
    }
  });

  it("accepts a CRLF-terminated frontmatter block (Windows checkout)", () => {
    const lf = frontmatter([
      'name: "wastech-mdlint-init"',
      'description: "Bootstrap the tool."',
      "metadata:",
      '  homepage: "https://example.com"'
    ]);
    const result = parseStaticSkill(lf.replace(/\n/g, "\r\n"), PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skill.frontmatter.metadata?.homepage).toBe("https://example.com");
    }
  });

  it("accepts a minimal frontmatter block with only the required fields", () => {
    const result = parseStaticSkill(
      frontmatter(['name: "x"', 'description: "y"']),
      PATH
    );
    expect(result.ok).toBe(true);
  });

  it("reports a missing frontmatter fence", () => {
    const result = parseStaticSkill("# no frontmatter\n", PATH);
    expect(result).toEqual({
      ok: false,
      issues: [{ path: "frontmatter", message: expect.stringContaining("must begin with") }]
    });
  });

  it("rejects a metadata child that appears after a later top-level key dedents out", () => {
    // `metadata:` must not stay open across a dedent: `source` here belongs to no active map.
    const result = parseStaticSkill(
      frontmatter([
        'name: "x"',
        "metadata:",
        '  homepage: "https://example.com"',
        'description: "y"',
        '  source: "https://example.com"'
      ]),
      PATH
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => /no open parent map/.test(i.message))).toBe(true);
    }
  });

  it("rejects a malformed closing fence that is not exactly '---'", () => {
    const overlong = '---\nname: "x"\ndescription: "y"\n----\n\n# Body\n';
    const trailing = '---\nname: "x"\ndescription: "y"\n--- extra\n\n# Body\n';
    for (const content of [overlong, trailing]) {
      const result = parseStaticSkill(content, PATH);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues[0]?.message).toContain("not terminated");
      }
    }
  });

  it("reports an unterminated frontmatter fence", () => {
    const result = parseStaticSkill('---\nname: "x"\n', PATH);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toContain("not terminated");
    }
  });

  it("rejects an unknown top-level key via the strict schema", () => {
    const result = parseStaticSkill(
      frontmatter(['name: "x"', 'description: "y"', 'bogus: "z"']),
      PATH
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown metadata key via the strict schema", () => {
    const result = parseStaticSkill(
      frontmatter(['name: "x"', 'description: "y"', "metadata:", '  bogus: "z"']),
      PATH
    );
    expect(result.ok).toBe(false);
  });

  it("reports a duplicate top-level key instead of letting the last win", () => {
    const result = parseStaticSkill(
      frontmatter(['name: "x"', 'name: "y"', 'description: "z"']),
      PATH
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => /duplicate frontmatter key/.test(i.message))).toBe(true);
    }
  });

  it("reports a duplicate metadata key instead of letting the last win", () => {
    const result = parseStaticSkill(
      frontmatter([
        'name: "x"',
        'description: "y"',
        "metadata:",
        '  homepage: "https://a.example"',
        '  homepage: "https://b.example"'
      ]),
      PATH
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => /duplicate metadata key/.test(i.message))).toBe(true);
    }
  });

  it("reports a malformed (unquoted) scalar line", () => {
    const result = parseStaticSkill(
      frontmatter(['name: unquoted', 'description: "y"']),
      PATH
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === "frontmatter.name")).toBe(true);
    }
  });

  it("reports an indented entry with no parent map", () => {
    const result = parseStaticSkill(
      frontmatter(['name: "x"', 'description: "y"', '  orphan: "z"']),
      PATH
    );
    expect(result.ok).toBe(false);
  });

  it("emits issues sorted by path then message", () => {
    const result = parseStaticSkill(
      frontmatter(['description: bad', 'name: alsobad']),
      PATH
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((i) => i.path);
      expect(paths).toEqual([...paths].sort());
    }
  });
});
