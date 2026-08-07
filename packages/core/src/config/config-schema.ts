import { z } from "zod";

import { assertionSchema } from "../engine/primitives/assert.js";
import { regexStringSchema } from "../engine/regex.js";

// Zod root schema for the v2 config. `.strict()` throughout so unknown keys become "unknown key"
// diagnostics rather than silent no-ops — a typo'd key must not read as a disabled feature.

export const severityOverrideSchema = z.enum(["error", "warning", "off"]);

const siteRouterSchema = z
  .object({
    preset: z.string().optional(),
    contentDir: z.string().optional(),
    defaultLocale: z.string().optional(),
  })
  .strict();

// Mirrors REF-005's `idRef` rule-options shape so the same ID definition can also feed
// the shared graph's id-ref edges without the orchestrator reaching into a resolved rule's
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

// The strict shape for `compile`. `skill` is required — a compiled SKILL.md has no meaningful
// default name or description, so an absent `skill` is a config error rather than something to
// invent. `outdir` is validated here but deliberately never read by `compileContext`: resolving an
// output directory is a host concern, so only the CLI reads it.
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
// This schema is also the built-in branch of the MCP `lint` tool's public wire schema, which is
// z.union([customRuleEntrySchema, ruleEntrySchema]) (packages/mcp-server/src/tools/lint.ts).
// It must stay permissive about `rule: "custom"` there: the MCP SDK validates tool input *before* the
// handler runs, so a malformed custom entry rejected at the wire would come back as raw
// InvalidParams text with no structuredContent instead of the { code, message, hint } payload —
// it has to reach the handler to fail as INVALID_INPUT. The config-only exclusion of "custom" lives on `standardRuleEntrySchema` below
// instead of narrowing this shared schema, keeping config load fail-closed on the same shape.
export const ruleEntrySchema = z
  .object({
    rule: z.string().min(1),
    severity: severityOverrideSchema.optional(),
    options: z.unknown().optional(),
  })
  .strict();

// The declarative custom rule entry. `assert` is the closed primitive vocabulary; the
// id grammar + reserved-prefix check are enforced in resolveCustomRule, which is authoritative.
export const customRuleEntrySchema = z
  .object({
    rule: z.literal("custom"),
    id: z.string().min(1),
    description: z.string().optional(),
    severity: severityOverrideSchema.optional(),
    // Deliberately looser than `schema.json`'s `target` enum, which is generated from the same
    // `ASSERTION_TARGETS` authority. Narrowing this to a `z.enum` would preempt resolveCustomRule's
    // check, which is *stricter* — it validates the target against the specific assert kind and says
    // which one was expected — with a generic Zod message. It would also fire earlier on the MCP
    // `lint` wire path (tools/lint.ts), where a pre-handler rejection escapes the
    // `{ code, message, hint }` contract entirely. Editor and linter cannot drift apart on the
    // vocabulary now that both read `ASSERTION_TARGETS`; the enum is a coarse pre-filter and this
    // loader defers the verdict to the one place that can give a useful one.
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

// Config-only wrapper that rejects the literal "custom": without it, {"rule":"custom"}
// (missing `id`) matched the permissive `ruleEntrySchema` instead of `customRuleEntrySchema` and
// crashed in resolveCustomRule's canonicalizeRuleId(undefined). The refine is scoped to this wrapper
// rather than `ruleEntrySchema` itself because that schema is shared with the MCP `lint` tool's wire
// schema (see the comment above `ruleEntrySchema`), which must keep accepting "custom" there.
// It stays load-bearing for *acceptance* even though `ruleEntryBranchIndex` below now decides which
// branch a rejection *renders* from: the two are independent, and dropping the refine would
// make {"rule":"custom"} a valid standard entry again.
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

/**
 * Which branch of `ruleEntryUnionSchema` a raw entry was *meant* for.
 *
 * Zod reports a union failure as one `invalid_union` issue carrying an already-formatted issue list
 * per branch, with no indication of which branch the author intended. A diagnostic that expands that
 * detail has to choose, and choosing by issue count picks the wrong branch for custom entries — a
 * typo inside an `assert` block yields two precise issues on the custom branch and one misleading
 * `Unrecognized keys: "id", "description"` on the standard branch.
 *
 * A real `z.discriminatedUnion("rule", …)` cannot express this: `standardRuleEntrySchema`'s `rule`
 * is `z.string()` (any id spelling is accepted: `ref-001`, `REF001`, …), which has no finite discriminator value set,
 * and Zod throws `Invalid discriminated union option` for such a branch. So the rule lives here, next
 * to the union, where branch order and the discrimination rule cannot drift apart.
 */
export function ruleEntryBranchIndex(entry: unknown): number {
  return typeof entry === "object" &&
    entry !== null &&
    (entry as { rule?: unknown }).rule === "custom"
    ? 0
    : 1;
}

export const lintConfigSchema = z
  .object({
    $schema: z.string().optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    respectGitignore: z.boolean().optional(),
    settings: settingsSchema.optional(),
    // Optional so a minimal config lints nothing rather than erroring; init writes a real set.
    rules: z.array(ruleEntryUnionSchema).optional(),
    compile: compileConfigSchema.optional(),
  })
  .strict();

export type LintConfig = z.infer<typeof lintConfigSchema>;
export type RuleConfigEntry = z.infer<typeof ruleEntrySchema>;
export type CustomRuleConfigEntry = z.infer<typeof customRuleEntrySchema>;
