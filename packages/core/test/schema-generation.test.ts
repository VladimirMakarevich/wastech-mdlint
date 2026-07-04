import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { generateConfigSchema } from "../src/engine/schema.js";

// The shipped schema lives in the CLI package (its path is the config's default local `$schema`).
const shippedSchemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../cli/schema.json"
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

  it("declares the JSON Schema dialect but no remote config-schema URL (C9)", () => {
    const schema = JSON.parse(generateConfigSchema()) as { $schema: string };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("includes the generic declarative custom-rule shape (R9)", () => {
    const schema = JSON.parse(generateConfigSchema()) as {
      properties: { rules: { items: { oneOf: Array<{ properties?: { rule?: { const?: string } } }> } } };
    };
    const branches = schema.properties.rules.items.oneOf;
    const customBranch = branches.find((branch) => branch.properties?.rule?.const === "custom");
    expect(customBranch).toBeDefined();
  });

  it("excludes reserved built-in prefixes and known custom ids from the generic custom id pattern", () => {
    const schema = JSON.parse(
      generateConfigSchema({ customRules: [{ id: "REQ-OWNER" }] })
    ) as {
      properties: { rules: { items: { oneOf: Array<Record<string, unknown>> } } };
    };
    const branches = schema.properties.rules.items.oneOf;
    const genericCustom = branches.find(
      (branch) =>
        (branch.properties as { rule?: { const?: string }; id?: { pattern?: string } })?.rule
          ?.const === "custom" &&
        (branch.properties as { id?: { pattern?: string } })?.id?.pattern !== undefined
    ) as { properties: { id: { pattern: string } } } | undefined;

    expect(genericCustom).toBeDefined();
    const pattern = new RegExp(genericCustom!.properties.id.pattern);
    // Namespaced custom id passes; a known custom id and reserved-prefix ids are excluded.
    expect(pattern.test("TEAM-STYLE")).toBe(true);
    expect(pattern.test("REQ-OWNER")).toBe(false);
  });
});
