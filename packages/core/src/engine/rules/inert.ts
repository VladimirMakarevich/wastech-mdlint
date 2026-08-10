import type { RuleContext } from "../types.js";

/**
 * Report that a rule could not run because one of its options names something the analyzed corpus
 * does not contain — a glossary glob matching no document, a template that is not there, a column
 * header no table carries.
 *
 * This exists because the alternative is the worst outcome a linter has: a rule configured, inert,
 * and green. The option names a path or a column, either can drift while the config stays valid, and
 * nothing in a clean report distinguishes "the corpus satisfies this rule" from "this rule never
 * ran". A user sees green and ships.
 *
 * Three properties are the point, and each is deliberate:
 *
 * - **`severity: "error"`, whatever the rule's default is.** The CLI's default `--fail-on` is
 *   `error`, so a warning-severity diagnostic prints and still exits `0` — which is the silence
 *   being fixed, one line of output later. A rule entry's own `"severity"` still wins over this
 *   (final severity is `configOverride ?? finding.severity ?? rule.defaultSeverity`), so a user who
 *   has decided this rule is advisory keeps that; what they no longer get is nothing at all.
 * - **`filePath` is the raw config value**, not a normalized corpus path. The finding is attributed
 *   to what the user wrote, so the report names the string to go and fix. It is passed through
 *   unchanged for the same reason a value that fails to resolve is echoed rather than cleaned up:
 *   a normalized rendering of a path that does not work is harder to match against the config than
 *   the original.
 * - **A value outside the corpus is never inline-suppressible.** Message filtering reads disable
 *   directives from the document a finding names, and there is no document at this path — so
 *   `wastech-mdlint-disable <rule>` cannot put the silence back. That is a consequence of the
 *   attribution above rather than a separate mechanism, and it is the right one here.
 *
 * `line: 0` is the whole-file/no-location sentinel, rendered as `-` in the text report.
 *
 * Callers report once and `return`: a rule that could not load its inputs must not then also emit
 * per-document findings derived from those absent inputs.
 */
export function reportInertConfiguration(
  context: RuleContext,
  params: {
    message: string;
    configValue: string;
    data?: Record<string, unknown>;
  },
): void {
  context.report({
    message: params.message,
    line: 0,
    filePath: params.configValue,
    severity: "error",
    data: params.data,
  });
}
