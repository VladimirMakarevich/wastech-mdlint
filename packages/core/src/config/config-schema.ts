import { z } from "zod";

import { assertionSchema } from "../engine/primitives/assert.js";
import { regexStringSchema } from "../engine/regex.js";

// Zod root schema for the v2 config (P2.04). Replaces the legacy sectioned config (D2, greenfield).
// `.strict()` throughout so unknown keys become C7 "unknown key" errors rather than silent no-ops.

export const severityOverrideSchema = z.enum(["error", "warning", "off"]);

const siteRouterSchema = z
  .object({
    preset: z.string().optional(),
    contentDir: z.string().optional(),
    defaultLocale: z.string().optional(),
  })
  .strict();

// Mirrors REF-005's `idRef` rule-options shape (audit 2.1) so the same ID definition can also feed
// the shared graph's id-ref edges (P4.06) without the orchestrator reaching into a resolved rule's
// opaque options.
const idRefSchema = z
  .object({
    idPattern: regexStringSchema,
    definitions: z.array(z.string()).min(1),
    idColumn: z.string().min(1),
  })
  .strict();

const settingsSchema = z
  .object({
    siteRouter: siteRouterSchema.optional(),
    idRef: idRefSchema.optional(),
  })
  .strict();

// Mirrors `synthesize.ts`'s structurally-equal `CompileCommandPreset` as a standalone enum schema
// (same pattern as `severityOverrideSchema` vs `engine/types.ts`'s `SeverityOverride`) so config
// validation doesn't import from `compile/`, which would invert the existing `compile -> config`
// dependency direction.
export const compileCommandPresetSchema = z.enum(["claude", "generic", "none"]);

const compileSkillSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

const compileSectionsSchema = z
  .object({
    architecture: z.boolean().optional(),
    rules: z.boolean().optional(),
    dependencies: z.boolean().optional(),
    workflow: z.boolean().optional(),
  })
  .strict();

// P5.05: the strict shape for `compile`, replacing P2.04's `z.unknown()` placeholder. `skill` is
// required (locked example: docs/mdlint_v2/requirements/01-configuration.md:47-50); `outdir` is
// validated here but deliberately never read by `compileContext` — only the CLI reads it.
export const compileConfigSchema = z
  .object({
    outdir: z.string().optional(),
    skill: compileSkillSchema,
    sections: compileSectionsSchema.optional(),
    commandPreset: compileCommandPresetSchema.optional(),
    hubMinInDegree: z.number().int().min(1).optional(),
  })
  .strict();

export type CompileConfig = z.infer<typeof compileConfigSchema>;

// A standard rule entry (built-in rules). Options are validated per-rule by resolveRule (two-stage).
// This schema is also the MCP `lint` tool's public wire schema (packages/mcp-server/src/tools/lint.ts,
// z.array(ruleEntrySchema)), which deliberately still accepts a `custom`-looking `rule` there and
// rejects it later via `resolveRule` as a structured INVALID_INPUT tool error (P12.04 decides whether
// that changes) — so it must keep accepting `rule: "custom"` here. The config-only exclusion of
// "custom" lives on `standardRuleEntrySchema` below instead of narrowing this shared schema.
export const ruleEntrySchema = z
  .object({
    rule: z.string().min(1),
    severity: severityOverrideSchema.optional(),
    options: z.unknown().optional(),
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
        assert: assertionSchema,
      })
      .strict(),
  })
  .strict();

// Config-only wrapper that rejects the literal "custom" (audit M-3): without it, {"rule":"custom"}
// (missing `id`) matched the permissive `ruleEntrySchema` instead of `customRuleEntrySchema` and
// crashed in resolveCustomRule's canonicalizeRuleId(undefined). The refine is scoped to this wrapper
// rather than `ruleEntrySchema` itself because that schema is shared with the MCP `lint` tool's wire
// schema (see the comment above `ruleEntrySchema`), which must keep accepting "custom" there.
const standardRuleEntrySchema = ruleEntrySchema.refine(
  (entry) => entry.rule !== "custom",
  {
    message: 'a "custom" rule entry also requires "id" and "options.assert"',
  },
);

// Custom entries (rule: "custom") match the custom schema; everything else is a standard entry.
// Ordered custom-first so a custom entry's extra keys aren't rejected by the strict standard schema.
// `standardRuleEntrySchema` also refine-rejects the literal "custom" (above), so a malformed custom
// entry can never fall through to the permissive standard schema — it must satisfy
// customRuleEntrySchema or the whole union fails as CONFIG_INVALID.
export const ruleEntryUnionSchema = z.union([
  customRuleEntrySchema,
  standardRuleEntrySchema,
]);

export const lintConfigSchema = z
  .object({
    $schema: z.string().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    respectGitignore: z.boolean().optional(),
    settings: settingsSchema.optional(),
    // Optional so a minimal config lints nothing rather than erroring; init (P6) writes a real set.
    rules: z.array(ruleEntryUnionSchema).optional(),
    compile: compileConfigSchema.optional(),
  })
  .strict();

export type LintConfig = z.infer<typeof lintConfigSchema>;
export type RuleConfigEntry = z.infer<typeof ruleEntrySchema>;
export type CustomRuleConfigEntry = z.infer<typeof customRuleEntrySchema>;
