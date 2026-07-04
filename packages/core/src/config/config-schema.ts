import { z } from "zod";

import { assertionSchema } from "../engine/primitives/assert.js";

// Zod root schema for the v2 config (P2.04). Replaces the legacy sectioned config (D2, greenfield).
// `.strict()` throughout so unknown keys become C7 "unknown key" errors rather than silent no-ops.

export const severityOverrideSchema = z.enum(["error", "warning", "off"]);

const siteRouterSchema = z
  .object({
    preset: z.string().optional(),
    contentDir: z.string().optional(),
    defaultLocale: z.string().optional()
  })
  .strict();

const settingsSchema = z.object({ siteRouter: siteRouterSchema.optional() }).strict();

// A standard rule entry (built-in rules). Options are validated per-rule by resolveRule (two-stage).
export const ruleEntrySchema = z
  .object({
    rule: z.string().min(1),
    severity: severityOverrideSchema.optional(),
    options: z.unknown().optional()
  })
  .strict();

// The declarative custom rule entry (P3.08 / R9). `assert` is the closed primitive vocabulary; the
// id grammar + reserved-prefix check are enforced in resolveCustomRule (authoritative, C7).
export const customRuleEntrySchema = z
  .object({
    rule: z.literal("custom"),
    id: z.string().min(1),
    description: z.string().optional(),
    severity: severityOverrideSchema.optional(),
    target: z.string().optional(),
    options: z
      .object({
        files: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        assert: assertionSchema
      })
      .strict()
  })
  .strict();

// Custom entries (rule: "custom") match the custom schema; everything else is a standard entry.
// Ordered custom-first so a custom entry's extra keys aren't rejected by the strict standard schema.
export const ruleEntryUnionSchema = z.union([customRuleEntrySchema, ruleEntrySchema]);

export const lintConfigSchema = z
  .object({
    $schema: z.string().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    respectGitignore: z.boolean().optional(),
    settings: settingsSchema.optional(),
    // Optional so a minimal config lints nothing rather than erroring; init (P6) writes a real set.
    rules: z.array(ruleEntryUnionSchema).optional(),
    // `compile` is opaque here; its shape is validated in P5.
    compile: z.unknown().optional()
  })
  .strict();

export type LintConfig = z.infer<typeof lintConfigSchema>;
export type RuleConfigEntry = z.infer<typeof ruleEntrySchema>;
export type CustomRuleConfigEntry = z.infer<typeof customRuleEntrySchema>;
