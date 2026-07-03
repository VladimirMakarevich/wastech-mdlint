import { canonicalizeRuleId } from "../../rule-id.js";
import {
  ASSERTION_TARGETS,
  isProjectAssertion,
  runAssertion,
  type Assertion
} from "../primitives/assert.js";
import { columnUnique } from "../primitives/table.js";
import { RuleResolutionError, type RuleRegistry } from "../registry.js";
import { matchesFileScope } from "./scope.js";
import type { Rule } from "../types.js";

// Declarative custom rule (P3.08 / R9 Tier 1). Composed purely from the closed primitive vocabulary
// — no code execution — so it is safe inside the MCP server (M8). Its id is user-chosen and cannot
// shadow built-ins.

// Namespaced id grammar (audit 3.5): uppercase dash-separated, at least one dash.
const CUSTOM_ID_GRAMMAR = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/;

export type CustomRuleEntry = {
  rule: "custom";
  id: string;
  description?: string;
  severity?: "error" | "warning" | "off";
  target?: string;
  options: { files?: string[]; exclude?: string[]; assert: Assertion };
};

function invalid(path: (string | number)[], message: string): RuleResolutionError {
  return new RuleResolutionError({
    code: "INVALID_OPTIONS",
    ruleName: "custom",
    issues: [{ path, message }],
    message
  });
}

/**
 * Resolve a `{ rule: "custom", ... }` config entry into a runnable Rule (P3.08). Enforces the
 * namespaced id grammar and — authoritatively — that its prefix does not shadow a built-in
 * (reserved prefixes derived from the registry, audit 3.5). Scope is derived from the assert kind
 * (columnUnique ⇒ project).
 */
export function resolveCustomRule(entry: CustomRuleEntry, registry: RuleRegistry): Rule {
  const id = canonicalizeRuleId(entry.id);

  if (!CUSTOM_ID_GRAMMAR.test(id)) {
    throw invalid(
      ["id"],
      `id "${entry.id}": custom rule ids must be uppercase, dash-separated with at least one dash (e.g. "REQ-OWNER").`
    );
  }

  const prefix = id.split("-")[0]!;
  if (registry.getReservedPrefixes().has(prefix) || registry.has(id)) {
    throw invalid(
      ["id"],
      `id "${id}": "${prefix}" is a reserved built-in prefix — use your own namespace, e.g. "REQ-100".`
    );
  }

  const assert = entry.options.assert;

  // Optional `target` must agree with the assert kind's target.
  const expectedTarget = ASSERTION_TARGETS[assert.kind];
  if (entry.target !== undefined && entry.target !== expectedTarget) {
    throw invalid(
      ["target"],
      `target "${entry.target}" does not match assert kind "${assert.kind}" (expected "${expectedTarget}").`
    );
  }

  const scope = isProjectAssertion(assert.kind) ? "project" : "document";
  const fileScope = { files: entry.options.files, exclude: entry.options.exclude };

  return {
    id,
    description: entry.description ?? id,
    category: "custom",
    // Custom rules assert invariants → default error; config `severity` overrides via the runner.
    defaultSeverity: "error",
    scope,
    fixable: false,
    check: (context) => {
      if (scope === "project") {
        // columnUnique is the only project assert; it iterates the corpus and self-attributes.
        if (assert.kind !== "columnUnique") {
          return;
        }
        for (const finding of columnUnique(
          { documents: context.documents! },
          { column: assert.column, idPattern: assert.idPattern, section: assert.section, files: fileScope.files },
          (filePath) => matchesFileScope(filePath, fileScope)
        )) {
          context.report({ ...finding, helpUri: id });
        }
        return;
      }

      if (!matchesFileScope(context.filePath!, fileScope)) {
        return;
      }
      for (const finding of runAssertion(assert, {
        document: context.document!,
        documents: context.documents!,
        rootDir: context.rootDir!,
        settings: context.settings
      })) {
        context.report({ ...finding, helpUri: id });
      }
    }
  };
}
