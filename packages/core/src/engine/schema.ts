import { z } from "zod";

import { assertionSchema } from "./primitives/assert.js";
import { ruleRegistry } from "./rules/index.js";

// `schema.json` generation from the single metadata source (P2.06 / R6). One function backs the
// `schema` command, the sync test, and P6.04's project-local schema (audit 4.1) — its signature is
// frozen here.
//
// Output is a JSON Schema (2020-12, matching z.toJSONSchema's dialect). The meta-schema URL is the
// standard dialect identifier resolved offline by validators — it is NOT the remote *config* schema
// URL that C9 forbids (that link stays a local relative path in the config's own `$schema`).

const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
const SEVERITY_ENUM = ["error", "warning", "off"] as const;

// A custom-rule descriptor for the project-local schema (P6.04). Minimal now; extended as P6 needs.
export type CustomRuleDefinition = { id: string; description?: string };

type JsonSchema = Record<string, unknown>;

// z.toJSONSchema tags each sub-schema with its own `$schema`; strip it so only the root carries the
// dialect declaration.
function optionsToJsonSchema(schema: z.ZodType): JsonSchema {
  const generated = z.toJSONSchema(schema) as JsonSchema;
  delete generated.$schema;
  return generated;
}

function severityProperty(): JsonSchema {
  return { enum: [...SEVERITY_ENUM] };
}

// One `rules[]` branch per built-in rule: the canonical id as a const plus its options schema.
function builtinRuleBranch(id: string, optionsSchema: z.ZodType): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      rule: { const: id },
      severity: severityProperty(),
      options: optionsToJsonSchema(optionsSchema)
    },
    required: ["rule"]
  };
}

function customOptionsSchema(): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      files: { type: "array", items: { type: "string" } },
      exclude: { type: "array", items: { type: "string" } },
      assert: optionsToJsonSchema(assertionSchema)
    },
    required: ["assert"]
  };
}

// Namespaced custom-id pattern (audit 3.5): uppercase dash-separated segments, at least one dash,
// with a negative lookahead excluding built-in prefixes (and any project-local custom ids, which get
// their own dedicated branch) so the generic branch never overlaps a specific one under `oneOf`.
function customIdPattern(reservedPrefixes: string[], knownCustomIds: string[]): string {
  const lookaheads: string[] = [];
  if (reservedPrefixes.length > 0) {
    lookaheads.push(`(?!(${reservedPrefixes.join("|")})-)`);
  }
  if (knownCustomIds.length > 0) {
    lookaheads.push(`(?!(${knownCustomIds.join("|")})$)`);
  }
  return `^${lookaheads.join("")}[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$`;
}

function genericCustomBranch(idPattern: string): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      rule: { const: "custom" },
      id: { type: "string", pattern: idPattern },
      description: { type: "string" },
      severity: severityProperty(),
      target: { enum: ["checklist", "content", "link", "section", "table"] },
      options: customOptionsSchema()
    },
    required: ["rule", "id", "options"]
  };
}

function knownCustomBranch(id: string): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      rule: { const: "custom" },
      id: { const: id },
      description: { type: "string" },
      severity: severityProperty(),
      target: { enum: ["checklist", "content", "link", "section", "table"] },
      options: customOptionsSchema()
    },
    required: ["rule", "id", "options"]
  };
}

/**
 * Generate the config JSON Schema as deterministic, pretty-printed text (the exact bytes of
 * schema.json). No `opts` ⇒ the package schema (built-in rules only); `opts.customRules` ⇒ a
 * project-local schema that also validates those custom rules' ids (P6.04). Frozen API (audit 4.1).
 */
export function generateConfigSchema(opts?: { customRules?: readonly CustomRuleDefinition[] }): string {
  const metadata = ruleRegistry.getAllMetadata();
  const reservedPrefixes = [...ruleRegistry.getReservedPrefixes()].sort();
  const customRules = opts?.customRules ?? [];
  const knownCustomIds = customRules.map((rule) => rule.id).sort();

  const ruleBranches: JsonSchema[] = [
    ...metadata.map((rule) => builtinRuleBranch(rule.id, rule.optionsSchema)),
    ...knownCustomIds.map((id) => knownCustomBranch(id)),
    genericCustomBranch(customIdPattern(reservedPrefixes, knownCustomIds))
  ];

  const schema: JsonSchema = {
    $schema: JSON_SCHEMA_DIALECT,
    title: "wastech-mdlint configuration",
    type: "object",
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      include: { type: "array", items: { type: "string" } },
      exclude: { type: "array", items: { type: "string" } },
      respectGitignore: { type: "boolean" },
      settings: {
        type: "object",
        additionalProperties: false,
        properties: {
          siteRouter: {
            type: "object",
            additionalProperties: false,
            properties: {
              preset: { type: "string" },
              contentDir: { type: "string" },
              defaultLocale: { type: "string" }
            }
          }
        }
      },
      rules: { type: "array", items: { oneOf: ruleBranches } },
      // `compile` is validated by the compiler (P5); left permissive here.
      compile: { type: "object" }
    }
  };

  return `${JSON.stringify(schema, null, 2)}\n`;
}
