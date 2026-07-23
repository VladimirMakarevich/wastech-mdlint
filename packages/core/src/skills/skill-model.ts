import { z } from "zod";
import { compareStrings } from "../deterministic-sort.js";
import { skillFrontmatterSchema, type SkillFrontmatter } from "../compile/skill-frontmatter.js";

// Unified skill model (S5). Static skills (P8) and the compiler's generated output (P5) are the
// same shape so the two provenances stay provably interchangeable. The `frontmatter` field is the
// P5.04 `skillFrontmatterSchema` by import — never a parallel definition — which is what keeps
// generated and static skills validating against one contract (S1).
export type SkillKind = "static" | "generated";

// `Skill.path` is public core data, so it must be an already-normalized repository-relative POSIX
// path here rather than trusting callers: no backslashes (Windows separators) and no drive-rooted
// prefix, and every `/`-segment must be a real name. Splitting and rejecting empty, `.`, and `..`
// segments enforces the full normalized form in one pass — it rules out absolute paths (leading
// empty segment), `//` and trailing slashes (empty segments), `.`/`./` (dot segments), and any
// `..` that would escape the repository root. A failing path is rejected (surfaced as a
// validation issue) instead of silently normalized, so CI gets a diagnostic pointing at the
// offending skill.
function isRepoRelativePosixPath(value: string): boolean {
  if (value.includes("\\") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export const skillModelSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["static", "generated"]),
    path: z
      .string()
      .min(1)
      .refine(isRepoRelativePosixPath, {
        message: "path must be a repository-relative POSIX path",
      }),
    frontmatter: skillFrontmatterSchema,
  })
  .strict();

export type Skill = z.infer<typeof skillModelSchema>;

export interface SkillValidationIssue {
  // Dotted Zod path (`issue.path.join(".")`) to the offending field, e.g. `frontmatter.name`.
  path: string;
  message: string;
}

export type SkillValidationResult =
  | { ok: true; skill: Skill }
  | { ok: false; issues: SkillValidationIssue[] };

// Two entry points wrap the one schema because the two callers need opposite ergonomics:
// CI (P8.05) wants per-file structured diagnostics without throwing so it can report every bad
// skill in one pass, while `synthesize` (P5.04) throws a ZodError and a pinned test depends on it.

// Non-throwing validator for CI and model construction. Issues are sorted (by path, then message)
// so a report over multiple skills is deterministic regardless of Zod's internal issue order.
export function validateSkill(input: unknown): SkillValidationResult {
  const result = skillModelSchema.safeParse(input);
  if (result.success) {
    return { ok: true, skill: result.data };
  }

  const issues = result.error.issues
    .map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    .sort((a, b) => compareStrings(a.path, b.path) || compareStrings(a.message, b.message));

  return { ok: false, issues };
}

// Throwing frontmatter validator for `synthesize`, which relies on a ZodError propagating out.
export function parseSkillFrontmatter(input: unknown): SkillFrontmatter {
  return skillFrontmatterSchema.parse(input);
}
