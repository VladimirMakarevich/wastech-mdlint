import { canonicalizeRuleId } from "../../rule-id.js";
import {
  ASSERTION_TARGETS,
  isProjectAssertion,
  runAssertion,
  type Assertion,
} from "../primitives/assert.js";
import { columnUnique } from "../primitives/table.js";
import { RuleResolutionError, type RuleRegistry } from "../registry.js";
import { CUSTOM_RULE_DOCS_URL } from "../rule-docs-url.js";
import { matchesFileScope } from "./scope.js";
import type { Rule } from "../types.js";

// Declarative custom rule. Composed purely from the closed primitive vocabulary
// — no code execution — so it is safe inside the MCP server. Its id is user-chosen and cannot
// shadow built-ins.

// Namespaced id grammar: uppercase dash-separated, at least one dash. Exported so
// config-writer.ts can mirror this exact authoritative grammar for a preserved-on-merge
// custom rule instead of keeping a second hand-copied regex that could silently drift from this one.
export const CUSTOM_ID_GRAMMAR = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/;

export type CustomRuleEntry = {
  rule: "custom";
  id: string;
  description?: string;
  severity?: "error" | "warning" | "off";
  target?: string;
  options: { files?: string[]; exclude?: string[]; assert: Assertion };
};

// One entry's position and the earlier entry it collides with. Indices rather than a boolean
// because a rule list is edited by index and both entries have to be named to be found: told only
// that "PROJ-DUP" is duplicated, a reader of a forty-entry config still has to search it.
export type CustomIdCollision = {
  index: number;
  firstIndex: number;
  id: string;
};

/**
 * Find `custom` entries that reuse an id an earlier `custom` entry already claimed.
 *
 * Uniqueness is not decorative. Two entries under one id both load and both run: their findings are
 * indistinguishable in every report, a `severity` set on one of them applies to findings the other
 * produced with no way to tell which, and a single inline `wastech-mdlint-disable PROJ-DUP` silences
 * both — including the one the author meant to keep. Duplication is the third way to end up with an
 * id that does not identify one rule, alongside a malformed id and one shadowing a built-in prefix,
 * and it was the only one that passed.
 *
 * Deliberately scoped to `custom` entries. Repeating a **built-in** rule is a supported
 * configuration — two `REF-001` entries with different `files` scopes is the way to apply one rule
 * differently to two parts of a repository — and those findings stay attributable because the rule
 * is the same rule.
 *
 * Ids are compared in canonical form, so `proj-dup` and `PROJ-DUP` collide: they resolve to one
 * rule id, which is the same comparison the reserved-prefix check performs against the registry.
 * Entries whose `id` is absent or not a string are skipped — shape is the schema's to reject, and
 * reporting a collision between two entries that are already invalid buries the real diagnostic.
 *
 * Returns one collision per offending entry, in entry order, each naming the first claimant.
 */
export function findDuplicateCustomIds(
  entries: readonly { rule?: unknown; id?: unknown }[],
): CustomIdCollision[] {
  const firstIndexById = new Map<string, number>();
  const collisions: CustomIdCollision[] = [];

  entries.forEach((entry, index) => {
    if (entry.rule !== "custom" || typeof entry.id !== "string") {
      return;
    }
    const id = canonicalizeRuleId(entry.id);
    const firstIndex = firstIndexById.get(id);
    if (firstIndex === undefined) {
      firstIndexById.set(id, index);
      return;
    }
    collisions.push({ index, firstIndex, id });
  });

  return collisions;
}

/**
 * The message for a duplicate id, in the register the other two id diagnostics use: the offending
 * id, the constraint stated positively, then a remedy with a concrete example.
 *
 * `siblingPath` is rendered by the caller because the two hosts root their paths differently — the
 * config loader anchors every diagnostic at `config`, the MCP tool at the request's own `rules`
 * array — and a cross-reference the reader cannot paste back into the thing they are editing is
 * worse than no cross-reference.
 */
export function duplicateCustomIdMessage(params: {
  id: string;
  siblingPath: string;
}): string {
  return `id "${params.id}": already used by ${params.siblingPath} — a custom rule id must identify exactly one rule, so give this entry its own (e.g. "${params.id}-2").`;
}

function invalid(
  path: (string | number)[],
  message: string,
): RuleResolutionError {
  return new RuleResolutionError({
    code: "INVALID_OPTIONS",
    ruleName: "custom",
    issues: [{ path, message }],
    message,
  });
}

/**
 * Resolve a `{ rule: "custom", ... }` config entry into a runnable Rule. Enforces the
 * namespaced id grammar and — authoritatively — that its prefix does not shadow a built-in
 * (reserved prefixes derived from the registry). Scope is derived from the assert kind
 * (columnUnique ⇒ project).
 */
export function resolveCustomRule(
  entry: CustomRuleEntry,
  registry: RuleRegistry,
): Rule {
  const id = canonicalizeRuleId(entry.id);

  if (!CUSTOM_ID_GRAMMAR.test(id)) {
    throw invalid(
      ["id"],
      `id "${entry.id}": custom rule ids must be uppercase, dash-separated with at least one dash (e.g. "REQ-OWNER").`,
    );
  }

  const prefix = id.split("-")[0]!;
  if (registry.getReservedPrefixes().has(prefix) || registry.has(id)) {
    throw invalid(
      ["id"],
      `id "${id}": "${prefix}" is a reserved built-in prefix — use your own namespace, e.g. "REQ-100".`,
    );
  }

  const assert = entry.options.assert;

  // Optional `target` must agree with the assert kind's target.
  const expectedTarget = ASSERTION_TARGETS[assert.kind];
  if (entry.target !== undefined && entry.target !== expectedTarget) {
    throw invalid(
      ["target"],
      `target "${entry.target}" does not match assert kind "${assert.kind}" (expected "${expectedTarget}").`,
    );
  }

  const scope = isProjectAssertion(assert.kind) ? "project" : "document";
  const fileScope = {
    files: entry.options.files,
    exclude: entry.options.exclude,
  };

  return {
    id,
    description: entry.description ?? id,
    category: "custom",
    // Custom rules assert invariants → default error; config `severity` overrides via the runner.
    defaultSeverity: "error",
    scope,
    fixable: false,
    // A custom id is user-chosen, so there is no page named after it; the mechanism's page is the
    // documentation a reader of one of its findings actually needs.
    docsUrl: CUSTOM_RULE_DOCS_URL,
    check: (context) => {
      if (scope === "project") {
        // columnUnique is the only project assert; it iterates the corpus and self-attributes.
        if (assert.kind !== "columnUnique") {
          return;
        }
        for (const finding of columnUnique(
          { documents: context.documents! },
          {
            column: assert.column,
            idPattern: assert.idPattern,
            section: assert.section,
          },
          (filePath) => matchesFileScope(filePath, fileScope),
        )) {
          context.report(finding);
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
        settings: context.settings,
      })) {
        context.report(finding);
      }
    },
  };
}
