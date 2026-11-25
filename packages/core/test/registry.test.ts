import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defineRule,
  findMixedRuleSpellings,
  mixedRuleSpellingMessage,
  RuleRegistry,
  RuleResolutionError,
} from "../src/engine/registry.js";

const refRule = defineRule({
  metadata: {
    id: "REF-001",
    alias: "no-broken-links",
    category: "REF",
    description: "relative links resolve",
    defaultSeverity: "error",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z.object({ exclude: z.array(z.string()).optional() }).strict(),
  check: () => () => {},
});

const sizeRule = defineRule({
  metadata: {
    id: "SIZE-001",
    alias: "file-size-budget",
    category: "SIZE",
    description: "file size budget",
    defaultSeverity: "warning",
    scope: "document",
    fixable: false,
  },
  optionsSchema: z.object({ maxBytes: z.number().int().positive() }).strict(),
  check: () => () => {},
});

const registry = new RuleRegistry([refRule, sizeRule]);

describe("RuleRegistry.resolveRule", () => {
  it("resolves all ID spellings to the canonical rule", () => {
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
      // Paths are prefixed with "options" so the loader renders rules[i].options.<path>.
      expect(resolution.issues?.[0]?.path).toEqual(["options", "maxBytes"]);
    }
  });

  it("rejects unknown option keys (strict schema)", () => {
    expect(() => registry.resolveRule("REF-001", { nope: true })).toThrow(
      RuleResolutionError,
    );
  });
});

describe("RuleRegistry metadata", () => {
  it("exposes reserved prefixes derived from built-in ids", () => {
    expect(registry.getReservedPrefixes()).toEqual(new Set(["REF", "SIZE"]));
  });

  it("returns metadata sorted by canonical id", () => {
    expect(registry.getAllMetadata().map((metadata) => metadata.id)).toEqual([
      "REF-001",
      "SIZE-001",
    ]);
  });

  it("rejects duplicate rule ids at construction", () => {
    expect(() => new RuleRegistry([refRule, refRule])).toThrow(
      /Duplicate rule id/,
    );
  });
});

// Builds a one-off definition with a chosen id and alias, for the constructor's collision guards.
function ruleWith(id: string, alias: string) {
  return defineRule({
    metadata: {
      id,
      alias,
      category: "REF",
      description: id,
      defaultSeverity: "error",
      scope: "document",
      fixable: false,
    },
    optionsSchema: z.object({}).strict(),
    check: () => () => {},
  });
}

describe("RuleRegistry aliases", () => {
  it("resolves an alias in any case to the canonical rule id", () => {
    for (const spelling of [
      "no-broken-links",
      "No-Broken-Links",
      "NO-BROKEN-LINKS",
    ]) {
      expect(registry.resolveRule(spelling, {}).id).toBe("REF-001");
      expect(registry.resolveId(spelling)).toBe("REF-001");
    }
  });

  it("answers has and getMetadata by alias", () => {
    expect(registry.has("file-size-budget")).toBe(true);
    expect(registry.getMetadata("file-size-budget")?.id).toBe("SIZE-001");
  });

  it("tells an alias apart from an id spelling", () => {
    expect(registry.isAlias("no-broken-links")).toBe(true);
    expect(registry.isAlias("REF-001")).toBe(false);
    expect(registry.isAlias("ref001")).toBe(false);
  });

  it("passes an unknown name through resolveId canonicalized", () => {
    expect(registry.resolveId("req-owner")).toBe("REQ-OWNER");
  });

  it("suggests the alias spelling for a near-miss alias", () => {
    try {
      registry.resolveRule("no-broken-link", {});
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as RuleResolutionError).suggestion).toBe("no-broken-links");
    }
  });

  it("rejects a duplicate alias at construction", () => {
    expect(
      () =>
        new RuleRegistry([
          ruleWith("REF-001", "same-alias"),
          ruleWith("REF-002", "same-alias"),
        ]),
    ).toThrow(/Duplicate rule alias/);
  });

  it("rejects an alias that is another rule's id at construction", () => {
    expect(
      () =>
        new RuleRegistry([
          ruleWith("REF-001", "ref-002"),
          ruleWith("REF-002", "some-alias"),
        ]),
    ).toThrow(/collides with a rule id/);
  });
});

describe("findMixedRuleSpellings", () => {
  it("reports an entry spelling a rule differently from the first entry naming it", () => {
    expect(
      findMixedRuleSpellings(
        [
          { rule: "REF-001" },
          { rule: "SIZE-001" },
          { rule: "no-broken-links" },
        ],
        registry,
      ),
    ).toEqual([
      {
        index: 2,
        firstIndex: 0,
        ruleId: "REF-001",
        spelling: "no-broken-links",
        firstSpelling: "REF-001",
      },
    ]);
  });

  it("allows one rule repeated under the same spelling kind", () => {
    expect(
      findMixedRuleSpellings(
        [
          { rule: "REF-001" },
          { rule: "ref001" },
          { rule: "file-size-budget" },
          { rule: "FILE-SIZE-BUDGET" },
        ],
        registry,
      ),
    ).toEqual([]);
  });

  it("skips custom, non-string and unknown entries", () => {
    expect(
      findMixedRuleSpellings(
        [
          { rule: "custom" },
          { rule: 42 },
          { rule: "no-such-rule" },
          { rule: "REF-001" },
        ],
        registry,
      ),
    ).toEqual([]);
  });

  it("names both spellings, the rule id and the sibling in its message", () => {
    expect(
      mixedRuleSpellingMessage({
        ruleId: "REF-001",
        spelling: "no-broken-links",
        firstSpelling: "REF-001",
        siblingPath: "config.rules[0]",
      }),
    ).toBe(
      'rule "no-broken-links" names "REF-001", which config.rules[0] names as "REF-001" - spell every entry for one rule the same way.',
    );
  });
});
