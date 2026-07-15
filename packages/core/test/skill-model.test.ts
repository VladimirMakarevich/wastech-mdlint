import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  parseSkillFrontmatter,
  validateSkill,
  type Skill,
  type SkillKind
} from "../src/skills/skill-model.js";

function skill(overrides: Partial<Skill> = {}): unknown {
  return {
    id: "example",
    kind: "static",
    path: "skills/example/SKILL.md",
    frontmatter: { name: "Example", description: "An example skill." },
    ...overrides
  };
}

describe("validateSkill", () => {
  it("accepts a minimal skill for both kinds identically", () => {
    for (const kind of ["static", "generated"] as SkillKind[]) {
      const result = validateSkill(skill({ kind }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.skill.kind).toBe(kind);
      }
    }
  });

  it("accepts all optional frontmatter fields", () => {
    const result = validateSkill(
      skill({
        frontmatter: {
          name: "Example",
          description: "An example skill.",
          license: "MIT",
          compatibility: "claude-code",
          metadata: { homepage: "https://example.com", source: "repo" }
        }
      })
    );
    expect(result.ok).toBe(true);
  });

  it("never throws and reports sorted issues on invalid input", () => {
    // Two failures whose Zod order is arbitrary; the validator must sort them deterministically.
    const result = validateSkill(
      skill({ id: "", frontmatter: { name: "Example", description: "" } })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((issue) => issue.path);
      expect(paths).toEqual([...paths].sort());
      expect(paths).toContain("id");
      expect(paths).toContain("frontmatter.description");
    }
  });

  it("rejects a missing frontmatter name", () => {
    const result = validateSkill(skill({ frontmatter: { description: "no name" } as never }));
    expect(result.ok).toBe(false);
  });

  it("rejects unknown top-level frontmatter keys (strict schema)", () => {
    const result = validateSkill(
      skill({ frontmatter: { name: "Example", description: "x", extra: true } as never })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects unknown metadata keys (strict schema)", () => {
    const result = validateSkill(
      skill({
        frontmatter: { name: "Example", description: "x", metadata: { bogus: "v" } as never }
      })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a bad kind value", () => {
    const result = validateSkill(skill({ kind: "dynamic" as never }));
    expect(result.ok).toBe(false);
  });

  it("rejects an empty id or path", () => {
    expect(validateSkill(skill({ id: "" })).ok).toBe(false);
    expect(validateSkill(skill({ path: "" })).ok).toBe(false);
  });

  it("rejects paths that are not repository-relative POSIX", () => {
    // Backslash-separated, drive-rooted, absolute, `./`-prefixed, and root-escaping forms all
    // violate the public path invariant and must fail rather than validate.
    const invalidPaths = [
      "C:\\skills\\x\\SKILL.md",
      "skills\\x\\SKILL.md",
      "/abs/skills/x/SKILL.md",
      "./skills/x/SKILL.md",
      "../skills/x/SKILL.md",
      "skills/../../SKILL.md",
      "skills/./example/SKILL.md",
      "skills//example/SKILL.md"
    ];
    for (const path of invalidPaths) {
      expect(validateSkill(skill({ path })).ok, path).toBe(false);
    }
  });
});

describe("parseSkillFrontmatter", () => {
  it("returns the typed value on valid frontmatter", () => {
    const parsed = parseSkillFrontmatter({ name: "Example", description: "An example skill." });
    expect(parsed.name).toBe("Example");
  });

  it("throws a ZodError on invalid frontmatter", () => {
    expect(() => parseSkillFrontmatter({ name: "", description: "" })).toThrow(ZodError);
  });
});
