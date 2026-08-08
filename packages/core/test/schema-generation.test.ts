import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_EXCLUDE_GLOBS } from "../src/config/corpus-scope.js";
import { DEFAULT_GRP002_ENTRY_POINTS } from "../src/engine/rules/grp.js";
import { ASSERTION_TARGETS } from "../src/engine/primitives/assert.js";
import { generateConfigSchema } from "../src/engine/schema.js";

// The shipped schema lives in the CLI package (its path is the config's default local `$schema`).
const shippedSchemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../cli/schema.json",
);

describe("generateConfigSchema", () => {
  it("is deterministic across calls", () => {
    expect(generateConfigSchema()).toBe(generateConfigSchema());
  });

  it("stays byte-in-sync with the shipped schema.json", () => {
    // If this fails, regenerate: `npm run build && npm run generate:docs`.
    const shipped = readFileSync(shippedSchemaPath, "utf8");
    expect(shipped).toBe(generateConfigSchema());
  });

  // The lint-time defaults have to be visible to an editor, or the only way
  // to learn that a run excludes anything is to notice a file missing from the report.
  it("declares the resolved defaults for exclude and respectGitignore", () => {
    const schema = JSON.parse(generateConfigSchema()) as {
      properties: {
        exclude: { default: string[] };
        respectGitignore: { default: boolean };
      };
    };

    expect(schema.properties.exclude.default).toEqual([
      ...DEFAULT_EXCLUDE_GLOBS,
    ]);
    expect(schema.properties.respectGitignore.default).toBe(false);
  });

  // `z.toJSONSchema`'s default `io: "output"` emits a `.default()` key as `required`, which
  // would make this schema reject every config that omits it. Nothing in the product validates against
  // schema.json, so only an editor would ever have said so — hence an explicit guard rather than
  // trusting the byte-sync test, which only proves the file matches whatever the generator produces.
  it.each([
    ["GRP-002", "entryPoints"],
    ["TBL-003", "caseSensitive"],
  ])("declares %s.%s as an optional key carrying its default", (id, key) => {
    const schema = JSON.parse(generateConfigSchema()) as {
      properties: {
        rules: {
          items: {
            oneOf: Array<{
              properties?: {
                rule?: { const?: string };
                options?: {
                  properties?: Record<string, { default?: unknown }>;
                  required?: string[];
                };
              };
            }>;
          };
        };
      };
    };
    const branch = schema.properties.rules.items.oneOf.find(
      (candidate) => candidate.properties?.rule?.const === id,
    );

    expect(branch?.properties?.options?.properties?.[key]?.default).toEqual(
      // Read from the constant rather than re-spelled: the list existed twice, and a test that
      // restates the value it guards cannot catch the value changing.
      id === "GRP-002" ? [...DEFAULT_GRP002_ENTRY_POINTS] : true,
    );
    expect(branch?.properties?.options?.required ?? []).not.toContain(key);
  });

  // The `it.each` above names two of the keys the trap can reach; this covers every one of them,
  // including `GRP-001.minCycleLength` and the `columnInSet.caseSensitive` that appears under both
  // the known-custom and generic-custom `assert` branches. Without it, a regression to
  // `io: "output"` on an unnamed path would surface only as a byte-sync diff — which a regeneration
  // absorbs without anyone reading it.
  it("never lists a defaulted property as required, anywhere in the schema", () => {
    const offenders: string[] = [];

    function walk(node: unknown, pointer: string): void {
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${pointer}/${index}`));
        return;
      }
      if (node === null || typeof node !== "object") {
        return;
      }
      const record = node as Record<string, unknown>;
      const properties = record.properties;
      const required = record.required;
      if (
        properties !== null &&
        typeof properties === "object" &&
        Array.isArray(required)
      ) {
        for (const [name, definition] of Object.entries(
          properties as Record<string, unknown>,
        )) {
          const hasDefault =
            definition !== null &&
            typeof definition === "object" &&
            "default" in (definition as Record<string, unknown>);
          if (hasDefault && required.includes(name)) {
            offenders.push(`${pointer}/properties/${name}`);
          }
        }
      }
      for (const [key, value] of Object.entries(record)) {
        walk(value, `${pointer}/${key}`);
      }
    }

    walk(JSON.parse(generateConfigSchema()), "#");
    expect(offenders).toEqual([]);
  });

  it("declares the JSON Schema dialect but no remote config-schema URL", () => {
    const schema = JSON.parse(generateConfigSchema()) as { $schema: string };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("includes the generic declarative custom-rule shape", () => {
    const schema = JSON.parse(generateConfigSchema()) as {
      properties: {
        rules: {
          items: {
            oneOf: Array<{ properties?: { rule?: { const?: string } } }>;
          };
        };
      };
    };
    const branches = schema.properties.rules.items.oneOf;
    const customBranch = branches.find(
      (branch) => branch.properties?.rule?.const === "custom",
    );
    expect(customBranch).toBeDefined();
  });

  // The two custom branches spelled this enum as a literal, so a new assert kind carrying a
  // new target needed two hand edits in an otherwise metadata-driven file. The byte-sync test cannot
  // see the difference — it only proves schema.json matches whatever the generator produces — so the
  // derivation needs its own guard.
  it("derives every custom branch's target enum from ASSERTION_TARGETS", () => {
    const schema = JSON.parse(
      generateConfigSchema({ customRules: [{ id: "REQ-OWNER" }] }),
    ) as {
      properties: {
        rules: {
          items: {
            oneOf: Array<{
              properties?: {
                rule?: { const?: string };
                target?: { enum?: string[] };
              };
            }>;
          };
        };
      };
    };
    const customBranches = schema.properties.rules.items.oneOf.filter(
      (branch) => branch.properties?.rule?.const === "custom",
    );
    const expected = [
      ...new Set<string>(Object.values(ASSERTION_TARGETS)),
    ].sort();

    // Both the generic branch and the known-custom-id branch, so neither can drift alone.
    expect(customBranches).toHaveLength(2);
    for (const branch of customBranches) {
      expect(branch.properties?.target?.enum).toEqual(expected);
    }
  });

  it("requires compile.skill and forbids unknown keys at the compile and compile.skill levels", () => {
    const schema = JSON.parse(generateConfigSchema()) as {
      properties: {
        compile: {
          required: string[];
          additionalProperties: boolean;
          properties: {
            skill: { required: string[]; additionalProperties: boolean };
          };
        };
      };
    };
    const compileSchema = schema.properties.compile;
    expect(compileSchema.required).toEqual(["skill"]);
    expect(compileSchema.additionalProperties).toBe(false);
    expect(compileSchema.properties.skill.required).toEqual([
      "name",
      "description",
    ]);
    expect(compileSchema.properties.skill.additionalProperties).toBe(false);
  });

  it("excludes reserved built-in prefixes and known custom ids from the generic custom id pattern", () => {
    const schema = JSON.parse(
      generateConfigSchema({ customRules: [{ id: "REQ-OWNER" }] }),
    ) as {
      properties: {
        rules: { items: { oneOf: Array<Record<string, unknown>> } };
      };
    };
    const branches = schema.properties.rules.items.oneOf;
    const genericCustom = branches.find(
      (branch) =>
        (
          branch.properties as {
            rule?: { const?: string };
            id?: { pattern?: string };
          }
        )?.rule?.const === "custom" &&
        (branch.properties as { id?: { pattern?: string } })?.id?.pattern !==
          undefined,
    ) as { properties: { id: { pattern: string } } } | undefined;

    expect(genericCustom).toBeDefined();
    const pattern = new RegExp(genericCustom!.properties.id.pattern);
    // Namespaced custom id passes; a known custom id and reserved-prefix ids are excluded.
    expect(pattern.test("TEAM-STYLE")).toBe(true);
    expect(pattern.test("REQ-OWNER")).toBe(false);
  });
});
