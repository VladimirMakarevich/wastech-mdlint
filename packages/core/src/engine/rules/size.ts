import { z } from "zod";

import { matchesConfigGlob } from "../../discovery/globs.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { estimateTokens } from "../tokens.js";

// SIZE-001 — per-file byte / line / token budget (D3, P3.07). Each metric is independently optional;
// omitting one disables that check. Metrics stay independent of each other, but the two severities
// within one metric no longer are: a metric emits at most one finding, from the highest crossed
// threshold ([P11.13]). Severity is per-finding (which threshold was crossed); the config `severity`
// override clamps via the runner (C2).
//
// What per-metric optionality could not be allowed to mean is *all three* omitted (W-04). `{"rule":
// "SIZE-001"}` then read as a valid, enabled rule that measured nothing and reported nothing — a rule
// enabled into inertness, and the only rule in the registry that permitted it: LLM-001 requires its
// entrypoints and token budget, SEC-001 its sections, SEC-002 its order. The two refinements below
// close that at both levels, matching LLM-001 rather than inventing a default budget (any byte or line
// count would be arbitrary; deriving one from a repository scan is W-39/P16.05's job).

const METRICS = ["bytes", "lines", "tokens"] as const;
type Metric = (typeof METRICS)[number];

// A threshold set with neither severity is the same defect one level down — `{"bytes":{}}` names a
// metric and still measures nothing — so it is rejected here rather than skipped at runtime.
const thresholdSchema = z
  .object({
    warn: z.number().int().positive().optional(),
    error: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (thresholds) =>
      thresholds.warn !== undefined || thresholds.error !== undefined,
    { message: "threshold requires at least one of: warn, error" },
  );

const overrideSchema = z
  .object({
    pattern: z.string().min(1),
    bytes: thresholdSchema.optional(),
    lines: thresholdSchema.optional(),
    tokens: thresholdSchema.optional(),
  })
  .strict();

// Enforced by refinement rather than by the schema shape because "at least one of three" has no shape
// Zod can express, and the alternatives are worse: marking one metric required would force a byte
// budget on a config that only wants a token one. The cost is that JSON Schema generation drops
// refinements, so an editor cannot surface this — it is a load-time diagnostic only (recorded in
// `docs/mdlint_v2/accepted-behaviors.md`).
//
// An `overrides`-only config is legitimate: per-glob thresholds with no top-level fallback measures
// every file the patterns match, so the check is "some budget exists somewhere", not "a top-level one".
const size001OptionsSchema = z
  .object({
    bytes: thresholdSchema.optional(),
    lines: thresholdSchema.optional(),
    tokens: thresholdSchema.optional(),
    overrides: z.array(overrideSchema).optional(),
  })
  .strict()
  .refine(
    (options) =>
      METRICS.some(
        (metric) =>
          options[metric] !== undefined ||
          (options.overrides ?? []).some(
            (override) => override[metric] !== undefined,
          ),
      ),
    {
      message:
        "SIZE-001 measures nothing unless at least one budget is set: configure bytes, lines, or tokens (at the top level or in an overrides entry)",
    },
  );

const METRIC_UNIT: Record<Metric, string> = {
  bytes: "bytes",
  lines: "lines",
  tokens: "tokens",
};

function countLines(content: string): number {
  // Count newline occurrences (P3.07): matches the legacy line metric.
  let count = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      count += 1;
    }
  }
  return count;
}

export const size001: RuleDefinition = defineRule({
  metadata: {
    id: "SIZE-001",
    category: "SIZE",
    description: "File stays within byte / line / token budgets.",
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: size001OptionsSchema,
  check: (options) => (context) => {
    const document = context.document!;
    const actuals: Record<Metric, number> = {
      bytes: Buffer.byteLength(document.content, "utf8"),
      lines: countLines(document.content),
      tokens: estimateTokens(document.content),
    };

    // First matching override supplies per-metric thresholds; unspecified metrics fall back to the
    // top-level option (P3.07).
    const override = (options.overrides ?? []).find((entry) =>
      matchesConfigGlob(document.path, [entry.pattern]),
    );

    for (const metric of METRICS) {
      const thresholds = override?.[metric] ?? options[metric];
      if (thresholds === undefined) {
        continue;
      }

      const actual = actuals[metric];
      const data = {
        metric,
        actual,
        warnAt: thresholds.warn,
        errorAt: thresholds.error,
      };

      // One finding per metric ([P11.13] / SC-2, superseding P3.07's independent firing): the error
      // breach supersedes the warn breach. Both reports carried the same `data`, so the survivor
      // loses nothing — and a config `severity` override (applied by the runner, invisible here) can
      // no longer render the pair as two same-severity messages for one metric.
      const breach =
        thresholds.error !== undefined && actual > thresholds.error
          ? {
              severity: "error" as const,
              budget: "error",
              limit: thresholds.error,
            }
          : thresholds.warn !== undefined && actual > thresholds.warn
            ? {
                severity: "warning" as const,
                budget: "warn",
                limit: thresholds.warn,
              }
            : undefined;
      if (breach === undefined) {
        continue;
      }

      context.report({
        severity: breach.severity,
        message: `File exceeds ${metric} ${breach.budget} budget: ${actual} ${METRIC_UNIT[metric]} > ${breach.limit}.`,
        line: 0,
        data,
        helpUri: "SIZE-001",
      });
    }
  },
});
