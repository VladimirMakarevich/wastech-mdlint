import type { InlineDirective } from "../markdown/document-types.js";

// Inline-disable range logic (P2.05 / audit 2.4, markdownlint-style). The parser only extracts
// directives (P1.04); the engine computes whether a given (ruleId, line) is suppressed:
//
//   - `disable-next-line [rules]` on line L suppresses line L+1 only.
//   - `disable [rules]` on line L opens a disabled range from L; a later `enable [rules]` closes it,
//     otherwise it runs to EOF.
//   - `enable [rules]` on line L re-enables from L.
//   - An empty `ruleIds` applies to ALL rules; a specific `enable RULE` after a bare `disable`
//     re-enables just that rule.
//
// File-level findings (line 0) are not inline-suppressible — no directive line precedes line 0; use
// config `severity: "off"` for those.

export type SuppressionChecker = (ruleId: string, line: number) => boolean;

function directiveApplies(directive: InlineDirective, ruleId: string): boolean {
  return directive.ruleIds.length === 0 || directive.ruleIds.includes(ruleId);
}

/**
 * Build a per-document suppression checker from its extracted directives. Directives are pre-sorted
 * by line once so each query is a cheap linear scan of the (typically few) block directives.
 */
export function createSuppressionChecker(directives: readonly InlineDirective[]): SuppressionChecker {
  const nextLine = directives.filter((directive) => directive.kind === "disable-next-line");
  const blocks = directives
    .filter((directive) => directive.kind === "disable" || directive.kind === "enable")
    .sort((left, right) => left.line - right.line);

  return (ruleId, line) => {
    if (line <= 0) {
      return false;
    }

    for (const directive of nextLine) {
      if (directive.line + 1 === line && directiveApplies(directive, ruleId)) {
        return true;
      }
    }

    // Replay block directives up to this line; the last applicable one decides the state.
    let disabled = false;
    for (const directive of blocks) {
      if (directive.line > line) {
        break;
      }
      if (directiveApplies(directive, ruleId)) {
        disabled = directive.kind === "disable";
      }
    }

    return disabled;
  };
}
