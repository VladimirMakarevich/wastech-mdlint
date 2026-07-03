import { z } from "zod";

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

// A standard rule entry. The declarative `custom` entry shape is added in P3.08 (this becomes a
// union then); options are validated per-rule by resolveRule (two-stage validation).
export const ruleEntrySchema = z
  .object({
    rule: z.string().min(1),
    severity: severityOverrideSchema.optional(),
    options: z.unknown().optional()
  })
  .strict();

export const lintConfigSchema = z
  .object({
    $schema: z.string().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    respectGitignore: z.boolean().optional(),
    settings: settingsSchema.optional(),
    // Optional so a minimal config lints nothing rather than erroring; init (P6) writes a real set.
    rules: z.array(ruleEntrySchema).optional(),
    // `compile` is opaque here; its shape is validated in P5.
    compile: z.unknown().optional()
  })
  .strict();

export type LintConfig = z.infer<typeof lintConfigSchema>;
export type RuleConfigEntry = z.infer<typeof ruleEntrySchema>;
