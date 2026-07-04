import type { z } from "zod";

import { canonicalizeRuleId } from "../rule-id.js";
import type { Rule, RuleCategory, RuleContext, RuleScope, Severity, TextEdit } from "./types.js";

// The single metadata source per rule (R6). One object drives the registry, `schema.json`
// generation (P2.06), the README table (P3.09), `describeRules` (P5), and `init` categories (P6) —
// so those never drift from each other.
export type RuleMetadata = {
  id: string;
  category: RuleCategory;
  description: string;
  defaultSeverity: Severity;
  scope: RuleScope;
  fixable: boolean;
  docsUrl?: string;
  // Named message templates (R6) — optional; documented alongside the rule.
  messages?: Record<string, string>;
  // Per-rule options schema; validated in resolveRule and reflected into schema.json.
  optionsSchema: z.ZodType;
};

// An untyped, registry-ready rule definition produced by `defineRule` (which captures the option
// type generically and erases it here so the registry can store heterogeneous rules).
export type RuleDefinition = {
  metadata: RuleMetadata;
  createCheck: (options: unknown) => (context: RuleContext) => void;
  createFix?: (options: unknown) => (context: RuleContext) => TextEdit[];
};

/**
 * Author a rule with a Zod-typed options schema. The check/fix factories receive the *parsed*
 * options, so rule bodies are fully typed; the returned definition is option-type-erased for the
 * registry.
 */
export function defineRule<TSchema extends z.ZodType>(def: {
  metadata: Omit<RuleMetadata, "optionsSchema">;
  optionsSchema: TSchema;
  check: (options: z.infer<TSchema>) => (context: RuleContext) => void;
  fix?: (options: z.infer<TSchema>) => (context: RuleContext) => TextEdit[];
}): RuleDefinition {
  const { fix } = def;

  return {
    metadata: { ...def.metadata, optionsSchema: def.optionsSchema },
    createCheck: (options) => def.check(options as z.infer<TSchema>),
    createFix: fix === undefined ? undefined : (options) => fix(options as z.infer<TSchema>)
  };
}

export type RuleResolutionCode = "UNKNOWN_RULE" | "INVALID_OPTIONS";

// A validation issue decoupled from Zod's internal issue type (version-proof). Carries just what the
// config loader needs to build a path-prefixed C7 message.
export type ConfigIssue = { path: PropertyKey[]; message: string };

// Thrown by resolveRule; the config loader (P2.04) catches it and prefixes the message with the
// offending `rules[i]` path for a precise C7 diagnostic.
export class RuleResolutionError extends Error {
  readonly code: RuleResolutionCode;
  readonly ruleName: string;
  readonly suggestion?: string;
  readonly issues?: ConfigIssue[];

  constructor(params: {
    code: RuleResolutionCode;
    ruleName: string;
    message: string;
    suggestion?: string;
    issues?: ConfigIssue[];
  }) {
    super(params.message);
    this.name = "RuleResolutionError";
    this.code = params.code;
    this.ruleName = params.ruleName;
    this.suggestion = params.suggestion;
    this.issues = params.issues;
  }
}

// Classic Levenshtein for "did you mean" suggestions (C7). Small inputs (rule IDs), so the simple
// O(n·m) matrix is fine.
function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const distances = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    distances[row]![0] = row;
  }
  for (let col = 0; col < cols; col += 1) {
    distances[0]![col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      distances[row]![col] = Math.min(
        distances[row - 1]![col]! + 1,
        distances[row]![col - 1]! + 1,
        distances[row - 1]![col - 1]! + cost
      );
    }
  }

  return distances[rows - 1]![cols - 1]!;
}

export class RuleRegistry {
  private readonly byId = new Map<string, RuleDefinition>();

  constructor(definitions: readonly RuleDefinition[]) {
    for (const definition of definitions) {
      const canonical = canonicalizeRuleId(definition.metadata.id);
      if (this.byId.has(canonical)) {
        throw new Error(`Duplicate rule id in registry: ${canonical}`);
      }
      this.byId.set(canonical, definition);
    }
  }

  has(name: string): boolean {
    return this.byId.has(canonicalizeRuleId(name));
  }

  getMetadata(name: string): RuleMetadata | undefined {
    return this.byId.get(canonicalizeRuleId(name))?.metadata;
  }

  // All built-in metadata, sorted by canonical id for deterministic schema/README generation.
  getAllMetadata(): RuleMetadata[] {
    return [...this.byId.values()]
      .map((definition) => definition.metadata)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  // Reserved built-in prefixes (audit 3.5): the first segment of every built-in id. Derived from the
  // registry so custom-rule prefix validation never drifts as built-ins are added.
  getReservedPrefixes(): Set<string> {
    return new Set([...this.byId.keys()].map((id) => id.split("-")[0]!));
  }

  private suggest(canonical: string): string | undefined {
    let best: { id: string; distance: number } | undefined;

    for (const id of this.byId.keys()) {
      const distance = editDistance(canonical, id);
      if (best === undefined || distance < best.distance) {
        best = { id, distance };
      }
    }

    // Only suggest when the typo is plausibly close (≤ ~40% of the id length).
    return best !== undefined && best.distance <= Math.ceil(best.id.length * 0.4)
      ? best.id
      : undefined;
  }

  /**
   * Resolve a config rule entry to a runnable `Rule` (P2.03). Accepts any ID spelling (canonical,
   * lower-case, dash-optional — C3), validates options via the rule's Zod schema, and throws a
   * `RuleResolutionError` (unknown rule → did-you-mean; bad options → issue list) for C7 diagnostics.
   */
  resolveRule(name: string, rawOptions: unknown): Rule {
    const canonical = canonicalizeRuleId(name);
    const definition = this.byId.get(canonical);

    if (definition === undefined) {
      throw new RuleResolutionError({
        code: "UNKNOWN_RULE",
        ruleName: name,
        suggestion: this.suggest(canonical),
        message: `Unknown rule "${name}".`
      });
    }

    const parsed = definition.metadata.optionsSchema.safeParse(rawOptions ?? {});

    if (!parsed.success) {
      throw new RuleResolutionError({
        code: "INVALID_OPTIONS",
        ruleName: canonical,
        // Paths are prefixed with "options" so the loader renders `rules[i].options.<path>`
        // uniformly for built-in and custom entries.
        issues: parsed.error.issues.map((issue) => ({
          path: ["options", ...issue.path],
          message: issue.message
        })),
        message: `Invalid options for rule "${canonical}".`
      });
    }

    return {
      id: definition.metadata.id,
      description: definition.metadata.description,
      category: definition.metadata.category,
      defaultSeverity: definition.metadata.defaultSeverity,
      scope: definition.metadata.scope,
      fixable: definition.metadata.fixable,
      docsUrl: definition.metadata.docsUrl,
      check: definition.createCheck(parsed.data),
      fix: definition.createFix?.(parsed.data)
    };
  }
}
