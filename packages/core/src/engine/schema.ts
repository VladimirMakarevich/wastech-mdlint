import { z } from "zod";

import { compileConfigSchema } from "../config/config-schema.js";
import {
  DEFAULT_EXCLUDE_GLOBS,
  DEFAULT_RESPECT_GITIGNORE,
} from "../config/corpus-scope.js";
import { ASSERTION_TARGETS, assertionSchema } from "./primitives/assert.js";
import { ruleRegistry } from "./rules/index.js";

// `schema.json` generation from the single metadata source. One function backs the
// `schema` command, the sync test, and the project-local schema `init` writes — its signature is
// frozen here.
//
// Output is a JSON Schema (2020-12, matching z.toJSONSchema's dialect). The meta-schema URL is the
// standard dialect identifier resolved offline by validators — it is NOT the remote *config* schema
// URL. A *config* `$schema` must stay a local relative path, so schema resolution never needs the
// network; only this dialect identifier is a URL, and validators resolve it offline.

const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
const SEVERITY_ENUM = ["error", "warning", "off"] as const;

// The custom-rule `target` vocabulary is the distinct set of `ASSERTION_TARGETS` values — the same
// authority `resolveCustomRule` validates a declared `target` against. Derived rather than
// spelled out so a new assert kind carrying a new target reaches this metadata-driven file on its
// own. Sorted for determinism, like the reserved-prefix list below.
const ASSERTION_TARGET_ENUM = [
  ...new Set<string>(Object.values(ASSERTION_TARGETS)),
].sort();

// A custom-rule descriptor for the project-local schema. Only what the schema needs to name a
// custom rule; widen it when the generated schema starts describing more than the id.
export type CustomRuleDefinition = { id: string; description?: string };

type JsonSchema = Record<string, unknown>;

// z.toJSONSchema tags each sub-schema with its own `$schema`; strip it so only the root carries the
// dialect declaration.
//
// `io: "input"` is load-bearing, not a preference. z.toJSONSchema defaults to `io: "output"`, where a
// key carrying a Zod `.default()` is emitted as **`required`** — the parsed result always has it, so
// the output shape demands it. This file describes the config a user *writes*, where such a key is by
// definition optional, so the first `.default()` added to any options schema would
// otherwise have made `schema.json` reject every config omitting it. Nothing in the product validates
// against this file, so an editor would have been the only thing to notice. The MCP SDK converts its
// own tool schemas with `io: "input"` for the same reason
// (`@modelcontextprotocol/sdk/.../zod-json-schema-compat.js`).
function optionsToJsonSchema(schema: z.ZodType): JsonSchema {
  const generated = z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
  delete generated.$schema;
  return generated;
}

function severityProperty(): JsonSchema {
  return { enum: [...SEVERITY_ENUM] };
}

function targetProperty(): JsonSchema {
  return { enum: [...ASSERTION_TARGET_ENUM] };
}

// One `rules[]` branch per built-in rule: the canonical id as a const plus its options schema.
function builtinRuleBranch(id: string, optionsSchema: z.ZodType): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      rule: { const: id },
      severity: severityProperty(),
      options: optionsToJsonSchema(optionsSchema),
    },
    required: ["rule"],
  };
}

function customOptionsSchema(): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      files: { type: "array", items: { type: "string" } },
      exclude: { type: "array", items: { type: "string" } },
      assert: optionsToJsonSchema(assertionSchema),
    },
    required: ["assert"],
  };
}

// Namespaced custom-id pattern: uppercase dash-separated segments, at least one dash,
// with a negative lookahead excluding built-in prefixes (and any project-local custom ids, which get
// their own dedicated branch) so the generic branch never overlaps a specific one under `oneOf`.
function customIdPattern(
  reservedPrefixes: string[],
  knownCustomIds: string[],
): string {
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
      target: targetProperty(),
      options: customOptionsSchema(),
    },
    required: ["rule", "id", "options"],
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
      target: targetProperty(),
      options: customOptionsSchema(),
    },
    required: ["rule", "id", "options"],
  };
}

/**
 * Generate the config JSON Schema as deterministic, pretty-printed text (the exact bytes of
 * schema.json). No `opts` ⇒ the package schema (built-in rules only); `opts.customRules` ⇒ a
 * project-local schema that also validates those custom rules' ids. Frozen API.
 */
export function generateConfigSchema(opts?: {
  customRules?: readonly CustomRuleDefinition[];
}): string {
  const metadata = ruleRegistry.getAllMetadata();
  const reservedPrefixes = [...ruleRegistry.getReservedPrefixes()].sort();
  const customRules = opts?.customRules ?? [];
  const knownCustomIds = customRules.map((rule) => rule.id).sort();

  const ruleBranches: JsonSchema[] = [
    ...metadata.map((rule) => builtinRuleBranch(rule.id, rule.optionsSchema)),
    ...knownCustomIds.map((id) => knownCustomBranch(id)),
    genericCustomBranch(customIdPattern(reservedPrefixes, knownCustomIds)),
  ];

  const schema: JsonSchema = {
    $schema: JSON_SCHEMA_DIALECT,
    title: "wastech-mdlint configuration",
    type: "object",
    additionalProperties: false,
    properties: {
      $schema: { type: "string" },
      include: { type: "array", items: { type: "string" } },
      // Both defaults are declared so an editor can show them: without this, nothing in the schema
      // hinted that a run excludes anything at all. A spread rather than the constant itself, so the
      // generated JSON never aliases the shared array. `include` deliberately gets no `default` —
      // declaring one would widen the generated file without telling a reader anything the
      // `**/*.md` convention does not.
      exclude: {
        type: "array",
        items: { type: "string" },
        default: [...DEFAULT_EXCLUDE_GLOBS],
        // The `default` alone says the opposite of what happens: in JSON Schema it reads as "the
        // value used when the key is absent", i.e. the *replace* semantics this product rejected. An
        // editor tooltip is the one surface a user reaches without the guide, and it is where they
        // decide whether writing their own `exclude` drops these entries.
        description:
          'Extra globs to exclude. Entries are APPENDED to the default shown here rather than replacing it, so deleting one of the defaults from your own list changes nothing — negate it instead ("!**/vendor/**", or "!**" for all of them).',
      },
      respectGitignore: {
        type: "boolean",
        default: DEFAULT_RESPECT_GITIGNORE,
      },
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
              defaultLocale: { type: "string" },
            },
          },
          idRef: {
            type: "object",
            additionalProperties: false,
            properties: {
              idPattern: { type: "string" },
              definitions: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
              },
              idColumn: { type: "string" },
            },
            required: ["idPattern", "definitions", "idColumn"],
          },
        },
      },
      rules: { type: "array", items: { oneOf: ruleBranches } },
      compile: optionsToJsonSchema(compileConfigSchema),
    },
  };

  return `${JSON.stringify(schema, null, 2)}\n`;
}
