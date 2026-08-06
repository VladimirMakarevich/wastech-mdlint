import { describe, expect, it } from "vitest";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import {
  buildCiWorkflowYaml,
  containsJsoncComments,
  generateInitConfig,
  identifyExistingRule,
  resolvePackageSchemaRef,
  type GenerateInitConfigParams,
} from "../src/discovery/config-writer.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { matchesConfigGlob } from "../src/discovery/globs.js";
import { generateConfigSchema } from "../src/engine/schema.js";
import { DEFAULT_NOISE_DIR_NAMES } from "../src/discovery/repo-scan-constants.js";
import type { InferredRule } from "../src/discovery/rule-inference.js";

// The fresh-write `exclude` mirrors the scanner's pruned noise directories as depth-agnostic globs
// (the scan prunes by basename at any depth), sorted by the same host-independent comparator as
// production — and nothing else since P14.03 resolved W-15: the scan's shape-based hidden-directory
// prune has no lint-time counterpart.
const EXPECTED_EXCLUDE = DEFAULT_NOISE_DIR_NAMES.map(
  (name) => `**/${name}/**`,
).sort(compareStrings);

function buildRule(
  overrides: Partial<InferredRule> & { rule: string },
): InferredRule {
  return {
    category: "REF",
    description: "A rule description.",
    defaultSeverity: "warning",
    fixable: false,
    rationale: `rationale for ${overrides.rule}`,
    ...overrides,
  };
}

function parse(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  expect(errors).toEqual([]);
  return parsed as Record<string, unknown>;
}

// The CLI computes this relative to the config's own directory; for a root config it is the documented
// C9 default. Tests pass it explicitly since generateInitConfig no longer hardcodes it.
const PACKAGE_SCHEMA_REF = "./node_modules/@wastech-mdlint/cli/schema.json";

const FRESH_PARAMS: GenerateInitConfigParams = {
  action: "fresh",
  include: ["docs/**/*.md"],
  newRules: [
    buildRule({ rule: "REF-001" }),
    buildRule({ rule: "TBL-002", category: "TBL" }),
  ],
  packageSchemaRef: PACKAGE_SCHEMA_REF,
};

describe("generateInitConfig · fresh", () => {
  it("writes canonical ids, the package $schema, and a non-empty include", () => {
    const result = generateInitConfig(FRESH_PARAMS);
    const config = parse(result.configText);

    expect(config.$schema).toBe(
      "./node_modules/@wastech-mdlint/cli/schema.json",
    );
    expect(result.schemaRef).toBe(
      "./node_modules/@wastech-mdlint/cli/schema.json",
    );
    expect(config.include).toEqual(["docs/**/*.md"]);
    // Deliverable 1 / C1: a fresh write carries the scanner's pruned noise dirs as `exclude`.
    expect(config.exclude).toEqual(EXPECTED_EXCLUDE);
    // Audit L-7: pinned explicitly rather than left at the loader's `false` default, so the written
    // config lints exactly the trees the scan proposed from.
    expect(config.respectGitignore).toBe(true);
    expect(config.rules).toEqual([{ rule: "REF-001" }, { rule: "TBL-002" }]);
    expect(result.addedRuleCount).toBe(2);
    expect(result.totalRuleCount).toBe(2);
    expect(result.wroteEmptyInclude).toBe(false);
    // C9: no remote URL anywhere, asserted on the raw bytes, not just by construction.
    expect(result.configText).not.toMatch(/https?:\/\//);
    expect(result.projectSchema).toBeUndefined();
  });

  it("omits include when the caller passes undefined but still writes the noise excludes", () => {
    const result = generateInitConfig({
      action: "fresh",
      include: undefined,
      newRules: [buildRule({ rule: "REF-001" })],
      packageSchemaRef: PACKAGE_SCHEMA_REF,
    });
    const config = parse(result.configText);
    // No `include` key means lintFiles falls back to `**/*.md`; `exclude` must still prune the noise
    // trees so init never broadens the scanned corpus back to node_modules/.git/dist/…
    expect("include" in config).toBe(false);
    expect(result.wroteEmptyInclude).toBe(false);
    expect(config.exclude).toEqual(EXPECTED_EXCLUDE);

    // Asserted semantically (what the globs *match*), not by literal presence: the anchoring is the
    // actual contract, and literals passed while nested noise was still being linted (audit M-4).
    const exclude = config.exclude as string[];
    for (const excluded of [
      // The two M-4 repros: noise nested under a monorepo package.
      "packages/foo/node_modules/somelib/README.md",
      "packages/foo/dist/OUT.md",
      // Root-level regression guard — this is what makes the leading `**/` matching zero segments a
      // contract rather than an assumption about picomatch.
      "node_modules/somelib/README.md",
      // `dot: true` still applies through the new prefix — and a hidden dependency/build tree must
      // prune through BOTH matcher entry points: the plain file test and `shouldPruneDirectory`'s
      // synthetic `__directory_probe__` child (which is what makes loadDocuments skip the directory
      // instead of walking it).
      ".git/config.md",
      ".venv/lib/site-packages/README.md",
      ".venv/__directory_probe__",
    ]) {
      expect(matchesConfigGlob(excluded, exclude)).toBe(true);
    }

    // No over-exclusion: a real cluster's docs stay in the corpus at the root and under a package,
    // and a dot in a *file* or directory name (rather than a leading dot) is not a hidden directory.
    // The three dot-directories below are W-15's answer (P14.03): a hidden directory that is not a
    // dependency or build tree is not excluded from the lint corpus, so `init`'s written `exclude`
    // does not silently drop `.claude/skills/` or `.agents/rules/` either.
    for (const kept of [
      "docs/guide.md",
      "packages/foo/docs/guide.md",
      "docs/a.b/c.md",
      "docs/release.notes.md",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/__directory_probe__",
      "packages/foo/.husky/NOTES.md",
    ]) {
      expect(matchesConfigGlob(kept, exclude)).toBe(false);
    }
  });

  it("explains above the exclude key that the list is a default a user entry extends", () => {
    // The block is a verbatim copy of the lint-time default, so the natural edit — delete the line
    // you disagree with — is a no-op (P13.02 decided *extend*). P14.03 keeps the list and makes the
    // duplication explicit rather than omitting it, so the comment is the deliverable, not a nicety.
    const { configText } = generateInitConfig(FRESH_PARAMS);
    const excludeIndex = configText.indexOf('"exclude"');
    expect(excludeIndex).toBeGreaterThan(-1);
    const preamble = configText.slice(0, excludeIndex);

    expect(preamble).toContain("EXTEND it rather than replace it");
    expect(preamble).toContain("deleting a line here changes nothing");
    expect(preamble).toContain('negate it: "!**/vendor/**"');
    // Every comment line has to sit above the key, not between the key and its value.
    for (const line of preamble.split("\n").slice(-4, -1)) {
      expect(line.trimStart().startsWith("//")).toBe(true);
    }
  });

  it('writes a literal "include": [] when the caller passes an empty array', () => {
    // Audit L-9: an empty selection is an explicit "lint nothing", and omitting the key would invert
    // it into `lintFiles`'s `**/*.md` default — the exact opposite of what the user asked for.
    const result = generateInitConfig({
      action: "fresh",
      include: [],
      newRules: [buildRule({ rule: "REF-001" })],
      packageSchemaRef: PACKAGE_SCHEMA_REF,
    });
    const config = parse(result.configText);

    expect("include" in config).toBe(true);
    expect(config.include).toEqual([]);
    expect(result.wroteEmptyInclude).toBe(true);
  });

  it("falls back to a project-local schema when no package schema ref is available", () => {
    // Audit L-10: under `npx` there is no local install for a relative path to reach, so pointing at
    // `./node_modules/@wastech-mdlint/cli/schema.json` dangles. Generate the schema instead.
    const result = generateInitConfig({
      action: "fresh",
      include: ["docs/**/*.md"],
      newRules: [buildRule({ rule: "REF-001" })],
      packageSchemaRef: undefined,
    });

    expect(result.schemaRef).toBe("./schema.json");
    expect(parse(result.configText).$schema).toBe("./schema.json");
    expect(result.projectSchema?.fileName).toBe("schema.json");
    expect(result.projectSchema?.reason).toBe("no-installed-package");
    // With no custom rules the fallback schema is exactly the built-in one — no custom-id branches
    // invented for a config that has none.
    expect(result.projectSchema?.text).toBe(generateConfigSchema());
  });

  it("appends each new rule's rationale as a trailing // comment while staying valid JSONC", () => {
    const result = generateInitConfig(FRESH_PARAMS);
    // The literal comment text must be present in the bytes...
    expect(result.configText).toContain("// rationale for REF-001");
    expect(result.configText).toContain("// rationale for TBL-002");
    // ...and the file must still parse as JSONC (comments tolerated) to the same data.
    expect(parse(result.configText).rules).toEqual([
      { rule: "REF-001" },
      { rule: "TBL-002" },
    ]);
  });

  it("is deterministic across repeated calls", () => {
    expect(generateInitConfig(FRESH_PARAMS).configText).toBe(
      generateInitConfig(FRESH_PARAMS).configText,
    );
  });

  it("wires exactly the package schema ref it is given (e.g. a subdirectory-relative `../` path)", () => {
    const result = generateInitConfig({
      action: "fresh",
      include: undefined,
      newRules: [buildRule({ rule: "REF-001" })],
      packageSchemaRef: "../node_modules/@wastech-mdlint/cli/schema.json",
    });
    // The writer does not hardcode a root-relative literal — it serializes the CLI-computed ref, so a
    // config written into a subdirectory can point up at the hoisted node_modules.
    expect(parse(result.configText).$schema).toBe(
      "../node_modules/@wastech-mdlint/cli/schema.json",
    );
    expect(result.schemaRef).toBe(
      "../node_modules/@wastech-mdlint/cli/schema.json",
    );
  });
});

describe("generateInitConfig · merge", () => {
  it("preserves include/exclude/settings/compile and unknown keys verbatim, appending only new rules", () => {
    const existing = {
      raw: {
        include: ["src/**/*.md"],
        exclude: ["dist/**"],
        settings: { siteRouter: { preset: "starlight" } },
        compile: { skill: { name: "x", description: "y" } },
        futureKey: { anything: true },
        rules: [{ rule: "REF-001", severity: "warning" }],
      },
    };
    const result = generateInitConfig({
      action: "merge",
      existing,
      include: ["ignored/**/*.md"],
      newRules: [buildRule({ rule: "TBL-002", category: "TBL" })],
      packageSchemaRef: PACKAGE_SCHEMA_REF,
    });
    const config = parse(result.configText);

    expect(config.include).toEqual(["src/**/*.md"]);
    expect(config.exclude).toEqual(["dist/**"]);
    expect(config.settings).toEqual({ siteRouter: { preset: "starlight" } });
    expect(config.compile).toEqual({ skill: { name: "x", description: "y" } });
    expect(config.futureKey).toEqual({ anything: true });
    // Existing entry kept verbatim (severity preserved), new entry appended.
    expect(config.rules).toEqual([
      { rule: "REF-001", severity: "warning" },
      { rule: "TBL-002" },
    ]);
    expect(result.addedRuleCount).toBe(1);
    expect(result.totalRuleCount).toBe(2);
    expect(result.projectSchema).toBeUndefined();
    // A merge round-trips existing keys only: it must not inject the fresh-write defaults
    // (`respectGitignore`, the noise `exclude`) into a config that never opted into them.
    expect("respectGitignore" in config).toBe(false);
    expect(result.wroteEmptyInclude).toBe(false);
  });

  it("preserves an existing custom rule and generates a matching project-local schema", () => {
    const customEntry = {
      rule: "custom",
      id: "REQ-100",
      description: "Requires an owner.",
      options: { assert: { kind: "sectionPresent", sections: ["Owner"] } },
    };
    const existing = { raw: { rules: [customEntry] } };
    const result = generateInitConfig({
      action: "merge",
      existing,
      include: [],
      newRules: [buildRule({ rule: "REF-001" })],
      packageSchemaRef: PACKAGE_SCHEMA_REF,
    });
    const config = parse(result.configText);

    expect((config.rules as unknown[])[0]).toEqual(customEntry);
    expect(result.schemaRef).toBe("./schema.json");
    expect(config.$schema).toBe("./schema.json");
    expect(result.projectSchema?.fileName).toBe("schema.json");
    expect(result.projectSchema?.text).toBe(
      generateConfigSchema({
        customRules: [{ id: "REQ-100", description: "Requires an owner." }],
      }),
    );
  });

  it("canonicalizes noncanonical existing ids on write (C3), keeping severity/options intact", () => {
    const existing = {
      raw: {
        rules: [
          {
            rule: "ref001",
            severity: "warning",
            options: { exclude: ["legacy/**"] },
          },
          {
            rule: "custom",
            id: "req-owner",
            options: {
              assert: { kind: "sectionPresent", sections: ["Owner"] },
            },
          },
        ],
      },
    };
    const result = generateInitConfig({
      action: "merge",
      existing,
      include: [],
      newRules: [buildRule({ rule: "TBL-002", category: "TBL" })],
      packageSchemaRef: PACKAGE_SCHEMA_REF,
    });
    const config = parse(result.configText);
    const rules = config.rules as Record<string, unknown>[];

    // Ids canonicalized (ref001 → REF-001, req-owner → REQ-OWNER) but severity/options preserved.
    expect(rules[0]).toEqual({
      rule: "REF-001",
      severity: "warning",
      options: { exclude: ["legacy/**"] },
    });
    expect(rules[1]).toEqual({
      rule: "custom",
      id: "REQ-OWNER",
      options: { assert: { kind: "sectionPresent", sections: ["Owner"] } },
    });
    // The custom id in the config agrees with the id the generated project schema is built from.
    expect(config.$schema).toBe("./schema.json");
    expect(result.projectSchema?.text).toBe(
      generateConfigSchema({ customRules: [{ id: "REQ-OWNER" }] }),
    );
  });

  it("does not seed a project schema from a custom id the loader would reject", () => {
    // `foo` has no dash and `REF-OWNER` reuses a reserved built-in prefix — both fail
    // resolveCustomRule's grammar/prefix checks, so a project schema claiming they are valid would
    // disagree with loadConfiguration.
    for (const invalidId of ["foo", "ref-owner"]) {
      const existing = {
        raw: {
          rules: [
            {
              rule: "custom",
              id: invalidId,
              options: { assert: { kind: "sectionPresent", sections: ["X"] } },
            },
          ],
        },
      };
      const result = generateInitConfig({
        action: "merge",
        existing,
        include: [],
        newRules: [buildRule({ rule: "REF-001" })],
        packageSchemaRef: PACKAGE_SCHEMA_REF,
      });

      expect(result.projectSchema).toBeUndefined();
      expect(result.schemaRef).toBe(
        "./node_modules/@wastech-mdlint/cli/schema.json",
      );
      // The user's own entry is still preserved verbatim (canonicalized) — only the schema is withheld.
      expect(
        (parse(result.configText).rules as Record<string, unknown>[])[0]?.rule,
      ).toBe("custom");
    }
  });
});

describe("generateInitConfig · rationale comment safety", () => {
  it("keeps a newline-bearing rationale on a single comment line, preserving valid JSONC", () => {
    const result = generateInitConfig({
      action: "fresh",
      include: undefined,
      // A repo-derived rationale with an embedded CR/LF (an unusual but valid path edge) must not
      // terminate the `//` comment early.
      newRules: [
        buildRule({
          rule: "GRP-001",
          category: "GRP",
          rationale: "cycle a.md ->\r\nweird\nb.md",
        }),
      ],
      packageSchemaRef: PACKAGE_SCHEMA_REF,
    });

    // The whole file still parses as JSONC to the expected data.
    expect(parse(result.configText).rules).toEqual([{ rule: "GRP-001" }]);
    // The rationale collapsed to one line — no raw line terminator survives inside the comment.
    expect(result.configText).toContain("// cycle a.md -> weird b.md");
    const commentLine = result.configText
      .split("\n")
      .find((line) => line.includes("//"));
    expect(commentLine).toBeDefined();
    expect(commentLine).not.toMatch(/[\r]/);
  });
});

describe("buildCiWorkflowYaml", () => {
  it("is self-contained (installs + runs the CLI), not a `uses:` reference to the unbuilt Action", () => {
    const yaml = buildCiWorkflowYaml();
    expect(yaml).toContain("npm install --no-save @wastech-mdlint/cli");
    expect(yaml).toContain("npx wastech-mdlint lint --fail-on error");
    expect(yaml).not.toContain("uses: VladimirMakarevich/");
  });

  it("shell-quotes a config path with spaces as a single argument inside a block scalar", () => {
    const yaml = buildCiWorkflowYaml("doc site/wastech-mdlint.config.json");
    expect(yaml).toContain("--config 'doc site/wastech-mdlint.config.json'");
    expect(yaml).toContain("- run: |");
  });

  it("rejects a config path with a line terminator rather than emit a broken/mis-run workflow", () => {
    // The lint step is a YAML block scalar; an embedded newline would split the shell command, and
    // stripping it would mis-target the config — so the contract is to reject (the CLI declines the
    // opt-in workflow before reaching this).
    expect(() =>
      buildCiWorkflowYaml("bad\nname/wastech-mdlint.config.json"),
    ).toThrow(/line terminator/);
    expect(() =>
      buildCiWorkflowYaml("bad\rname/wastech-mdlint.config.json"),
    ).toThrow(/line terminator/);
  });

  // P9.07 (audit L-7): the function takes no package-manager input at all — it is npm-universal by
  // design, not a detection result that got lost on the way in. See the function's own doc comment
  // for why (the install step only fetches the external CLI, never the target repo's dependencies).
  it("has no package-manager parameter — the workflow is npm-universal by design (P9.07)", () => {
    // Only `configPath` is accepted; there is no second parameter a caller could use to thread a
    // detected package manager through.
    expect(buildCiWorkflowYaml.length).toBe(1);
    const rootYaml = buildCiWorkflowYaml();
    const subdirYaml = buildCiWorkflowYaml("docs/wastech-mdlint.config.json");
    for (const yaml of [rootYaml, subdirYaml]) {
      expect(yaml).toContain("npm install --no-save @wastech-mdlint/cli");
      expect(yaml).not.toMatch(/\b(pnpm|bunx?|yarn)\b/);
    }
  });
});

describe("containsJsoncComments", () => {
  it("detects line and block comments anywhere in the document", () => {
    for (const text of [
      '// leading\n{ "include": [] }\n',
      '{\n  "include": [] // trailing\n}\n',
      '{\n  /* block */ "include": []\n}\n',
      '{ "include": [] }\n// after the root object\n',
    ]) {
      expect(containsJsoncComments(text)).toBe(true);
    }
  });

  it("does not report comment-like text inside a string value", () => {
    // The whole reason this is token-based: a regex over the raw bytes calls both of these
    // comment-bearing, which would make `init` warn about comment loss on a config that has none.
    for (const text of [
      '{ "include": ["docs/**/*.md"], "$schema": "https://example.test/s.json" }\n',
      '{ "exclude": ["**/a//b/**"], "settings": { "note": "/* not a comment */" } }\n',
    ]) {
      expect(containsJsoncComments(text)).toBe(false);
    }
  });

  it("reports no comments for plain JSON and for an empty document", () => {
    expect(containsJsoncComments('{\n  "rules": []\n}\n')).toBe(false);
    expect(containsJsoncComments("")).toBe(false);
  });
});

describe("resolvePackageSchemaRef", () => {
  it("wires a root config to the package schema directly under node_modules", () => {
    expect(resolvePackageSchemaRef("/repo", "/repo")).toBe(
      "./node_modules/@wastech-mdlint/cli/schema.json",
    );
  });

  it("climbs one level for a config one directory below the schema anchor", () => {
    expect(resolvePackageSchemaRef("/repo/docs", "/repo")).toBe(
      "../node_modules/@wastech-mdlint/cli/schema.json",
    );
  });

  it("climbs multiple levels for a config nested under a workspace package", () => {
    expect(resolvePackageSchemaRef("/repo/packages/foo", "/repo")).toBe(
      "../../node_modules/@wastech-mdlint/cli/schema.json",
    );
  });
});

describe("identifyExistingRule", () => {
  it("keys a built-in entry by its canonical rule id", () => {
    expect(
      identifyExistingRule({ rule: "ref001", severity: "warning" }),
    ).toEqual({
      kind: "builtin",
      canonicalId: "REF-001",
    });
  });

  it('keys a custom entry by its canonical id, not the literal "custom"', () => {
    expect(
      identifyExistingRule({
        rule: "custom",
        id: "req-owner",
        description: "x",
      }),
    ).toEqual({
      kind: "custom",
      rule: { id: "REQ-OWNER", description: "x" },
    });
  });

  it("marks unidentifiable entries invalid (non-object, non-string rule, bad/absent custom id)", () => {
    // Custom entries need a schemaable string id; `foo` fails the grammar and `SEC` reuses a reserved
    // built-in prefix, so both are invalid — the loader would reject them too.
    for (const entry of [
      "REF-001",
      null,
      { rule: 1 },
      { rule: "custom" },
      { rule: "custom", id: 1 },
      { rule: "custom", id: "foo" },
      { rule: "custom", id: "SEC-100" },
    ]) {
      expect(identifyExistingRule(entry)).toEqual({ kind: "invalid" });
    }
  });
});
