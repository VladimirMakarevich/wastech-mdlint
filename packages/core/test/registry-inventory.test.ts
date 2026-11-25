import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { compareStrings } from "../src/deterministic-sort.js";
import {
  CUSTOM_RULE_DOCS_URL,
  RULE_DOCS_BASE_URL,
  ruleDocsUrl,
  SUPPRESSION_DOCS_URL,
} from "../src/engine/rule-docs-url.js";
import { BUILTIN_RULE_DEFINITIONS } from "../src/engine/rules/index.js";
import type { RuleScope, Severity } from "../src/engine/types.js";

// The on-disk directory `RULE_DOCS_BASE_URL` names, so a `helpUri` can be resolved back to the file
// it promises. Same repo-root derivation `docs-sync.test.ts` uses.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const RULE_DOCS_DIR = path.join(REPO_ROOT, "docs/guide/rules");

// The other half of the same URL. `RULE_DOCS_BASE_URL` restates the repository the root manifest
// already names, and nothing but this reads them together.
const rootRepositoryUrl = (
  JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
    repository: { url: string };
  }
).repository.url;

// The documented shipped inventory (README rule table / glossary). Asserted here, against the
// *real* `BUILTIN_RULE_DEFINITIONS`, so a dropped/renamed/re-categorized rule fails this one test
// instead of relying on a rule's own (deletable) `*.test.ts` or the self-referential schema/README
// sync tests, which regenerate from the same registry and so stay green through a drop.
const EXPECTED: Record<string, { scope: RuleScope; severity: Severity }> = {
  "TBL-001": { scope: "document", severity: "error" },
  "TBL-002": { scope: "document", severity: "warning" },
  "TBL-003": { scope: "document", severity: "error" },
  "TBL-004": { scope: "document", severity: "error" },
  "TBL-005": { scope: "document", severity: "error" },
  "TBL-006": { scope: "project", severity: "error" },
  "TBL-007": { scope: "document", severity: "error" },
  "SEC-001": { scope: "document", severity: "error" },
  "SEC-002": { scope: "document", severity: "error" },
  "SEC-003": { scope: "project", severity: "error" },
  "SEC-004": { scope: "document", severity: "warning" },
  "SEC-005": { scope: "document", severity: "warning" },
  "SEC-006": { scope: "document", severity: "warning" },
  "STR-001": { scope: "project", severity: "error" },
  "REF-001": { scope: "document", severity: "error" },
  "REF-002": { scope: "document", severity: "error" },
  "REF-003": { scope: "document", severity: "error" },
  "REF-004": { scope: "document", severity: "error" },
  "REF-005": { scope: "project", severity: "error" },
  "REF-006": { scope: "project", severity: "warning" },
  "REF-007": { scope: "document", severity: "error" },
  "REF-008": { scope: "document", severity: "error" },
  "REF-009": { scope: "document", severity: "warning" },
  "CTX-001": { scope: "document", severity: "warning" },
  "CTX-002": { scope: "document", severity: "warning" },
  "CTX-003": { scope: "project", severity: "warning" },
  "CTX-004": { scope: "document", severity: "warning" },
  "CTX-005": { scope: "document", severity: "warning" },
  "CTX-006": { scope: "document", severity: "warning" },
  "GRP-001": { scope: "project", severity: "error" },
  "GRP-002": { scope: "project", severity: "warning" },
  "GRP-003": { scope: "project", severity: "warning" },
  "SIZE-001": { scope: "document", severity: "warning" },
  "LLM-001": { scope: "project", severity: "warning" },
  "FM-001": { scope: "document", severity: "error" },
};

const EXPECTED_CATEGORIES = [
  "CTX",
  "FM",
  "GRP",
  "LLM",
  "REF",
  "SEC",
  "SIZE",
  "STR",
  "TBL",
].sort(compareStrings);

describe("BUILTIN_RULE_DEFINITIONS inventory", () => {
  it("ships exactly the documented 35 rule ids", () => {
    const ids = BUILTIN_RULE_DEFINITIONS.map(
      (definition) => definition.metadata.id,
    ).sort(compareStrings);
    expect(ids).toEqual(Object.keys(EXPECTED).sort(compareStrings));
  });

  it("ships exactly the documented 9 category prefixes (no CHK)", () => {
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

// `docsUrl` is what makes a finding's `helpUri` a link instead of a restatement of
// `ruleId`, so "the URL resolves" is the property that has to hold - a page renamed or a rule added
// without one turns every one of its findings' `helpUri` into a 404 that nothing else would catch.
describe("rule documentation URLs", () => {
  it("derives every built-in's docsUrl from its id by convention", () => {
    for (const { metadata } of BUILTIN_RULE_DEFINITIONS) {
      expect(metadata.docsUrl).toBe(ruleDocsUrl(metadata.id));
    }
  });

  it("points every built-in's docsUrl at a guide page that exists on disk", () => {
    for (const { metadata } of BUILTIN_RULE_DEFINITIONS) {
      const relativePath = metadata.docsUrl!.slice(RULE_DOCS_BASE_URL.length);
      expect(existsSync(path.join(RULE_DOCS_DIR, relativePath))).toBe(true);
    }
  });

  // The mechanism page, not a page per user-chosen id - a custom rule's own id has none.
  it("points a custom rule at the custom-rules page, which exists", () => {
    expect(CUSTOM_RULE_DOCS_URL).toBe(ruleDocsUrl("custom"));
    expect(
      existsSync(
        path.join(
          RULE_DOCS_DIR,
          CUSTOM_RULE_DOCS_URL.slice(RULE_DOCS_BASE_URL.length),
        ),
      ),
    ).toBe(true);
  });

  // Directive diagnostics come from the engine, not a rule, so their `helpUri` is the directive
  // grammar page one level above the rule pages; a rename of that page would 404 every one of them.
  it("points directive diagnostics at the suppression page, which exists", () => {
    const guideBase = new URL("..", RULE_DOCS_BASE_URL).href;
    expect(SUPPRESSION_DOCS_URL).toBe(`${guideBase}suppression.md`);
    expect(
      existsSync(
        path.join(
          RULE_DOCS_DIR,
          "..",
          SUPPRESSION_DOCS_URL.slice(guideBase.length),
        ),
      ),
    ).toBe(true);
  });

  it("builds those URLs against the repository the root manifest declares", () => {
    // The assertions above strip `RULE_DOCS_BASE_URL` and check the filename half on disk, so the
    // owner/repo half of the constant was pinned by nothing - and it is a second spelling of the
    // root manifest's `repository.url`. A rename that updates the manifest and misses the constant
    // turns every finding's `helpUri` and all README table links into 404s with the suite green,
    // which no on-disk check can see because the path half stays correct.
    const origin = rootRepositoryUrl
      .replace(/^git\+/, "")
      .replace(/\.git$/, "");

    expect(RULE_DOCS_BASE_URL.startsWith(`${origin}/blob/`)).toBe(true);
  });

  // `messages` was dropped as a vacuous field (declared at one line, set by no rule, read
  // by no generator). Asserted at runtime rather than as a `satisfies` constraint because no tsconfig
  // includes `test/**`, so a type-level guard here would never be checked.
  it("declares exactly the metadata fields something reads (no vacuous `messages`)", () => {
    for (const { metadata } of BUILTIN_RULE_DEFINITIONS) {
      expect(Object.keys(metadata).sort(compareStrings)).toEqual([
        "alias",
        "category",
        "defaultSeverity",
        "description",
        "docsUrl",
        "fixable",
        "id",
        "optionsSchema",
        "scope",
      ]);
    }
  });
});

// The shipped alias set, pinned the way `EXPECTED` pins scope and severity: an alias is user input
// written into configs and suppression comments, so renaming one silently breaks every file that
// used it, and the schema/README sync tests regenerate from the same registry and cannot notice.
const EXPECTED_ALIASES: Record<string, string> = {
  "CTX-001": "no-empty-sections",
  "CTX-002": "checklist-complete",
  "CTX-003": "glossary-terms",
  "CTX-004": "descriptive-link-text",
  "CTX-005": "image-alt-text",
  "CTX-006": "code-block-language",
  "FM-001": "valid-front-matter",
  "GRP-001": "no-circular-references",
  "GRP-002": "no-orphan-documents",
  "GRP-003": "ids-carried-forward",
  "LLM-001": "context-token-budget",
  "REF-001": "no-broken-links",
  "REF-002": "no-broken-anchors",
  "REF-003": "no-broken-images",
  "REF-004": "declared-zone-dependencies",
  "REF-005": "traceable-ids",
  "REF-006": "stable-dependencies",
  "REF-007": "no-undefined-references",
  "REF-008": "no-malformed-links",
  "REF-009": "no-unused-definitions",
  "SEC-001": "required-sections",
  "SEC-002": "section-order",
  "SEC-003": "section-template",
  "SEC-004": "heading-increment",
  "SEC-005": "no-duplicate-headings",
  "SEC-006": "no-emphasis-as-heading",
  "SIZE-001": "file-size-budget",
  "STR-001": "required-files",
  "TBL-001": "table-required-columns",
  "TBL-002": "table-no-empty-cells",
  "TBL-003": "table-allowed-values",
  "TBL-004": "table-cell-pattern",
  "TBL-005": "table-conditional-columns",
  "TBL-006": "table-unique-ids",
  "TBL-007": "table-row-cell-count",
};

// Lowercase kebab-case with at least one dash. The dash is load-bearing, not style: a dash-less
// suppression token is read as a category (`REF`), so a dash-less alias would be ambiguous there.
const ALIAS_FORMAT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

describe("rule aliases", () => {
  it("pins the exact alias of every built-in rule", () => {
    expect(
      Object.fromEntries(
        BUILTIN_RULE_DEFINITIONS.map(({ metadata }) => [
          metadata.id,
          metadata.alias,
        ]),
      ),
    ).toEqual(EXPECTED_ALIASES);
  });

  it("gives every built-in a lowercase kebab-case alias with at least one dash", () => {
    for (const { metadata } of BUILTIN_RULE_DEFINITIONS) {
      expect(metadata.alias, metadata.id).toMatch(ALIAS_FORMAT);
    }
  });

  it("keeps aliases unique", () => {
    const aliases = BUILTIN_RULE_DEFINITIONS.map(
      ({ metadata }) => metadata.alias,
    );
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  // An alias equal to an id would make one spelling mean two rules, and one equal to a reserved
  // prefix would be read as a category in a suppression directive. Compared upper-cased because both
  // ids and directive tokens are canonicalized that way before anything matches them.
  it("never collides with a rule id or a reserved category prefix", () => {
    const ids = new Set(
      BUILTIN_RULE_DEFINITIONS.map(({ metadata }) => metadata.id),
    );
    const prefixes = new Set([...ids].map((id) => id.split("-")[0]!));
    for (const { metadata } of BUILTIN_RULE_DEFINITIONS) {
      const upper = metadata.alias.toUpperCase();
      expect(ids.has(upper), metadata.alias).toBe(false);
      expect(prefixes.has(upper), metadata.alias).toBe(false);
    }
  });

  // The rule pages are hand-written, so nothing regenerates them when an alias changes; this is the
  // drift guard that keeps each page's header naming the alias the registry actually accepts.
  it("names the alias in each rule page's header line", () => {
    for (const { metadata } of BUILTIN_RULE_DEFINITIONS) {
      const page = readFileSync(
        path.join(RULE_DOCS_DIR, `${metadata.id}.md`),
        "utf8",
      );
      const header = page.split("\n")[2] ?? "";
      expect(header, metadata.id).toContain(`Alias **\`${metadata.alias}\`**`);
    }
  });
});

// The rules that mix in `fileScopeShape` (`engine/rules/scope.ts`) - i.e. the ones whose `exclude`
// means "skip this source document". Each has a three-run `exclude` matrix in its family test file.
const FILE_SCOPED = [
  "TBL-001",
  "TBL-002",
  "TBL-003",
  "TBL-004",
  "TBL-005",
  "TBL-006",
  "TBL-007",
  "SEC-001",
  "SEC-002",
  "SEC-003",
  "SEC-004",
  "SEC-005",
  "SEC-006",
  "REF-002",
  "REF-007",
  "REF-008",
  "REF-009",
  "CTX-001",
  "CTX-002",
  "CTX-003",
  "CTX-004",
  "CTX-005",
  "CTX-006",
  "GRP-002",
  "FM-001",
].sort(compareStrings);

// Same key, different meaning: REF-001/REF-003 filter the *link/image target* they are about to
// probe, not the document being scanned (`primitives/reference.ts`). Pinned separately so the two
// meanings cannot be conflated by a future reader - or silently merged by a schema edit.
const LINK_TARGET_EXCLUDE = ["REF-001", "REF-003"].sort(compareStrings);

// @boundary-guard shared-exclude
//
// `exclude` shipped with zero end-to-end coverage, which is how the unscoped `columnUnique`
// ignoring it) survived. This inventory is the drift guard - a new rule that mixes in
// `fileScopeShape` fails here until its family test file gains an `exclude` case.
describe("file-scope option inventory", () => {
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

  // STR-001's `files` is the *required-file set* it checks for, not a scope filter - so it must
  // never grow an `exclude`. LLM-001 and the remaining GRP/REF rules are whole-corpus by
  // construction and take neither key.
  it("keeps STR-001's `files` a required-file set with no `exclude` beside it", () => {
    expect(
      idsWhere((keys) => keys.has("files") && !keys.has("exclude")),
    ).toEqual(["STR-001"]);
  });
});
