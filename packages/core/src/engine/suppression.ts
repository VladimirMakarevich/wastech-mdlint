import { compareStrings } from "../deterministic-sort.js";
import type { InlineDirective } from "../markdown/document-types.js";
import { ruleRegistry } from "./rules/index.js";

// Inline-disable range logic, markdownlint-style. The parser only extracts directives; the engine
// computes whether a given (ruleId, line) is suppressed:
//
//   - `disable-next-line [rules]` on line L suppresses line L+1 only.
//   - `disable [rules]` on line L opens a disabled range from L; a later `enable [rules]` closes it,
//     otherwise it runs to EOF.
//   - `enable [rules]` on line L re-enables from L.
//   - `disable-file [rules]` disables for the whole file wherever it is written — it is the file's
//     base state, so one placed at the end still covers every line above it. A later `enable`
//     still re-enables from its own line: "wherever it is written" means its position does not
//     matter, not that it is irrevocable.
//   - `capture` saves the current state and `restore` returns to the most recently captured one,
//     so a block pasted into a file can change suppression without knowing what surrounds it.
//     Pairs nest; an unclosed `capture` is harmless and simply leaves the state as it is.
//   - An empty rule list applies to ALL rules; a specific `enable RULE` after a bare `disable`
//     re-enables just that rule.
//   - A token may be a rule's alias (`no-broken-anchors`) as well as its id. The parser cannot
//     resolve an alias because it does not know the registry, so `analyzeDirectives` does.
//   - A canonical token without a dash is a category: `REF` selects every `REF-*` rule. Tokens are
//     canonicalized by the parser first, so a dash-optional built-in id like `REF001` has already
//     become `REF-001`; what is still dash-less can never be a rule id, because built-in ids are
//     `PREFIX-DIGITS` and custom ids must contain a dash. Only the built-in families are
//     categories, so `REQ` never selects a custom `REQ-OWNER`.
//
// File-level findings (line 0) have no directive line before them, so only `disable-file` reaches
// them; every other directive starts at a real line. Otherwise use config `severity: "off"`.

export type SuppressionChecker = (ruleId: string, line: number) => boolean;

// A problem with a directive itself, reported rather than silently ignored: an unknown category or
// an unbalanced `restore` can leave a range disabled that the author meant enabled, which reads as
// a clean report while hiding findings.
export type DirectiveDiagnostic = {
  line: number;
  message: string;
  data: Record<string, unknown>;
};

export type DirectiveAnalysis = {
  isSuppressed: SuppressionChecker;
  diagnostics: DirectiveDiagnostic[];
};

// The `ruleId` directive diagnostics carry in lint output. Dash-less on purpose: custom ids must
// contain a dash and built-in ids are `PREFIX-DIGITS`, so it collides with no rule.
export const DIRECTIVE_DIAGNOSTIC_RULE_ID = "DIRECTIVE";

// One `disable`/`enable` step. Empty `selectors` means every rule.
type Effect = { disabled: boolean; selectors: readonly string[] };

// The effect stack in force from `line` on, until the next segment.
type Segment = { line: number; effects: readonly Effect[] };

// A selector naming a built-in category matches that family's ids. Any other dash-less selector
// matches nothing: otherwise `REQ` would quietly catch a custom `REQ-OWNER` while the run also says
// `REQ` is not a category, and the two answers would contradict each other. It is not dropped from
// the list either, since a directive left with no selectors would mean every rule.
//
// The known set is the built-in reserved prefixes, never the rules a config enables, so the same
// directive means the same thing in every run and through every entry point — including
// `createSuppressionChecker`, which has no config to consult.
function selectorMatches(
  selector: string,
  ruleId: string,
  knownCategories: ReadonlySet<string>,
): boolean {
  if (selector.includes("-")) {
    return selector === ruleId;
  }
  return knownCategories.has(selector) && ruleId.startsWith(`${selector}-`);
}

function directiveName(directive: InlineDirective): string {
  return `wastech-mdlint-${directive.kind}`;
}

// Directives in line order with their rule tokens resolved to canonical ids.
function resolveDirectiveTokens(
  directives: readonly InlineDirective[],
): InlineDirective[] {
  // `Array.prototype.sort` is stable, and directives arrive in source order, so two on one line
  // keep their written order.
  // Tokens are resolved through the registry here, once, because the parser canonicalizes them
  // without knowing the registry: an alias arrives upper-cased (`NO-BROKEN-ANCHORS`) and only the
  // registry can say it means `REF-002`. Every step below then compares canonical ids. A dash-less
  // token passes through unchanged, since no alias is dash-less, so category semantics hold.
  // `capture`/`restore` tokens are left as written: they are only ever echoed back in a diagnostic.
  return [...directives]
    .sort((left, right) => left.line - right.line)
    .map((directive) =>
      directive.kind === "capture" || directive.kind === "restore"
        ? directive
        : {
            ...directive,
            ruleIds: directive.ruleIds.map((token) =>
              ruleRegistry.resolveId(token),
            ),
          },
    );
}

// A diagnostic for every rule token a directive cannot use: any token on `capture`/`restore`, and a
// dash-less token that names no built-in category.
function tokenDiagnostics(
  ordered: readonly InlineDirective[],
  knownCategories: ReadonlySet<string>,
): DirectiveDiagnostic[] {
  const diagnostics: DirectiveDiagnostic[] = [];
  const categoryList = [...knownCategories].sort(compareStrings).join(", ");

  for (const directive of ordered) {
    if (directive.kind === "capture" || directive.kind === "restore") {
      if (directive.ruleIds.length > 0) {
        diagnostics.push({
          line: directive.line,
          message: `${directiveName(directive)} takes no rule IDs; ignored: ${directive.ruleIds.join(", ")}.`,
          data: { directive: directive.kind, tokens: [...directive.ruleIds] },
        });
      }
      continue;
    }
    for (const token of directive.ruleIds) {
      if (!token.includes("-") && !knownCategories.has(token)) {
        diagnostics.push({
          line: directive.line,
          message: `Unknown rule category "${token}" in ${directiveName(directive)}; known categories: ${categoryList}.`,
          data: { directive: directive.kind, token },
        });
      }
    }
  }
  return diagnostics;
}

// The effect stack in force from each directive that changes it on, starting from the
// `disable-file` base at line 0. An unmatched `restore` is reported into `diagnostics`.
function buildSegments(
  ordered: readonly InlineDirective[],
  base: readonly Effect[],
  diagnostics: DirectiveDiagnostic[],
): Segment[] {
  // The effect stack only ever grows between a `capture` and its `restore`, and captures pop LIFO,
  // so truncating back to the length recorded at `capture` returns *exactly* to the captured state
  // — nested pairs included, since an inner restore truncates to a length no shorter than any
  // outer capture's. That is why a length is enough and no state snapshot is copied. Each change
  // copies the array, so earlier segments keep the stack they were built with.
  let effects: readonly Effect[] = base;
  const captures: number[] = [];
  const segments: Segment[] = [{ line: 0, effects }];

  for (const directive of ordered) {
    switch (directive.kind) {
      case "disable":
      case "enable":
        effects = [
          ...effects,
          {
            disabled: directive.kind === "disable",
            selectors: directive.ruleIds,
          },
        ];
        segments.push({ line: directive.line, effects });
        break;
      case "capture":
        captures.push(effects.length);
        break;
      case "restore": {
        const length = captures.pop();
        if (length === undefined) {
          diagnostics.push({
            line: directive.line,
            message: `${directiveName(directive)} has no matching wastech-mdlint-capture; it was ignored.`,
            data: { directive: directive.kind },
          });
          break;
        }
        effects = effects.slice(0, length);
        segments.push({ line: directive.line, effects });
        break;
      }
      case "disable-file":
      case "disable-next-line":
        break;
    }
  }
  return segments;
}

/**
 * Analyze a document's directives once: the suppression checker its findings are filtered with,
 * plus a diagnostic for each directive that cannot mean what it says.
 *
 * Categories are matched and validated against the same built-in set, so a token reported as an
 * unknown category is also one that suppresses nothing.
 */
export function analyzeDirectives(
  directives: readonly InlineDirective[],
): DirectiveAnalysis {
  const ordered = resolveDirectiveTokens(directives);
  const knownCategories = ruleRegistry.getReservedPrefixes();
  const diagnostics = tokenDiagnostics(ordered, knownCategories);

  // `disable-file` effects form the bottom of the stack before any line is walked, which is what
  // makes their position irrelevant and puts them out of `restore`'s reach.
  const base: Effect[] = ordered
    .filter((directive) => directive.kind === "disable-file")
    .map((directive) => ({ disabled: true, selectors: directive.ruleIds }));

  const segments = buildSegments(ordered, base, diagnostics);

  const selects = (selectors: readonly string[], ruleId: string): boolean =>
    selectors.length === 0 ||
    selectors.some((selector) =>
      selectorMatches(selector, ruleId, knownCategories),
    );

  // The last effect naming the rule decides; none naming it means enabled.
  const isDisabled = (stack: readonly Effect[], ruleId: string): boolean => {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const effect = stack[index]!;
      if (selects(effect.selectors, ruleId)) {
        return effect.disabled;
      }
    }
    return false;
  };

  const nextLine = ordered.filter(
    (directive) => directive.kind === "disable-next-line",
  );

  const isSuppressed: SuppressionChecker = (ruleId, line) => {
    if (line <= 0) {
      return isDisabled(base, ruleId);
    }

    for (const directive of nextLine) {
      if (directive.line + 1 === line && selects(directive.ruleIds, ruleId)) {
        return true;
      }
    }

    // A directive on line L applies from L itself, so the last segment starting at or before the
    // queried line is the one in force.
    let current = segments[0]!;
    for (const segment of segments) {
      if (segment.line > line) {
        break;
      }
      current = segment;
    }
    return isDisabled(current.effects, ruleId);
  };

  return { isSuppressed, diagnostics };
}

/**
 * Build a per-document suppression checker from its extracted directives, discarding directive
 * diagnostics. Kept for callers that only need the filter.
 */
export function createSuppressionChecker(
  directives: readonly InlineDirective[],
): SuppressionChecker {
  return analyzeDirectives(directives).isSuppressed;
}
