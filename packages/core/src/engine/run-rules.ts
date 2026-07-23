import { compareStrings } from "../deterministic-sort.js";
import type { LintMessage, ResolvedRule, RuleContext } from "./types.js";

// Context fields the caller supplies; `report` is added by the runner.
export type RunRulesContext = Omit<RuleContext, "report">;

function compareMessages(left: LintMessage, right: LintMessage): number {
  return (
    compareStrings(left.filePath, right.filePath) ||
    left.line - right.line ||
    (left.column ?? 0) - (right.column ?? 0) ||
    compareStrings(left.ruleId, right.ruleId) ||
    compareStrings(left.message, right.message)
  );
}

/**
 * Run a list of severity-resolved rules against a single built context, returning deterministic
 * findings (P2.01). The runner attaches `ruleId`/`severity`/`filePath` to each reported finding.
 *
 * Fail-fast (R4): a `project`-scope rule with no `documents` in context is a programming error — the
 * runner throws instead of silently producing nothing. `"off"` rules are expected to be filtered by
 * the orchestrator before reaching here.
 */
export function runRules(rules: readonly ResolvedRule[], context: RunRulesContext): LintMessage[] {
  const messages: LintMessage[] = [];

  for (const { rule, severityOverride } of rules) {
    if (rule.scope === "project" && context.documents === undefined) {
      throw new Error(
        `Rule ${rule.id} is project-scoped but no documents were provided (this is a programming error, not a config issue).`
      );
    }

    const report = (finding: Parameters<RuleContext["report"]>[0]): void => {
      messages.push({
        ruleId: rule.id,
        // Config override wins (C2), then the rule's per-finding hint, then its default.
        severity: severityOverride ?? finding.severity ?? rule.defaultSeverity,
        message: finding.message,
        filePath: finding.filePath ?? context.filePath ?? context.document?.path ?? "",
        line: finding.line,
        column: finding.column,
        endLine: finding.endLine,
        fixable: finding.fixable,
        data: finding.data,
        helpUri: finding.helpUri
      });
    };

    rule.check({ ...context, report });
  }

  messages.sort(compareMessages);

  return messages;
}
