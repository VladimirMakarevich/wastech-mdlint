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
  custom: { label: "Custom", order: 8 },
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

function summarizeAssertion(assertion: Assertion): string {
  switch (assertion.kind) {
    case "requiredColumns":
      return `requires columns ${formatList(assertion.columns)}${formatSection(assertion.section)}`;
    case "columnNotEmpty":
      return `requires non-empty cells in column ${quote(assertion.column)}${formatSection(assertion.section)}`;
    case "columnInSet":
      return `requires values in column ${quote(assertion.column)}${formatSection(assertion.section)} to be one of ${formatList(assertion.values)}${assertion.caseSensitive === true ? " (case-sensitive)" : ""}`;
    case "columnMatches":
      return `requires values in column ${quote(assertion.column)}${formatSection(assertion.section)} to match ${formatPattern(assertion.pattern, assertion.flags)}`;
    case "columnUnique":
      return `requires unique values in column ${quote(assertion.column)}${formatSection(assertion.section)} across files${assertion.idPattern === undefined ? "" : ` for values matching ${formatPattern(assertion.idPattern)}`}`;
    case "crossColumn":
      return `requires that when ${summarizeCondition(assertion.when)}, ${summarizeCondition(assertion.then)}${formatSection(assertion.section)}`;
    case "sectionPresent":
      return `requires sections ${formatList(assertion.sections)}`;
    case "sectionOrder":
      return `requires sections ${formatList(assertion.order)} to appear in order${assertion.level === undefined ? "" : ` at heading level ${assertion.level}`}${formatSection(assertion.section, "within")}`;
    case "contentNotMatch":
      return `forbids content matching ${formatPattern(assertion.pattern, assertion.flags)}`;
    case "noPlaceholders":
      return `forbids placeholder content${formatSection(assertion.section)}${assertion.placeholders === undefined ? "" : ` using markers ${formatList(assertion.placeholders)}`}`;
    case "allChecked":
      return `requires all checklist items to be checked${formatSection(assertion.section)}`;
    case "linkResolves":
      return `requires links to resolve${assertion.exclude === undefined ? "" : `, excluding configured patterns ${formatList(assertion.exclude)}`}`;
    case "imageResolves":
      return `requires images to resolve${assertion.exclude === undefined ? "" : `, excluding configured patterns ${formatList(assertion.exclude)}`}`;
    default: {
      const exhaustiveCheck: never = assertion;
      return exhaustiveCheck;
    }
  }
}

function describeCustomRule(entry: CustomRuleConfigEntry): string {
  const target =
    entry.target?.trim() || ASSERTION_TARGETS[entry.options.assert.kind];
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

      const metadata = metadataById.get(canonicalizeRuleId(entry.rule));

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
        left.id.localeCompare(right.id) ||
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
