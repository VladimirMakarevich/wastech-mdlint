import { describe, expect, it } from "vitest";
import { z } from "zod";

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
        BUILTIN_RULE_DEFINITIONS.map(
          (definition) => definition.metadata.category,
        ),
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
    const actual: Record<string, { scope: RuleScope; severity: Severity }> = {};
    for (const definition of BUILTIN_RULE_DEFINITIONS) {
      actual[definition.metadata.id] = {
        scope: definition.metadata.scope,
        severity: definition.metadata.defaultSeverity,
      };
    }
    expect(actual).toEqual(EXPECTED);
  });
});

// The rules that mix in `fileScopeShape` (`engine/rules/scope.ts`) — i.e. the ones whose `exclude`
// means "skip this source document". Each has a three-run `exclude` matrix in its family test file.
const FILE_SCOPED = [
  "TBL-001",
  "TBL-002",
  "TBL-003",
  "TBL-004",
  "TBL-005",
  "TBL-006",
  "SEC-001",
  "SEC-002",
  "SEC-003",
  "REF-002",
  "CTX-001",
  "CTX-002",
  "CTX-003",
  "GRP-002",
].sort(compareStrings);

// Same key, different meaning: REF-001/REF-003 filter the *link/image target* they are about to
// probe, not the document being scanned (`primitives/reference.ts`). Pinned separately so the two
// meanings cannot be conflated by a future reader — or silently merged by a schema edit.
const LINK_TARGET_EXCLUDE = ["REF-001", "REF-003"].sort(compareStrings);

// Audit L-4: `exclude` shipped with zero end-to-end coverage, which is how M-2 (`columnUnique`
// ignoring it) survived. This inventory is the drift guard — a new rule that mixes in
// `fileScopeShape` fails here until its family test file gains an `exclude` case.
describe("file-scope option inventory (L-4)", () => {
  // Read the declared option keys the same way `generateConfigSchema` does (`engine/schema.ts`), so
  // this agrees with the shipped `schema.json` rather than with a second reading of the Zod objects.
  function optionKeys(schema: z.ZodType): Set<string> {
    const generated = z.toJSONSchema(schema) as {
      properties?: Record<string, unknown>;
    };
    return new Set(Object.keys(generated.properties ?? {}));
  }

  function idsWhere(predicate: (keys: Set<string>) => boolean): string[] {
    return BUILTIN_RULE_DEFINITIONS.filter((definition) =>
      predicate(optionKeys(definition.metadata.optionsSchema)),
    )
      .map((definition) => definition.metadata.id)
      .sort(compareStrings);
  }

  it("mixes the shared files+exclude shape into exactly the documented rules", () => {
    expect(
      idsWhere((keys) => keys.has("files") && keys.has("exclude")),
    ).toEqual(FILE_SCOPED);
  });

  it("declares a bare `exclude` only on the two link-target rules", () => {
    expect(
      idsWhere((keys) => keys.has("exclude") && !keys.has("files")),
    ).toEqual(LINK_TARGET_EXCLUDE);
  });

  // STR-001's `files` is the *required-file set* it checks for, not a scope filter — so it must
  // never grow an `exclude` (P11.12). LLM-001 and the remaining GRP/REF rules are whole-corpus by
  // construction and take neither key.
  it("keeps STR-001's `files` a required-file set with no `exclude` beside it", () => {
    expect(
      idsWhere((keys) => keys.has("files") && !keys.has("exclude")),
    ).toEqual(["STR-001"]);
  });
});
