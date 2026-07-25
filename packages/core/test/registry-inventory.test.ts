import { describe, expect, it } from "vitest";

import { compareStrings } from "../src/deterministic-sort.js";
import { BUILTIN_RULE_DEFINITIONS } from "../src/engine/rules/index.js";
import type { RuleScope, Severity } from "../src/engine/types.js";

// The documented shipped inventory (README rule table / glossary). Asserted here, against the
// *real* `BUILTIN_RULE_DEFINITIONS`, so a dropped/renamed/re-categorized rule fails this one test
// instead of relying on a rule's own (deletable) `*.test.ts` or the self-referential schema/README
// sync tests, which regenerate from the same registry and so stay green through a drop (audit L-12).
const EXPECTED: Record<string, { scope: RuleScope; severity: Severity }> = {
  "TBL-001": { scope: "document", severity: "error" },
  "TBL-002": { scope: "document", severity: "warning" },
  "TBL-003": { scope: "document", severity: "error" },
  "TBL-004": { scope: "document", severity: "error" },
  "TBL-005": { scope: "document", severity: "error" },
  "TBL-006": { scope: "project", severity: "error" },
  "SEC-001": { scope: "document", severity: "error" },
  "SEC-002": { scope: "document", severity: "error" },
  "SEC-003": { scope: "project", severity: "error" },
  "STR-001": { scope: "project", severity: "error" },
  "REF-001": { scope: "document", severity: "error" },
  "REF-002": { scope: "document", severity: "error" },
  "REF-003": { scope: "document", severity: "error" },
  "REF-004": { scope: "document", severity: "error" },
  "REF-005": { scope: "project", severity: "error" },
  "REF-006": { scope: "project", severity: "warning" },
  "CTX-001": { scope: "document", severity: "warning" },
  "CTX-002": { scope: "document", severity: "warning" },
  "CTX-003": { scope: "project", severity: "warning" },
  "GRP-001": { scope: "project", severity: "error" },
  "GRP-002": { scope: "project", severity: "warning" },
  "GRP-003": { scope: "project", severity: "warning" },
  "SIZE-001": { scope: "document", severity: "warning" },
  "LLM-001": { scope: "project", severity: "warning" },
};

const EXPECTED_CATEGORIES = [
  "CTX",
  "GRP",
  "LLM",
  "REF",
  "SEC",
  "SIZE",
  "STR",
  "TBL",
].sort(compareStrings);

describe("BUILTIN_RULE_DEFINITIONS inventory (L-12)", () => {
  it("ships exactly the documented 24 rule ids", () => {
    const ids = BUILTIN_RULE_DEFINITIONS.map(
      (definition) => definition.metadata.id,
    ).sort(compareStrings);
    expect(ids).toEqual(Object.keys(EXPECTED).sort(compareStrings));
  });

  it("ships exactly the documented 8 category prefixes (no CHK)", () => {
    const categories = [
      ...new Set(
        BUILTIN_RULE_DEFINITIONS.map((definition) => definition.metadata.category),
      ),
    ].sort(compareStrings);
    expect(categories).toEqual(EXPECTED_CATEGORIES);
  });

  it("declares a scope, default severity, and options schema for every rule", () => {
    for (const definition of BUILTIN_RULE_DEFINITIONS) {
      expect(definition.metadata.scope).toBeDefined();
      expect(definition.metadata.defaultSeverity).toBeDefined();
      expect(definition.metadata.optionsSchema).toBeDefined();
    }
  });

  it("matches the documented scope/severity per rule (catches silent metadata drift)", () => {
    const actual: Record<string, { scope: RuleScope; severity: Severity }> =
      {};
    for (const definition of BUILTIN_RULE_DEFINITIONS) {
      actual[definition.metadata.id] = {
        scope: definition.metadata.scope,
        severity: definition.metadata.defaultSeverity,
      };
    }
    expect(actual).toEqual(EXPECTED);
  });
});
