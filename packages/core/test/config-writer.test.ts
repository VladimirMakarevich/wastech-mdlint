import { describe, expect, it } from "vitest";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import {
  buildCiWorkflowYaml,
  generateInitConfig,
  identifyExistingRule,
  resolvePackageSchemaRef,
  type GenerateInitConfigParams
} from "../src/discovery/config-writer.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { generateConfigSchema } from "../src/engine/schema.js";
import { DEFAULT_NOISE_DIR_NAMES } from "../src/discovery/repo-scan-constants.js";
import type { InferredRule } from "../src/discovery/rule-inference.js";

// The fresh-write `exclude` mirrors the scanner's pruned noise directories as globs, sorted by the
// same host-independent comparator as production.
const EXPECTED_EXCLUDE = [...DEFAULT_NOISE_DIR_NAMES].map((name) => `${name}/**`).sort(compareStrings);

function buildRule(overrides: Partial<InferredRule> & { rule: string }): InferredRule {
  return {
    category: "REF",
    description: "A rule description.",
    defaultSeverity: "warning",
    fixable: false,
    rationale: `rationale for ${overrides.rule}`,
    ...overrides
  };
}

function parse(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  expect(errors).toEqual([]);
  return parsed as Record<string, unknown>;
}

// The CLI computes this relative to the config's own directory; for a root config it is the documented
// C9 default. Tests pass it explicitly since generateInitConfig no longer hardcodes it.
const PACKAGE_SCHEMA_REF = "./node_modules/@wastech-mdlint/cli/schema.json";

const FRESH_PARAMS: GenerateInitConfigParams = {
  action: "fresh",
  include: ["docs/**/*.md"],
  newRules: [buildRule({ rule: "REF-001" }), buildRule({ rule: "TBL-002", category: "TBL" })],
  packageSchemaRef: PACKAGE_SCHEMA_REF
};

describe("generateInitConfig · fresh", () => {
  it("writes canonical ids, the package $schema, and a non-empty include", () => {
    const result = generateInitConfig(FRESH_PARAMS);
    const config = parse(result.configText);

    expect(config.$schema).toBe("./node_modules/@wastech-mdlint/cli/schema.json");
    expect(result.schemaRef).toBe("./node_modules/@wastech-mdlint/cli/schema.json");
    expect(config.include).toEqual(["docs/**/*.md"]);
    // Deliverable 1 / C1: a fresh write carries the scanner's pruned noise dirs as `exclude`.
    expect(config.exclude).toEqual(EXPECTED_EXCLUDE);
    expect(config.rules).toEqual([{ rule: "REF-001" }, { rule: "TBL-002" }]);
    expect(result.addedRuleCount).toBe(2);
    expect(result.totalRuleCount).toBe(2);
    // C9: no remote URL anywhere, asserted on the raw bytes, not just by construction.
    expect(result.configText).not.toMatch(/https?:\/\//);
    expect(result.projectSchema).toBeUndefined();
  });

  it("omits include for a fallback/root config but still writes the noise excludes", () => {
    const result = generateInitConfig({
      action: "fresh",
      include: [],
      newRules: [buildRule({ rule: "REF-001" })],
      packageSchemaRef: PACKAGE_SCHEMA_REF
    });
    const config = parse(result.configText);
    // No `include` key means lintFiles falls back to `**/*.md`; `exclude` must still prune the noise
    // trees so init never broadens the scanned corpus back to node_modules/.git/dist/…
    expect("include" in config).toBe(false);
    expect(config.exclude).toEqual(EXPECTED_EXCLUDE);
    expect(config.exclude).toContain("node_modules/**");
    expect(config.exclude).toContain(".git/**");
  });

  it("appends each new rule's rationale as a trailing // comment while staying valid JSONC", () => {
    const result = generateInitConfig(FRESH_PARAMS);
    // The literal comment text must be present in the bytes...
    expect(result.configText).toContain("// rationale for REF-001");
    expect(result.configText).toContain("// rationale for TBL-002");
    // ...and the file must still parse as JSONC (comments tolerated) to the same data.
    expect(parse(result.configText).rules).toEqual([{ rule: "REF-001" }, { rule: "TBL-002" }]);
  });

  it("is deterministic across repeated calls", () => {
    expect(generateInitConfig(FRESH_PARAMS).configText).toBe(generateInitConfig(FRESH_PARAMS).configText);
  });

  it("wires exactly the package schema ref it is given (e.g. a subdirectory-relative `../` path)", () => {
    const result = generateInitConfig({
      action: "fresh",
      include: [],
      newRules: [buildRule({ rule: "REF-001" })],
      packageSchemaRef: "../node_modules/@wastech-mdlint/cli/schema.json"
    });
    // The writer does not hardcode a root-relative literal — it serializes the CLI-computed ref, so a
    // config written into a subdirectory can point up at the hoisted node_modules.
    expect(parse(result.configText).$schema).toBe("../node_modules/@wastech-mdlint/cli/schema.json");
    expect(result.schemaRef).toBe("../node_modules/@wastech-mdlint/cli/schema.json");
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
        rules: [{ rule: "REF-001", severity: "warning" }]
      }
    };
    const result = generateInitConfig({
      action: "merge",
      existing,
      include: ["ignored/**/*.md"],
      newRules: [buildRule({ rule: "TBL-002", category: "TBL" })],
      packageSchemaRef: PACKAGE_SCHEMA_REF
    });
    const config = parse(result.configText);

    expect(config.include).toEqual(["src/**/*.md"]);
    expect(config.exclude).toEqual(["dist/**"]);
    expect(config.settings).toEqual({ siteRouter: { preset: "starlight" } });
    expect(config.compile).toEqual({ skill: { name: "x", description: "y" } });
    expect(config.futureKey).toEqual({ anything: true });
    // Existing entry kept verbatim (severity preserved), new entry appended.
    expect(config.rules).toEqual([{ rule: "REF-001", severity: "warning" }, { rule: "TBL-002" }]);
    expect(result.addedRuleCount).toBe(1);
    expect(result.totalRuleCount).toBe(2);
    expect(result.projectSchema).toBeUndefined();
  });

  it("preserves an existing custom rule and generates a matching project-local schema", () => {
    const customEntry = {
      rule: "custom",
      id: "REQ-100",
      description: "Requires an owner.",
      options: { assert: { kind: "sectionPresent", sections: ["Owner"] } }
    };
    const existing = { raw: { rules: [customEntry] } };
    const result = generateInitConfig({
      action: "merge",
      existing,
      include: [],
      newRules: [buildRule({ rule: "REF-001" })],
      packageSchemaRef: PACKAGE_SCHEMA_REF
    });
    const config = parse(result.configText);

    expect((config.rules as unknown[])[0]).toEqual(customEntry);
    expect(result.schemaRef).toBe("./schema.json");
    expect(config.$schema).toBe("./schema.json");
    expect(result.projectSchema?.fileName).toBe("schema.json");
    expect(result.projectSchema?.text).toBe(
      generateConfigSchema({ customRules: [{ id: "REQ-100", description: "Requires an owner." }] })
    );
  });

  it("canonicalizes noncanonical existing ids on write (C3), keeping severity/options intact", () => {
    const existing = {
      raw: {
        rules: [
          { rule: "ref001", severity: "warning", options: { exclude: ["legacy/**"] } },
          { rule: "custom", id: "req-owner", options: { assert: { kind: "sectionPresent", sections: ["Owner"] } } }
        ]
      }
    };
    const result = generateInitConfig({
      action: "merge",
      existing,
      include: [],
      newRules: [buildRule({ rule: "TBL-002", category: "TBL" })],
      packageSchemaRef: PACKAGE_SCHEMA_REF
    });
    const config = parse(result.configText);
    const rules = config.rules as Record<string, unknown>[];

    // Ids canonicalized (ref001 → REF-001, req-owner → REQ-OWNER) but severity/options preserved.
    expect(rules[0]).toEqual({ rule: "REF-001", severity: "warning", options: { exclude: ["legacy/**"] } });
    expect(rules[1]).toEqual({
      rule: "custom",
      id: "REQ-OWNER",
      options: { assert: { kind: "sectionPresent", sections: ["Owner"] } }
    });
    // The custom id in the config agrees with the id the generated project schema is built from.
    expect(config.$schema).toBe("./schema.json");
    expect(result.projectSchema?.text).toBe(generateConfigSchema({ customRules: [{ id: "REQ-OWNER" }] }));
  });

  it("does not seed a project schema from a custom id the loader would reject", () => {
    // `foo` has no dash and `REF-OWNER` reuses a reserved built-in prefix — both fail
    // resolveCustomRule's grammar/prefix checks, so a project schema claiming they are valid would
    // disagree with loadConfiguration.
    for (const invalidId of ["foo", "ref-owner"]) {
      const existing = {
        raw: {
          rules: [{ rule: "custom", id: invalidId, options: { assert: { kind: "sectionPresent", sections: ["X"] } } }]
        }
      };
      const result = generateInitConfig({
        action: "merge",
        existing,
        include: [],
        newRules: [buildRule({ rule: "REF-001" })],
        packageSchemaRef: PACKAGE_SCHEMA_REF
      });

      expect(result.projectSchema).toBeUndefined();
      expect(result.schemaRef).toBe("./node_modules/@wastech-mdlint/cli/schema.json");
      // The user's own entry is still preserved verbatim (canonicalized) — only the schema is withheld.
      expect((parse(result.configText).rules as Record<string, unknown>[])[0]?.rule).toBe("custom");
    }
  });
});

describe("generateInitConfig · rationale comment safety", () => {
  it("keeps a newline-bearing rationale on a single comment line, preserving valid JSONC", () => {
    const result = generateInitConfig({
      action: "fresh",
      include: [],
      // A repo-derived rationale with an embedded CR/LF (an unusual but valid path edge) must not
      // terminate the `//` comment early.
      newRules: [buildRule({ rule: "GRP-001", category: "GRP", rationale: "cycle a.md ->\r\nweird\nb.md" })],
      packageSchemaRef: PACKAGE_SCHEMA_REF
    });

    // The whole file still parses as JSONC to the expected data.
    expect(parse(result.configText).rules).toEqual([{ rule: "GRP-001" }]);
    // The rationale collapsed to one line — no raw line terminator survives inside the comment.
    expect(result.configText).toContain("// cycle a.md -> weird b.md");
    const commentLine = result.configText.split("\n").find((line) => line.includes("//"));
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
    expect(() => buildCiWorkflowYaml("bad\nname/wastech-mdlint.config.json")).toThrow(/line terminator/);
    expect(() => buildCiWorkflowYaml("bad\rname/wastech-mdlint.config.json")).toThrow(/line terminator/);
  });
});

describe("resolvePackageSchemaRef", () => {
  it("wires a root config to the package schema directly under node_modules", () => {
    expect(resolvePackageSchemaRef("/repo", "/repo")).toBe("./node_modules/@wastech-mdlint/cli/schema.json");
  });

  it("climbs one level for a config one directory below the schema anchor", () => {
    expect(resolvePackageSchemaRef("/repo/docs", "/repo")).toBe("../node_modules/@wastech-mdlint/cli/schema.json");
  });

  it("climbs multiple levels for a config nested under a workspace package", () => {
    expect(resolvePackageSchemaRef("/repo/packages/foo", "/repo")).toBe(
      "../../node_modules/@wastech-mdlint/cli/schema.json"
    );
  });
});

describe("identifyExistingRule", () => {
  it("keys a built-in entry by its canonical rule id", () => {
    expect(identifyExistingRule({ rule: "ref001", severity: "warning" })).toEqual({
      kind: "builtin",
      canonicalId: "REF-001"
    });
  });

  it("keys a custom entry by its canonical id, not the literal \"custom\"", () => {
    expect(identifyExistingRule({ rule: "custom", id: "req-owner", description: "x" })).toEqual({
      kind: "custom",
      rule: { id: "REQ-OWNER", description: "x" }
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
      { rule: "custom", id: "SEC-100" }
    ]) {
      expect(identifyExistingRule(entry)).toEqual({ kind: "invalid" });
    }
  });
});
