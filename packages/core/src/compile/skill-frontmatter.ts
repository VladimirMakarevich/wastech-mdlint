import { z } from "zod";

// SKILL.md frontmatter schema (S1). P5.04 (`synthesize`) is the first consumer — it validates
// generated frontmatter against this schema before rendering it. P8.01's static skills and P9's CI
// check must import this exact export rather than redefine it, so the shape never forks across the
// three call sites.
export const skillFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    // Optional fields exist only for P8.01's static skills; P5.04-generated frontmatter never
    // populates them because `compile.skill` supplies just `name`/`description`.
    license: z.string().optional(),
    compatibility: z.string().optional(),
    metadata: z
      .object({
        homepage: z.string().optional(),
        source: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;
