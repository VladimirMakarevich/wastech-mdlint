import { describe, expect, it } from "vitest";

import type {
  CustomRuleConfigEntry,
  RuleConfigEntry,
} from "../src/config/config-schema.js";
import { describeRules } from "../src/compile/describe-rules.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

function descriptionOf(ruleId: string): string {
  const metadata = ruleRegistry.getMetadata(ruleId);

  if (metadata === undefined) {
    throw new Error(`Missing test metadata for "${ruleId}".`);
  }

  return metadata.description;
}

describe("describeRules", () => {
  it("groups active built-ins by the real metadata categories and keeps SIZE in the output", () => {
    const configuredRules: Array<RuleConfigEntry | CustomRuleConfigEntry> = [
      { rule: "LLM-001" },
      { rule: "ref001" },
      { rule: "SIZE-001", severity: "warning" },
      {
        rule: "custom",
        id: "REQ-OWNER",
        description: "Each requirement row must have an Owner",
        target: "table",
        options: { assert: { kind: "columnNotEmpty", column: "Owner" } },
      },
      { rule: "CTX-002" },
      { rule: "GRP-001" },
      { rule: "STR-001" },
      {
        rule: "TBL-003",
        options: { column: "Status", values: ["Draft", "Done"] },
      },
      { rule: "SEC-001" },
      { rule: "REF-002", severity: "off" },
      {
        rule: "custom",
        id: "REQ-SKIP",
        severity: "off",
        target: "checklist",
        options: { assert: { kind: "allChecked" } },
      },
    ];

    expect(describeRules(configuredRules, ruleRegistry)).toEqual([
      {
        category: "TBL",
        label: "Table Structure",
        rules: [
          {
            id: "TBL-003",
            description: descriptionOf("TBL-003"),
          },
        ],
      },
      {
        category: "SEC",
        label: "Sections",
        rules: [
          {
            id: "SEC-001",
            description: descriptionOf("SEC-001"),
          },
        ],
      },
      {
        category: "STR",
        label: "Project Structure",
        rules: [
          {
            id: "STR-001",
            description: descriptionOf("STR-001"),
          },
        ],
      },
      {
        category: "REF",
        label: "References",
        rules: [
          {
            id: "REF-001",
            description: descriptionOf("REF-001"),
          },
        ],
      },
      {
        category: "CTX",
        label: "Content/Context",
        rules: [
          {
            id: "CTX-002",
            description: descriptionOf("CTX-002"),
          },
        ],
      },
      {
        category: "GRP",
        label: "Graph Integrity",
        rules: [
          {
            id: "GRP-001",
            description: descriptionOf("GRP-001"),
          },
        ],
      },
      {
        category: "SIZE",
        label: "Size",
        rules: [
          {
            id: "SIZE-001",
            description: descriptionOf("SIZE-001"),
          },
        ],
      },
      {
        category: "LLM",
        label: "LLM",
        rules: [
          {
            id: "LLM-001",
            description: descriptionOf("LLM-001"),
          },
        ],
      },
      {
        category: "custom",
        label: "Custom",
        rules: [
          {
            id: "REQ-OWNER",
            description:
              'Each requirement row must have an Owner (table rule): requires non-empty cells in column "Owner".',
          },
        ],
      },
    ]);
  });

  it("describes custom document and project rules from their target plus assertion summary", () => {
    const configuredRules: CustomRuleConfigEntry[] = [
      {
        rule: "custom",
        id: "REQ-PLACEHOLDERS",
        options: {
          assert: {
            kind: "noPlaceholders",
            placeholders: ["TBD", "TODO"],
          },
        },
      },
      {
        rule: "custom",
        id: "REQ-UNIQUE",
        options: {
          assert: {
            kind: "columnUnique",
            column: "ID",
          },
        },
      },
      {
        rule: "custom",
        id: "REQ-OWNER",
        description: "Each requirement row must have an Owner",
        target: "table",
        options: {
          assert: {
            kind: "columnNotEmpty",
            column: "Owner",
          },
        },
      },
    ];

    expect(describeRules(configuredRules, ruleRegistry)).toEqual([
      {
        category: "custom",
        label: "Custom",
        rules: [
          {
            id: "REQ-OWNER",
            description:
              'Each requirement row must have an Owner (table rule): requires non-empty cells in column "Owner".',
          },
          {
            id: "REQ-PLACEHOLDERS",
            description:
              'Custom content rule: forbids placeholder content using markers "TBD" and "TODO".',
          },
          {
            id: "REQ-UNIQUE",
            description:
              'Custom table rule: requires unique values in column "ID" across files.',
          },
        ],
      },
    ]);
  });

  it("returns the same grouped output across repeated calls and scrambled input order", () => {
    const configuredRulesA: Array<RuleConfigEntry | CustomRuleConfigEntry> = [
      { rule: "SIZE-001" },
      {
        rule: "custom",
        id: "REQ-PLACEHOLDERS",
        options: { assert: { kind: "noPlaceholders" } },
      },
      { rule: "CTX-003" },
      { rule: "TBL-001" },
      { rule: "LLM-001" },
    ];
    const configuredRulesB: Array<RuleConfigEntry | CustomRuleConfigEntry> = [
      { rule: "TBL-001" },
      { rule: "LLM-001" },
      { rule: "CTX-003" },
      {
        rule: "custom",
        id: "REQ-PLACEHOLDERS",
        options: { assert: { kind: "noPlaceholders" } },
      },
      { rule: "SIZE-001" },
    ];

    expect(describeRules(configuredRulesA, ruleRegistry)).toEqual(
      describeRules(configuredRulesA, ruleRegistry),
    );
    expect(describeRules(configuredRulesA, ruleRegistry)).toEqual(
      describeRules(configuredRulesB, ruleRegistry),
    );
  });
});
