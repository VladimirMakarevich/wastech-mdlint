import { compareStrings } from "../deterministic-sort.js";
import type {
  CustomRuleConfigEntry,
  RuleConfigEntry,
} from "../config/config-schema.js";
import {
  ASSERTION_TARGETS,
  type Assertion,
} from "../engine/primitives/assert.js";
import type { RuleRegistry } from "../engine/registry.js";
import type { RuleCategory } from "../engine/types.js";
import { canonicalizeRuleId } from "../rule-id.js";

export type DescribedRule = {
  id: string;
  description: string;
};

export type RuleDescriptionGroup = {
  category: RuleCategory;
  label: string;
  rules: DescribedRule[];
};

type ConfiguredRuleEntry = RuleConfigEntry | CustomRuleConfigEntry;

const CATEGORY_DETAILS = {
  TBL: { label: "Table Structure", order: 0 },
  SEC: { label: "Sections", order: 1 },
  STR: { label: "Project Structure", order: 2 },
  REF: { label: "References", order: 3 },
  CTX: { label: "Content/Context", order: 4 },
  GRP: { label: "Graph Integrity", order: 5 },
  SIZE: { label: "Size", order: 6 },
  LLM: { label: "LLM", order: 7 },
  FM: { label: "Front Matter", order: 8 },
  custom: { label: "Custom", order: 9 },
} as const satisfies Record<RuleCategory, { label: string; order: number }>;

const CATEGORY_ORDER = (
  Object.entries(CATEGORY_DETAILS) as [
    RuleCategory,
    (typeof CATEGORY_DETAILS)[RuleCategory],
  ][]
)
  .sort((left, right) => left[1].order - right[1].order)
  .map(([category]) => category);

type IndexedRule = DescribedRule & {
  category: RuleCategory;
  index: number;
};

function isCustomRuleEntry(
  entry: ConfiguredRuleEntry,
): entry is CustomRuleConfigEntry {
  return entry.rule === "custom" && "id" in entry;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function formatList(values: readonly string[]): string {
  const quoted = values.map(quote);

  if (quoted.length === 1) {
    return quoted[0]!;
  }

  if (quoted.length === 2) {
    return `${quoted[0]} and ${quoted[1]}`;
  }

  return `${quoted.slice(0, -1).join(", ")}, and ${quoted.at(-1)}`;
}

function formatPattern(pattern: string, flags?: string): string {
  return `/${pattern}/${flags ?? ""}`;
}

function formatSection(section?: string, preposition = "in"): string {
  return section === undefined
    ? ""
    : ` ${preposition} section ${quote(section)}`;
}

function summarizeCondition(
  condition: Extract<Assertion, { kind: "crossColumn" }>["when"],
): string {
  const checks: string[] = [];

  if (condition.equals !== undefined) {
    checks.push(
      `column ${quote(condition.column)} equals ${quote(condition.equals)}`,
    );
  }

  if (condition.matches !== undefined) {
    checks.push(
      `column ${quote(condition.column)} matches ${formatPattern(condition.matches)}`,
    );
  }

  if (condition.notEmpty === true) {
    checks.push(`column ${quote(condition.column)} is not empty`);
  }

  return checks.join(" and ");
}

// One summarizer per assertion kind, typed as a mapped type over every kind so that adding a kind
// to `Assertion` without a sentence for it fails to compile instead of rendering nothing.
const ASSERTION_SUMMARIZERS: {
  [Kind in Assertion["kind"]]: (
    assertion: Extract<Assertion, { kind: Kind }>,
  ) => string;
} = {
  requiredColumns: (assertion) =>
    `requires columns ${formatList(assertion.columns)}${formatSection(assertion.section)}`,
  columnNotEmpty: (assertion) =>
    `requires non-empty cells in column ${quote(assertion.column)}${formatSection(assertion.section)}`,
  // Render from the *resolved* value: annotating only an explicit `true` made a
  // default-cased rule read identically to a case-insensitive one in the committed skill.
  // Tested against `=== false` rather than for a truthy value because `describeRules` is public
  // API and can be handed entries that never passed through Zod, where the key is absent — and
  // absent means the schema default, not a third state.
  columnInSet: (assertion) =>
    `requires values in column ${quote(assertion.column)}${formatSection(assertion.section)} to be one of ${formatList(assertion.values)}${assertion.caseSensitive === false ? " (case-insensitive)" : " (case-sensitive)"}`,
  columnMatches: (assertion) =>
    `requires values in column ${quote(assertion.column)}${formatSection(assertion.section)} to match ${formatPattern(assertion.pattern, assertion.flags)}`,
  columnUnique: (assertion) =>
    `requires unique values in column ${quote(assertion.column)}${formatSection(assertion.section)} across files${assertion.idPattern === undefined ? "" : ` for values matching ${formatPattern(assertion.idPattern)}`}`,
  crossColumn: (assertion) =>
    `requires that when ${summarizeCondition(assertion.when)}, ${summarizeCondition(assertion.then)}${formatSection(assertion.section)}`,
  sectionPresent: (assertion) =>
    `requires sections ${formatList(assertion.sections)}`,
  sectionOrder: (assertion) =>
    `requires sections ${formatList(assertion.order)} to appear in order${assertion.level === undefined ? "" : ` at heading level ${assertion.level}`}${formatSection(assertion.section, "within")}`,
  contentNotMatch: (assertion) =>
    `forbids content matching ${formatPattern(assertion.pattern, assertion.flags)}`,
  noPlaceholders: (assertion) =>
    `forbids placeholder content${formatSection(assertion.section)}${assertion.placeholders === undefined ? "" : ` using markers ${formatList(assertion.placeholders)}`}`,
  allChecked: (assertion) =>
    `requires all checklist items to be checked${formatSection(assertion.section)}`,
  linkResolves: (assertion) =>
    `requires links to resolve${assertion.exclude === undefined ? "" : `, excluding configured patterns ${formatList(assertion.exclude)}`}`,
  imageResolves: (assertion) =>
    `requires images to resolve${assertion.exclude === undefined ? "" : `, excluding configured patterns ${formatList(assertion.exclude)}`}`,
  frontmatterRequired: (assertion) =>
    `requires front matter keys ${formatList(assertion.keys)}`,
  frontmatterInSet: (assertion) =>
    `requires front matter key ${quote(assertion.key)} to be one of ${formatList(assertion.values)}`,
  frontmatterMatches: (assertion) =>
    `requires front matter key ${quote(assertion.key)} to match ${formatPattern(assertion.pattern, assertion.flags)}`,
};

function summarizeAssertion(assertion: Assertion): string {
  // `describeRules` is public API and can be handed an entry that never passed through Zod, whose
  // kind has no summarizer; the assertion is then returned as it came rather than throwing.
  const summarize = ASSERTION_SUMMARIZERS[assertion.kind] as
    | ((assertion: Assertion) => string)
    | undefined;
  return summarize === undefined
    ? (assertion as unknown as string)
    : summarize(assertion);
}

function describeCustomRule(entry: CustomRuleConfigEntry): string {
  // A target left blank names nothing, so it reads as the assertion's own default.
  const named = entry.target?.trim() ?? "";
  const target =
    named === "" ? ASSERTION_TARGETS[entry.options.assert.kind] : named;
  const description = entry.description?.trim();
  const summary = summarizeAssertion(entry.options.assert);

  // Custom rules have no registry metadata, so compile needs one deterministic sentence shape that
  // still preserves the author-provided description and target instead of leaking raw config JSON.
  if (description === undefined || description.length === 0) {
    return `Custom ${target} rule: ${summary}.`;
  }

  return `${description.replace(/[.!?]+$/u, "")} (${target} rule): ${summary}.`;
}

export function describeRules(
  configuredRules: readonly ConfiguredRuleEntry[],
  registry: RuleRegistry,
): RuleDescriptionGroup[] {
  // Read the built-in metadata once so compile, schema generation, and README docs stay anchored
  // to the exact same source instead of parallel lookups that can drift independently.
  const metadataById = new Map(
    registry
      .getAllMetadata()
      .map((metadata) => [canonicalizeRuleId(metadata.id), metadata]),
  );

  const described = configuredRules
    .flatMap<IndexedRule>((entry, index) => {
      if (entry.severity === "off") {
        return [];
      }

      if (isCustomRuleEntry(entry)) {
        return [
          {
            category: "custom",
            id: canonicalizeRuleId(entry.id),
            description: describeCustomRule(entry),
            index,
          },
        ];
      }

      // `resolveId` rather than `canonicalizeRuleId`: an entry written by its alias must find the
      // same metadata as one written by its id.
      const metadata = metadataById.get(registry.resolveId(entry.rule));

      if (metadata === undefined) {
        throw new Error(
          `Cannot describe configured rule "${entry.rule}": metadata is missing from the registry.`,
        );
      }

      return [
        {
          category: metadata.category,
          id: metadata.id,
          description: metadata.description,
          index,
        },
      ];
    })
    .sort(
      (left, right) =>
        CATEGORY_DETAILS[left.category].order -
          CATEGORY_DETAILS[right.category].order ||
        compareStrings(left.id, right.id) ||
        left.index - right.index,
    );

  const groups = new Map<RuleCategory, DescribedRule[]>();

  for (const rule of described) {
    const current = groups.get(rule.category);
    const description = { id: rule.id, description: rule.description };

    if (current === undefined) {
      groups.set(rule.category, [description]);
      continue;
    }

    current.push(description);
  }

  return CATEGORY_ORDER.flatMap((category) => {
    const rules = groups.get(category);

    if (rules === undefined) {
      return [];
    }

    return [{ category, label: CATEGORY_DETAILS[category].label, rules }];
  });
}
