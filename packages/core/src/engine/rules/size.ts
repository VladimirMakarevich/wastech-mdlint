import { z } from "zod";

import { matchesConfigGlob } from "../../discovery/globs.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { measureDocument } from "../document-metrics.js";
import { TOKEN_ESTIMATE_NOTE } from "../tokens.js";

// SIZE-001 — per-file byte / line / token budget. Each metric is independently optional;
// omitting one disables that check. Metrics stay independent of each other, but the two severities
// within one metric no longer are: a metric emits at most one finding, from the highest crossed
// threshold. Severity is per-finding (which threshold was crossed); the config `severity`
// override clamps via the runner.
//
// What per-metric optionality could not be allowed to mean is *all three* omitted. `{"rule":
// "SIZE-001"}` then read as a valid, enabled rule that measured nothing and reported nothing — a rule
// enabled into inertness, and the only rule in the registry that permitted it: LLM-001 requires its
// entrypoints and token budget, SEC-001 its sections, SEC-002 its order. The two refinements below
// close that at both levels, matching LLM-001 rather than inventing a default budget (any byte or line
// count would be arbitrary, and deriving one from a repository scan was considered and declined).

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
// refinements, so an editor cannot surface this — it is a load-time diagnostic only. Accepted:
// the alternative is duplicating the constraint into hand-written schema that would then drift.
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

type Size001Options = z.infer<typeof size001OptionsSchema>;
type Thresholds = z.infer<typeof thresholdSchema>;

export type SizeMetric = Metric;

/** The budget SIZE-001 holds one file to: which override matched it, and each metric's thresholds. */
export type SizeBudget = {
  // The first override whose pattern matches the file. Only the first counts: a later, broader one
  // that also matches supplies nothing.
  override?: { index: number; pattern: string };
  // Per metric, the thresholds that apply and where they come from. A metric the matching override
  // leaves out falls back to the top-level option — not to a broader override further down — and a
  // metric set in neither place is not measured for this file at all.
  metrics: Partial<
    Record<Metric, Thresholds & { from: "override" | "top-level" }>
  >;
};

/**
 * The budget SIZE-001 applies to `filePath` under `options`. The rule measures against exactly this,
 * and a host that explains a finding (the fix prompts) reads it from here too, so the explanation
 * cannot describe a different budget from the one that produced the finding.
 */
export function sizeBudget(
  options: Size001Options,
  filePath: string,
): SizeBudget {
  const index = (options.overrides ?? []).findIndex((entry) =>
    matchesConfigGlob(filePath, [entry.pattern]),
  );
  const override = index === -1 ? undefined : options.overrides![index]!;
  const metrics: SizeBudget["metrics"] = {};
  for (const metric of METRICS) {
    const fromOverride = override?.[metric];
    const thresholds = fromOverride ?? options[metric];
    if (thresholds !== undefined) {
      metrics[metric] = {
        ...thresholds,
        from: fromOverride === undefined ? "top-level" : "override",
      };
    }
  }
  return {
    override:
      override === undefined ? undefined : { index, pattern: override.pattern },
    metrics,
  };
}

/** `sizeBudget` for options as they stand in a config entry, or `undefined` when they do not parse. */
export function sizeBudgetForEntry(
  options: unknown,
  filePath: string,
): SizeBudget | undefined {
  const parsed = size001OptionsSchema.safeParse(options);
  return parsed.success ? sizeBudget(parsed.data, filePath) : undefined;
}

const METRIC_UNIT: Record<Metric, string> = {
  bytes: "bytes",
  lines: "lines",
  tokens: "tokens",
};

export const size001: RuleDefinition = defineRule({
  metadata: {
    id: "SIZE-001",
    alias: "file-size-budget",
    category: "SIZE",
    description: "File stays within byte / line / token budgets.",
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: size001OptionsSchema,
  check: (options) => (context) => {
    const document = context.document!;
    const actuals: Record<Metric, number> = measureDocument(document.content);

    const budget = sizeBudget(options, document.path);

    for (const metric of METRICS) {
      const thresholds = budget.metrics[metric];
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

      // One finding per metric, not one per crossed threshold: the error
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
        // `tokens` alone carries the calibration: `bytes` and `lines` are exact counts a user
        // can reproduce, while a token number is an estimate whose arithmetic was disclosed nowhere
        // a reader of the finding would look.
        message: `File exceeds ${metric} ${breach.budget} budget: ${actual} ${METRIC_UNIT[metric]} > ${breach.limit}.${
          metric === "tokens" ? ` ${TOKEN_ESTIMATE_NOTE}` : ""
        }`,
        line: 0,
        data,
      });
    }
  },
});
