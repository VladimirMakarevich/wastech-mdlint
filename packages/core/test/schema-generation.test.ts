import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_EXCLUDE_GLOBS } from "../src/config/corpus-scope.js";
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

  it("stays byte-in-sync with the shipped schema.json (R6)", () => {
    // If this fails, regenerate: `npm run build && npm run generate:docs`.
    const shipped = readFileSync(shippedSchemaPath, "utf8");
    expect(shipped).toBe(generateConfigSchema());
  });

  // P13.02, deliverable 3: the lint-time defaults have to be visible to an editor, or the only way
  // to learn that a run excludes anything is to notice a file missing from the report.
  it("declares the resolved defaults for exclude and respectGitignore (P13.02)", () => {
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

  // P13.04: `z.toJSONSchema`'s default `io: "output"` emits a `.default()` key as `required`, which
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
      id === "GRP-002"
        ? ["README.md", "CLAUDE.md", "AGENTS.md", "index.md"]
        : true,
    );
    expect(branch?.properties?.options?.required ?? []).not.toContain(key);
  });

  it("declares the JSON Schema dialect but no remote config-schema URL (C9)", () => {
    const schema = JSON.parse(generateConfigSchema()) as { $schema: string };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("includes the generic declarative custom-rule shape (R9)", () => {
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

  it("requires compile.skill and forbids unknown keys at the compile and compile.skill levels (P5.05)", () => {
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
