import { z } from "zod";

import { compareStrings } from "../deterministic-sort.js";
import { canonicalizeRuleId } from "../rule-id.js";
import { ruleDocsUrl } from "./rule-docs-url.js";
import type {
  Rule,
  RuleCategory,
  RuleContext,
  RuleScope,
  Severity,
  TextEdit,
} from "./types.js";

// The single metadata source per rule. One object drives the registry, `schema.json`
// generation, the README table, `describeRules`, and `init` categories -
// so those never drift from each other.
export type RuleMetadata = {
  id: string;
  // A human-readable second spelling of `id` (lowercase kebab-case with at least one dash, e.g.
  // `no-broken-anchors`), accepted wherever a rule id is read as input: config `rules[].rule` and
  // inline suppression tokens. It is input only - findings, written configs and every report keep
  // the canonical `id`, so output has one name per rule. The dash is what keeps an alias from ever
  // being read as a dash-less suppression category token.
  alias: string;
  category: RuleCategory;
  description: string;
  defaultSeverity: Severity;
  scope: RuleScope;
  fixable: boolean;
  // The rule's documentation page. Optional to *author* but always present on a defined rule:
  // `defineRule` fills it from the id by convention, and the runner copies it onto every finding as
  // `helpUri`. A rule may still override it if its page is ever not named after its id.
  docsUrl?: string;
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
    metadata: {
      ...def.metadata,
      // Derived here rather than repeated in every rule file: a rule that spelled its own URL could
      // disagree with the README table's link, and a rule that forgot one would emit a finding with
      // no `helpUri` at all - which is exactly what two rules once shipped.
      docsUrl: def.metadata.docsUrl ?? ruleDocsUrl(def.metadata.id),
      optionsSchema: def.optionsSchema,
    },
    createCheck: (options) => def.check(options as z.infer<TSchema>),
    createFix:
      fix === undefined
        ? undefined
        : (options) => fix(options as z.infer<TSchema>),
  };
}

export type RuleResolutionCode = "UNKNOWN_RULE" | "INVALID_OPTIONS";

// A validation issue decoupled from Zod's internal issue type (version-proof). Carries just what the
// config loader needs to build a path-prefixed diagnostic message.
export type ConfigIssue = { path: PropertyKey[]; message: string };

// Thrown by resolveRule; the config loader catches it and prefixes the message with the
// offending `rules[i]` path, so the diagnostic points at the entry the user wrote.
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

// Classic Levenshtein for "did you mean" suggestions. Small inputs (rule IDs), so the simple
// O(n·m) matrix is fine.
function editDistance(left: string, right: string): number {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const distances = Array.from({ length: rows }, () =>
    new Array<number>(cols).fill(0),
  );

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
        distances[row - 1]![col - 1]! + cost,
      );
    }
  }

  return distances[rows - 1]![cols - 1]!;
}

// The option keys a rule declares, read the way the config schema generator reads them (`schema.ts`,
// `z.toJSONSchema(schema, { io: "input" })`) so a diagnostic derived from this agrees with the
// `schema.json` an editor is validating against, rather than with a second reading of the Zod object.
function declaredOptionKeys(schema: z.ZodType): Set<string> {
  const generated = z.toJSONSchema(schema, { io: "input" }) as {
    properties?: Record<string, unknown>;
  };
  return new Set(Object.keys(generated.properties ?? {}));
}

/**
 * The sentence to add when a config sets `files` on a rule that has no such option.
 *
 * `Unrecognized key: "files"` is correct and arrives exactly when the user's model of the rule is
 * wrong, which is the moment it explains nothing. Most rules scope themselves with `files`/`exclude`,
 * so a rule without them is the exception, and the reader has no way to tell from the rejection
 * whether they mistyped a key or misunderstood the rule.
 *
 * The two mistakes are not equally forgiving, which is why the second sentence exists. `files` is a
 * hard error and therefore safe. On the two rules whose `exclude` filters the link or image *target*
 * being probed rather than the source document, spelling `exclude` and meaning "skip these files"
 * type-checks, runs, and silently filters something else - so a user who reaches for file scope here
 * has to be told what the key beside it actually does. That pair is derived from the schema rather
 * than listed: declaring `exclude` without `files` is what makes a rule one of them, and
 * `registry-inventory.test.ts` pins which rules that currently is.
 */
function fileScopeHint(
  canonical: string,
  optionKeys: Set<string>,
): string | undefined {
  if (optionKeys.has("files")) {
    return undefined;
  }

  const targetExclude = optionKeys.has("exclude")
    ? ` Its "exclude" filters the link and image targets this rule probes, not the source documents it runs on.`
    : "";

  return `Rule "${canonical}" takes no "files" option.${targetExclude} Use the top-level "include"/"exclude" to choose which files are linted.`;
}

export class RuleRegistry {
  private readonly byId = new Map<string, RuleDefinition>();
  // Keyed by the alias's canonical (upper-cased) form, which is exactly what the Markdown parser
  // already emits for a directive token, so suppression resolves a token with one lookup and no
  // second normalization. Alias resolution lives here rather than in `canonicalizeRuleId`: that
  // helper is a leaf the registry imports, and teaching it the registry would close an import cycle
  // through the rule modules.
  private readonly idByAlias = new Map<string, string>();

  constructor(definitions: readonly RuleDefinition[]) {
    for (const definition of definitions) {
      const canonical = canonicalizeRuleId(definition.metadata.id);
      if (this.byId.has(canonical)) {
        throw new Error(`Duplicate rule id in registry: ${canonical}`);
      }
      this.byId.set(canonical, definition);
    }

    // A second pass, so an alias is checked against every id regardless of definition order: an
    // alias that canonicalizes to an id, or one shared by two rules, would make one spelling mean two
    // rules depending on which map is consulted first.
    for (const definition of definitions) {
      const key = canonicalizeRuleId(definition.metadata.alias);
      if (this.byId.has(key)) {
        throw new Error(
          `Rule alias collides with a rule id in registry: ${key}`,
        );
      }
      if (this.idByAlias.has(key)) {
        throw new Error(`Duplicate rule alias in registry: ${key}`);
      }
      this.idByAlias.set(key, canonicalizeRuleId(definition.metadata.id));
    }
  }

  /**
   * The canonical id a rule spelling stands for: an alias (any case) maps to its rule's id; any other
   * spelling is normalized by `canonicalizeRuleId` and returned whether or not it is registered, so a
   * custom id or an unknown name passes through unchanged for the caller to judge.
   */
  resolveId(name: string): string {
    const canonical = canonicalizeRuleId(name);
    return this.idByAlias.get(canonical) ?? canonical;
  }

  isAlias(name: string): boolean {
    return this.idByAlias.has(canonicalizeRuleId(name));
  }

  has(name: string): boolean {
    return this.byId.has(this.resolveId(name));
  }

  getMetadata(name: string): RuleMetadata | undefined {
    return this.byId.get(this.resolveId(name))?.metadata;
  }

  // All built-in metadata, sorted by canonical id for deterministic schema/README generation.
  getAllMetadata(): RuleMetadata[] {
    return [...this.byId.values()]
      .map((definition) => definition.metadata)
      .sort((left, right) => compareStrings(left.id, right.id));
  }

  // Reserved built-in prefixes: the first segment of every built-in id. Derived from the
  // registry so custom-rule prefix validation never drifts as built-ins are added.
  getReservedPrefixes(): Set<string> {
    return new Set([...this.byId.keys()].map((id) => id.split("-")[0]!));
  }

  private suggest(canonical: string): string | undefined {
    let best: { key: string; spelling: string; distance: number } | undefined;

    // Aliases are candidates too, and are suggested in their authored lower-case spelling: someone
    // who mistyped `no-broken-anchor` meant the alias, and offering `REF-002` would not show them
    // what they got wrong.
    const candidates: { key: string; spelling: string }[] = [
      ...[...this.byId.keys()].map((id) => ({ key: id, spelling: id })),
      ...[...this.idByAlias.entries()].map(([key, id]) => ({
        key,
        spelling: this.byId.get(id)!.metadata.alias,
      })),
    ];

    for (const candidate of candidates) {
      const distance = editDistance(canonical, candidate.key);
      if (best === undefined || distance < best.distance) {
        best = { ...candidate, distance };
      }
    }

    // Only suggest when the typo is plausibly close (≤ ~40% of the id length).
    return best !== undefined &&
      best.distance <= Math.ceil(best.key.length * 0.4)
      ? best.spelling
      : undefined;
  }

  /**
   * Resolve a config rule entry to a runnable `Rule`. Accepts any ID spelling (canonical,
   * lower-case, dash-optional) or the rule's alias, validates options via the rule's Zod schema, and
   * throws a `RuleResolutionError` (unknown rule → did-you-mean; bad options → issue list) that the
   * config loader renders as a diagnostic. The returned `Rule.id` is always the canonical id.
   */
  resolveRule(name: string, rawOptions: unknown): Rule {
    const canonical = this.resolveId(name);
    const definition = this.byId.get(canonical);

    if (definition === undefined) {
      throw new RuleResolutionError({
        code: "UNKNOWN_RULE",
        ruleName: name,
        suggestion: this.suggest(canonical),
        message: `Unknown rule "${name}".`,
      });
    }

    const parsed = definition.metadata.optionsSchema.safeParse(
      rawOptions ?? {},
    );

    if (!parsed.success) {
      // Zod reports every rejected key of one object as a single issue, so the hint is attached to
      // that issue's message rather than carried separately: both hosts render an issue as one line
      // (the CLI prints the config error's message and drops the structured `hint` entirely), which
      // is the same place the unknown-rule "Did you mean …?" suffix lands.
      const hint = parsed.error.issues.some(
        (issue) =>
          issue.code === "unrecognized_keys" && issue.keys.includes("files"),
      )
        ? fileScopeHint(
            canonical,
            declaredOptionKeys(definition.metadata.optionsSchema),
          )
        : undefined;

      throw new RuleResolutionError({
        code: "INVALID_OPTIONS",
        ruleName: canonical,
        // Paths are prefixed with "options" so the loader renders `rules[i].options.<path>`
        // uniformly for built-in and custom entries.
        issues: parsed.error.issues.map((issue) => ({
          path: ["options", ...issue.path],
          message:
            hint !== undefined && issue.code === "unrecognized_keys"
              ? `${issue.message}. ${hint}`
              : issue.message,
        })),
        message: `Invalid options for rule "${canonical}".`,
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
      fix: definition.createFix?.(parsed.data),
    };
  }
}

// One entry that spells a built-in rule differently from the first entry naming that rule. Both
// positions and both spellings are carried, because the point of the diagnostic is to let a reader
// find the entry they did not know was there.
export type MixedRuleSpelling = {
  index: number;
  firstIndex: number;
  ruleId: string;
  spelling: string;
  firstSpelling: string;
};

/**
 * Find built-in rule entries that name one rule by its id in one place and by its alias in another.
 *
 * Repetition itself is supported - two `REF-001` entries with different `files` scopes apply one rule
 * differently to two parts of a repository - so this compares spelling *kinds*, not counts: two `REF-002`
 * entries, or two `no-broken-anchors` entries, stay valid. Mixing them is rejected because a reader
 * searching the config for one spelling misses the entry written in the other, so the rule looks
 * configured once while it runs twice.
 *
 * `custom` entries, non-string `rule` values and names the registry does not know are skipped: each
 * already has its own diagnostic, and a spelling report about an entry that fails anyway buries it.
 *
 * Returns one report per offending entry, in entry order, each naming the first entry for that rule.
 */
export function findMixedRuleSpellings(
  entries: readonly { rule?: unknown }[],
  registry: RuleRegistry,
): MixedRuleSpelling[] {
  const firstById = new Map<
    string,
    { index: number; spelling: string; isAlias: boolean }
  >();
  const mixed: MixedRuleSpelling[] = [];

  entries.forEach((entry, index) => {
    if (
      typeof entry.rule !== "string" ||
      entry.rule === "custom" ||
      !registry.has(entry.rule)
    ) {
      return;
    }
    const ruleId = registry.resolveId(entry.rule);
    const isAlias = registry.isAlias(entry.rule);
    const first = firstById.get(ruleId);
    if (first === undefined) {
      firstById.set(ruleId, { index, spelling: entry.rule, isAlias });
      return;
    }
    if (first.isAlias !== isAlias) {
      mixed.push({
        index,
        firstIndex: first.index,
        ruleId,
        spelling: entry.rule,
        firstSpelling: first.spelling,
      });
    }
  });

  return mixed;
}

/**
 * The message for a mixed id/alias spelling: both spellings, the canonical id they share, and the
 * earlier entry's position. `siblingPath` is rendered by the caller because the config loader anchors
 * paths at `config` while the MCP tool anchors them at the request's own `rules` array, and a
 * cross-reference the reader cannot paste back into what they are editing is worse than none.
 */
export function mixedRuleSpellingMessage(params: {
  ruleId: string;
  spelling: string;
  firstSpelling: string;
  siblingPath: string;
}): string {
  return `rule "${params.spelling}" names "${params.ruleId}", which ${params.siblingPath} names as "${params.firstSpelling}" - spell every entry for one rule the same way.`;
}
