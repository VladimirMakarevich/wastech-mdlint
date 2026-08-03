import { z } from "zod";

import { matchesConfigGlob } from "../../discovery/globs.js";
import { defineRule, type RuleDefinition } from "../registry.js";
import { estimateTokens } from "../tokens.js";

// SIZE-001 — per-file byte / line / token budget (D3, P3.07). Each metric is independently
// optional; omitting it disables that check. Metrics stay independent of each other, but the two
// severities within one metric no longer are: a metric emits at most one finding, from the highest
// crossed threshold ([P11.13]). Severity is per-finding (which threshold was crossed); the config
// `severity` override clamps via the runner (C2).

const METRICS = ["bytes", "lines", "tokens"] as const;
type Metric = (typeof METRICS)[number];

const thresholdSchema = z
  .object({
    warn: z.number().int().positive().optional(),
    error: z.number().int().positive().optional(),
  })
  .strict();

const overrideSchema = z
  .object({
    pattern: z.string().min(1),
    bytes: thresholdSchema.optional(),
    lines: thresholdSchema.optional(),
    tokens: thresholdSchema.optional(),
  })
  .strict();

const size001OptionsSchema = z
  .object({
    bytes: thresholdSchema.optional(),
    lines: thresholdSchema.optional(),
    tokens: thresholdSchema.optional(),
    overrides: z.array(overrideSchema).optional(),
  })
  .strict();

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
