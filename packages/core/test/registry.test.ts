import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineRule, RuleRegistry, RuleResolutionError } from "../src/engine/registry.js";

const refRule = defineRule({
  metadata: {
    id: "REF-001",
    category: "REF",
    description: "relative links resolve",
    defaultSeverity: "error",
    scope: "document",
    fixable: false
  },
  optionsSchema: z.object({ exclude: z.array(z.string()).optional() }).strict(),
  check: () => () => {}
});

const sizeRule = defineRule({
  metadata: {
    id: "SIZE-001",
    category: "SIZE",
    description: "file size budget",
    defaultSeverity: "warning",
    scope: "document",
    fixable: false
  },
  optionsSchema: z.object({ maxBytes: z.number().int().positive() }).strict(),
  check: () => () => {}
});

const registry = new RuleRegistry([refRule, sizeRule]);

describe("RuleRegistry.resolveRule", () => {
  it("resolves all ID spellings to the canonical rule (C3)", () => {
    for (const spelling of ["REF-001", "ref-001", "ref001", "Ref-001"]) {
      expect(registry.resolveRule(spelling, {}).id).toBe("REF-001");
    }
  });

  it("throws UNKNOWN_RULE with a did-you-mean suggestion", () => {
    try {
      registry.resolveRule("REF-002", {});
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RuleResolutionError);
      const resolution = error as RuleResolutionError;
      expect(resolution.code).toBe("UNKNOWN_RULE");
      expect(resolution.suggestion).toBe("REF-001");
    }
  });

  it("throws INVALID_OPTIONS with a path-carrying issue list", () => {
    try {
      registry.resolveRule("SIZE-001", { maxBytes: -5 });
      expect.unreachable("should have thrown");
    } catch (error) {
      const resolution = error as RuleResolutionError;
      expect(resolution.code).toBe("INVALID_OPTIONS");
      expect(resolution.issues?.[0]?.path).toEqual(["maxBytes"]);
    }
  });

  it("rejects unknown option keys (strict schema, C7)", () => {
    expect(() => registry.resolveRule("REF-001", { nope: true })).toThrow(RuleResolutionError);
  });
});

describe("RuleRegistry metadata", () => {
  it("exposes reserved prefixes derived from built-in ids (audit 3.5)", () => {
    expect(registry.getReservedPrefixes()).toEqual(new Set(["REF", "SIZE"]));
  });

  it("returns metadata sorted by canonical id", () => {
    expect(registry.getAllMetadata().map((metadata) => metadata.id)).toEqual(["REF-001", "SIZE-001"]);
  });

  it("rejects duplicate rule ids at construction", () => {
    expect(() => new RuleRegistry([refRule, refRule])).toThrow(/Duplicate rule id/);
  });
});
