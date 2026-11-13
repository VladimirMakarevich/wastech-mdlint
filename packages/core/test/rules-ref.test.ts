import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { applyFixes } from "../src/engine/fix.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { RuleResolutionError } from "../src/engine/registry.js";
import { ruleRegistry } from "../src/engine/rules/index.js";
import type { ResolvedSettings } from "../src/engine/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-ref-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

function rule(id: string, options?: unknown): ConfiguredRule {
  return { rule: ruleRegistry.resolveRule(id, options) };
}

async function lint(
  cwd: string,
  rules: ConfiguredRule[],
  settings: ResolvedSettings = {},
) {
  return lintFiles({ cwd, config: { rules: [] }, rules, settings });
}

describe("REF-002 anchors", () => {
  it("flags anchors that match no heading slug (same-file and cross-file)", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "## Intro\n\n[self](#intro)\n[bad](#nope)\n[cross](b.md#overview)\n[crossbad](b.md#missing)\n",
      "b.md": "## Overview\n",
    });
    const result = await lint(cwd, [rule("REF-002")]);
    expect(
      result.messages.map((message) => message.data?.anchor).sort(),
    ).toEqual(["missing", "nope"]);
  });

  // Frontmatter used to parse as a setext H2, so a link to this invented slug resolved and passed.
  // It must now be a broken anchor in both the same-file and the cross-file form.
  it("reports a link to the slug frontmatter used to invent as a broken anchor", async () => {
    const bogus = "name-demo-skilldescription-does-a-thing";
    const cwd = await fixtureRepo({
      "a.md": `---\nname: demo-skill\ndescription: does a thing\n---\n\n# Title\n\n[bad](#${bogus})\n[good](#title)\n`,
      "b.md": `# B\n\n[cross](a.md#${bogus})\n[crossgood](a.md#title)\n`,
    });
    const result = await lint(cwd, [rule("REF-002")]);
    expect(
      result.messages.map((message) => [
        message.filePath,
        message.line,
        message.data?.anchor,
      ]),
    ).toEqual([
      ["a.md", 8, bogus],
      ["b.md", 3, bogus],
    ]);
  });

  function reportedAnchors(result: {
    messages: { data?: Record<string, unknown> }[];
  }): unknown[] {
    return result.messages.map((message) => message.data?.anchor);
  }

  it("resolves HTML `id` and `name` anchors same-file and cross-file", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        '# A\n\n<a id="custom"></a>\n\n<a name="named"></a>\n\n[s1](#custom)\n[s2](#named)\n[c1](b.md#bid)\n[c2](b.md#bname)\n[bad](b.md#absent)\n',
      "b.md": '# B\n\nText <a id="bid"></a> and <a name="bname"></a>.\n',
    });
    const result = await lint(cwd, [rule("REF-002")]);
    expect(reportedAnchors(result)).toEqual(["absent"]);
    expect(result.messages[0]?.message).toContain("heading or HTML anchor");
  });

  // HTML keeps the first of two `id`s on one tag, so the second is not a fragment target.
  it("reports a fragment named only by a repeated attribute", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        '# A\n\n<a id="real" id="ghost"></a>\n\n[r](#real)\n[g](#ghost)\n',
      "b.md": "# B\n\n[c](a.md#ghost)\n",
    });
    const result = await lint(cwd, [rule("REF-002")]);
    expect(reportedAnchors(result)).toEqual(["ghost", "ghost"]);
  });

  // A tag written inside a `<script>` or `<textarea>` is text on the rendered page, so a link to
  // its `id` goes nowhere.
  it("reports a fragment declared only inside a raw-text element", async () => {
    const cwd = await fixtureRepo({
      "a.md": `# A\n\n<script>const x = '<a id="ghost">';</script>\n\n[g](#ghost)\n[c](b.md#ghost)\n`,
      "b.md": `# B\n\nText <textarea><a id="ghost"></a></textarea>.\n`,
    });
    const result = await lint(cwd, [rule("REF-002")]);
    expect(reportedAnchors(result)).toEqual(["ghost", "ghost"]);
  });

  // `id=` inside another attribute's quoted value is text, not an anchor: accepting it would pass a
  // link that goes nowhere on the rendered page.
  it("reports a fragment that only appears inside a quoted attribute value", async () => {
    const cwd = await fixtureRepo({
      "a.md": `# A\n\n<div title="foo id='ghost'"></div>\n\n[g](#ghost)\n[c](b.md#ghost)\n`,
      "b.md": `# B\n\n<p title="x <span id='ghost'> y"></p>\n`,
    });
    const result = await lint(cwd, [rule("REF-002")]);
    expect(reportedAnchors(result)).toEqual(["ghost", "ghost"]);
  });

  it("accepts `#top` and GitHub line fragments, and rejects malformed line fragments", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "# A\n\n[t](#top)\n[T](#TOP)\n[l](#L5)\n[r](#L10-L12)\n[rc](#L10C5-L12C3)\n[x](b.md#L3)\n[e1](#L)\n[e2](#Lx)\n[e3](#L0)\n",
      "b.md": "# B\n",
    });
    const result = await lint(cwd, [rule("REF-002")]);
    expect(reportedAnchors(result)).toEqual(["L", "Lx", "L0"]);
  });

  it("compares case-sensitively by default and folds case with `ignoreCase`", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# Demo\n\n[d](#Demo)\n[l](#l5)\n",
    });
    expect(reportedAnchors(await lint(cwd, [rule("REF-002")]))).toEqual([
      "Demo",
      "l5",
    ]);
    // Line fragments stay case-sensitive under `ignoreCase`: `#l5` is not a GitHub line anchor.
    expect(
      reportedAnchors(await lint(cwd, [rule("REF-002", { ignoreCase: true })])),
    ).toEqual(["l5"]);
  });

  it("skips only fragments matching `ignoredPattern`", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# A\n\n[g](#gen-x)\n[o](#other)\n[c](b.md#gen-y)\n",
      "b.md": "# B\n",
    });
    expect(
      reportedAnchors(
        await lint(cwd, [rule("REF-002", { ignoredPattern: "^gen-" })]),
      ),
    ).toEqual(["other"]);
  });

  // @boundary-guard determinism
  //
  // `ignoredPattern` is compiled once per resolved rule and shared across every link, document and
  // run. Had it carried a `g` flag, `lastIndex` would survive a successful `.test()`, so the second
  // of two consecutive matching fragments would fail to match and be reported — and a second run
  // with the same rule would start from a different `lastIndex` than the first. Consecutive matches
  // interleaved with misses, linted twice through one rule instance, is the shape that exposes it.
  it("gives identical findings when one `ignoredPattern` rule is run twice", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "# A\n\n[1](#skip-a)\n[2](#skip-b)\n[3](#keep-a)\n[4](#skip-c)\n[5](#skip-d)\n[6](#keep-b)\n",
    });
    const configured = rule("REF-002", { ignoredPattern: "^skip" });

    const first = await lint(cwd, [configured]);
    const second = await lint(cwd, [configured]);

    expect(reportedAnchors(first)).toEqual(["keep-a", "keep-b"]);
    expect(second.messages).toEqual(first.messages);
  });
});

describe("REF-003 images", () => {
  it("flags missing images and skips external ones", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "![real](real.png)\n![missing](missing.png)\n![ext](https://x/y.png)\n",
    });
    await writeFile(path.join(cwd, "real.png"), "x", "utf8");

    const result = await lint(cwd, [rule("REF-003")]);
    expect(result.messages.map((message) => message.data?.target)).toEqual([
      "missing.png",
    ]);
  });
});

// The REF half of the shared `exclude` matrix. REF-002, REF-007, REF-008 and REF-009 are the REF rules that
// mix in the shared file-scope shape; REF-001/REF-003 spell `exclude` too but mean something else, which is
// pinned separately below.
describe.each([
  ["REF-002", "## Intro\n\n[bad](#nope)\n"],
  ["REF-007", "[text][missing]\n"],
  ["REF-008", "[text]()\n"],
  ["REF-009", "[unused]: ./x.md\n"],
])("%s file scope (exclude)", (ruleId, failingDoc) => {
  async function reportedFiles(
    cwd: string,
    configured: ConfiguredRule,
  ): Promise<string[]> {
    const result = await lint(cwd, [configured]);
    return [
      ...new Set(result.messages.map((message) => message.filePath)),
    ].sort(compareStrings);
  }

  it("drops an excluded document, with and without `files`", async () => {
    const cwd = await fixtureRepo({
      "docs/a.md": failingDoc,
      "drafts/b.md": failingDoc,
    });

    expect(await reportedFiles(cwd, rule(ruleId))).toEqual([
      "docs/a.md",
      "drafts/b.md",
    ]);
    // The unscoped shape — `exclude` with no `files` beside it to carry the filtering.
    expect(
      await reportedFiles(cwd, rule(ruleId, { exclude: ["drafts/**"] })),
    ).toEqual(["docs/a.md"]);
    expect(
      await reportedFiles(
        cwd,
        rule(ruleId, { files: ["**/*.md"], exclude: ["drafts/**"] }),
      ),
    ).toEqual(["docs/a.md"]);
  });
});

// Same key, opposite subject: REF-001/REF-003 filter the *target* they are about to probe
// (`primitives/reference.ts`), not the document being scanned. A reader who assumes file scope here
// would expect the second half of each pair to fall silent — it must not.
describe("REF-001 / REF-003 exclude is a link-target filter, not file scope", () => {
  it("REF-001 silences a link pointing into the excluded directory, not links written there", async () => {
    const cwd = await fixtureRepo({
      // Target `drafts/x.md` — matched by the exclude.
      "docs/a.md": "[into drafts](../drafts/x.md)\n",
      // Target `docs/missing.md` — outside the exclude, though the *source* is in `drafts/`.
      "drafts/b.md": "[out of drafts](../docs/missing.md)\n",
    });

    const unfiltered = await lint(cwd, [rule("REF-001")]);
    expect(
      unfiltered.messages
        .map((message) => message.filePath)
        .sort(compareStrings),
    ).toEqual(["docs/a.md", "drafts/b.md"]);

    const filtered = await lint(cwd, [
      rule("REF-001", { exclude: ["drafts/**"] }),
    ]);
    expect(filtered.messages.map((message) => message.filePath)).toEqual([
      "drafts/b.md",
    ]);
  });

  it("REF-003 silences an image pointing into the excluded directory, not images written there", async () => {
    const cwd = await fixtureRepo({
      "docs/a.md": "![into drafts](../drafts/x.png)\n",
      "drafts/b.md": "![out of drafts](../docs/missing.png)\n",
    });

    const unfiltered = await lint(cwd, [rule("REF-003")]);
    expect(
      unfiltered.messages
        .map((message) => message.filePath)
        .sort(compareStrings),
    ).toEqual(["docs/a.md", "drafts/b.md"]);

    const filtered = await lint(cwd, [
      rule("REF-003", { exclude: ["drafts/**"] }),
    ]);
    expect(filtered.messages.map((message) => message.filePath)).toEqual([
      "drafts/b.md",
    ]);
  });
});

// `exclude` used to be applied on only one of `linkResolves`'s two resolution
// branches, so *any* configured router — including a bare `{}`, which validates because every
// siteRouter field is optional — silently turned the option off. These pin that the two options
// compose, on the inherited setting and on the per-rule override alike.
describe("REF-001 exclude applies with a site router configured", () => {
  const GENERATED_LINK = "[gen](/generated/x.md)\n";

  it("skips an excluded root-relative target under an inherited empty siteRouter", async () => {
    const cwd = await fixtureRepo({ "docs/a.md": GENERATED_LINK });

    // The control: no router at all. Both runs must agree — that agreement is the whole finding.
    expect(
      await lint(cwd, [rule("REF-001", { exclude: ["generated/**"] })]),
    ).toMatchObject({ messages: [] });
    expect(
      await lint(cwd, [rule("REF-001", { exclude: ["generated/**"] })], {
        siteRouter: {},
      }),
    ).toMatchObject({ messages: [] });
  });

  it("skips an excluded root-relative target under a per-rule siteRouter override", async () => {
    const cwd = await fixtureRepo({ "docs/a.md": GENERATED_LINK });

    const result = await lint(cwd, [
      rule("REF-001", { exclude: ["generated/**"], siteRouter: {} }),
    ]);
    expect(result.messages).toEqual([]);
  });

  // `exclude` matches the *resolved* repo-relative candidates, never the raw URL: under starlight
  // the router maps `/generated/page` into `contentDir`, so the glob a user writes has to name the
  // source location. Pinned because it is the only way to tell the two models apart.
  it("matches the router's resolved candidates rather than the raw URL", async () => {
    const cwd = await fixtureRepo({
      "src/content/docs/a.md": "[gen](/generated/page)\n",
    });
    const settings: ResolvedSettings = {
      siteRouter: { preset: "starlight", contentDir: "src/content/docs" },
    };

    expect(
      await lint(
        cwd,
        [rule("REF-001", { exclude: ["src/content/docs/generated/**"] })],
        settings,
      ),
    ).toMatchObject({ messages: [] });
    // The raw-URL-shaped glob does not match any candidate, so the link is still reported.
    expect(
      await lint(
        cwd,
        [rule("REF-001", { exclude: ["generated/**"] })],
        settings,
      ),
    ).toMatchObject({ messages: [{ data: { target: "/generated/page" } }] });
  });
});

describe("REF option schemas (file scope inventory)", () => {
  function resolutionError(id: string, options: unknown): RuleResolutionError {
    let thrown: unknown;
    try {
      ruleRegistry.resolveRule(id, options);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuleResolutionError);
    return thrown as RuleResolutionError;
  }

  // Every REF rule except REF-002, REF-007, REF-008 and REF-009 is whole-corpus or identity-based by design, so `files` is not a
  // silently ignored key — it fails resolution. This is what makes the pairing above unambiguous.
  it.each([
    ["REF-001", {}],
    ["REF-003", {}],
    ["REF-004", { zonesDir: "zones" }],
    [
      "REF-005",
      {
        definitions: ["a.md"],
        references: ["b.md"],
        idColumn: "ID",
        idPattern: "^R-\\d+$",
      },
    ],
    [
      "REF-006",
      {
        stabilityColumn: "Stability",
        stabilityOrder: ["experimental", "stable"],
        definitions: ["a.md"],
        references: ["b.md"],
        idColumn: "ID",
      },
    ],
  ])("rejects `files` on %s", (id, base) => {
    const error = resolutionError(id, { ...base, files: ["docs/**"] });
    expect(error.code).toBe("INVALID_OPTIONS");
    expect(JSON.stringify(error.issues)).toContain("files");
  });

  it.each(["REF-002", "REF-007", "REF-008", "REF-009"])(
    "accepts `files` and `exclude` on %s, a file-scoped REF rule",
    (id) => {
      expect(
        ruleRegistry.resolveRule(id, {
          files: ["docs/**"],
          exclude: ["docs/drafts/**"],
        }).id,
      ).toBe(id);
    },
  );

  it("rejects an `ignoredPattern` that does not compile, naming the rule and option path", () => {
    const error = resolutionError("REF-002", { ignoredPattern: "(" });
    expect(error.code).toBe("INVALID_OPTIONS");
    expect(error.ruleName).toBe("REF-002");
    expect(error.issues?.map((issue) => issue.path)).toEqual([
      ["options", "ignoredPattern"],
    ]);
  });

  it("rejects a non-boolean `ignoreCase`", () => {
    expect(resolutionError("REF-002", { ignoreCase: "yes" }).code).toBe(
      "INVALID_OPTIONS",
    );
  });

  it("rejects a non-boolean `includeShortcut`", () => {
    expect(resolutionError("REF-007", { includeShortcut: "yes" }).code).toBe(
      "INVALID_OPTIONS",
    );
  });
});

describe("REF-004 cross-zone links", () => {
  it("flags undeclared cross-zone links and allows declared ones", async () => {
    const cwd = await fixtureRepo({
      "zones/auth/page.md":
        "## Dependencies\n\n- billing\n\n## Body\n\n[bill](../billing/x.md)\n[pay](../payments/y.md)\n",
      "zones/billing/x.md": "# x\n",
      "zones/payments/y.md": "# y\n",
    });
    const result = await lint(cwd, [rule("REF-004", { zonesDir: "zones" })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      fromZone: "auth",
      toZone: "payments",
    });
  });

  it("recognizes a custom dependencySection heading instead of the 'Dependencies' default", async () => {
    const cwd = await fixtureRepo({
      "zones/auth/page.md":
        "## Deps\n\n- payments\n\n## Body\n\n[bill](../billing/x.md)\n[pay](../payments/y.md)\n",
      "zones/billing/x.md": "# x\n",
      "zones/payments/y.md": "# y\n",
    });
    const result = await lint(cwd, [
      rule("REF-004", { zonesDir: "zones", dependencySection: "Deps" }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      fromZone: "auth",
      toZone: "billing",
    });
  });

  it("does not crash on a regex-special zone name and matches it literally", async () => {
    const cwd = await fixtureRepo({
      "zones/auth/page.md":
        "## Dependencies\n\n- c++\n\n## Body\n\n[cpp](../c++/x.md)\n[bill](../billing/x.md)\n",
      "zones/c++/x.md": "# x\n",
      "zones/billing/x.md": "# x\n",
    });
    const result = await lint(cwd, [rule("REF-004", { zonesDir: "zones" })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      fromZone: "auth",
      toZone: "billing",
    });
  });

  it("does not crash on a zone name with an unbalanced paren", async () => {
    const cwd = await fixtureRepo({
      "zones/auth/page.md": "## Dependencies\n\nNothing special here.\n",
      "zones/we)ird/x.md": "# x\n",
    });
    const result = await lint(cwd, [rule("REF-004", { zonesDir: "zones" })]);
    expect(result.messages).toEqual([]);
  });

  it("does not let a dot in a zone name match any character", async () => {
    const cwd = await fixtureRepo({
      "zones/auth/page.md":
        "## Dependencies\n\nWe rely on nodeXjs for scripting.\n\n## Body\n\n[link](../node.js/x.md)\n",
      "zones/node.js/x.md": "# x\n",
    });
    const result = await lint(cwd, [rule("REF-004", { zonesDir: "zones" })]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      fromZone: "auth",
      toZone: "node.js",
    });
  });
});

describe("REF-005 ID traceability", () => {
  it("reports dangling references (error) and orphan definitions (warning)", async () => {
    const cwd = await fixtureRepo({
      "reqs.md": "| ID |\n| --- |\n| REQ-1 |\n| REQ-2 |\n",
      "design.md": "| ID |\n| --- |\n| REQ-1 |\n| REQ-9 |\n",
    });
    const result = await lint(cwd, [
      rule("REF-005", {
        definitions: ["reqs.md"],
        references: ["design.md"],
        idColumn: "ID",
        idPattern: "^REQ-\\d+$",
      }),
    ]);

    const dangling = result.messages.find(
      (message) => message.severity === "error",
    );
    const orphan = result.messages.find(
      (message) => message.severity === "warning",
    );
    expect(dangling).toMatchObject({
      filePath: "design.md",
      data: { id: "REQ-9" },
    });
    expect(orphan).toMatchObject({
      filePath: "reqs.md",
      data: { id: "REQ-2" },
    });
  });

  it("states the lookup each branch performed rather than a claim about the corpus", async () => {
    // An id mentioned in prose, in a link, or in a filename is not in an `idColumn`, and the rule
    // never looked there — so a bare "is never referenced" is refuted by one grep, and a reader who
    // catches it that way stops trusting the findings that were real. Asserted on the text, because a
    // count-based assertion reads identically before and after the wording is fixed.
    const cwd = await fixtureRepo({
      "reqs.md": "| ID |\n| --- |\n| REQ-1 |\n| REQ-2 |\n",
      "design.md":
        "| ID |\n| --- |\n| REQ-1 |\n| REQ-9 |\n\nREQ-2 is discussed in prose here.\n",
    });
    const result = await lint(cwd, [
      rule("REF-005", {
        definitions: ["reqs.md", "spec/**/*.md"],
        references: ["design.md"],
        idColumn: "ID",
        idPattern: "^REQ-\\d+$",
      }),
    ]);

    // The orphan names the column and the reference globs it searched, and nothing else: references
    // are column-only, so it must not offer headings as a place the id could have been found.
    expect(
      result.messages.find((message) => message.severity === "warning")
        ?.message,
    ).toBe(
      'Definition "REQ-2" is not referenced: it is not in the "ID" column of any table in "design.md".',
    );
    // The dangling branch searched the definition globs, and definitions are column *plus* heading
    // tokens — the asymmetry is real, so the two messages must not be interchangeable.
    expect(
      result.messages.find((message) => message.severity === "error")?.message,
    ).toBe(
      'Reference "REQ-9" has no definition: it is not in the "ID" column of any table, or in a heading, in "reqs.md", "spec/**/*.md".',
    );
  });

  it("treats a matching heading token as a definition too, not just a table row", async () => {
    const cwd = await fixtureRepo({
      "reqs.md": "# REQ-1\n\nIntroductory requirement.\n",
      "design.md": "| ID |\n| --- |\n| REQ-1 |\n",
    });
    const result = await lint(cwd, [
      rule("REF-005", {
        definitions: ["reqs.md"],
        references: ["design.md"],
        idColumn: "ID",
        idPattern: "^REQ-\\d+$",
      }),
    ]);
    expect(result.messages).toEqual([]);
  });
});

describe("REF-006 stability consistency", () => {
  it("warns when an entry depends on a less-stable entity", async () => {
    const cwd = await fixtureRepo({
      "defs.md":
        "| ID | Stability |\n| --- | --- |\n| A | stable |\n| B | experimental |\n",
      "refs.md": "| ID | Stability |\n| --- | --- |\n| B | stable |\n",
    });
    const result = await lint(cwd, [
      rule("REF-006", {
        stabilityColumn: "Stability",
        stabilityOrder: ["experimental", "stable"],
        definitions: ["defs.md"],
        references: ["refs.md"],
        idColumn: "ID",
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      severity: "warning",
      data: {
        referencedId: "B",
        referencedStability: "experimental",
        referencerStability: "stable",
      },
    });
  });

  it("evaluates every id in a multi-id cell independently", async () => {
    const cwd = await fixtureRepo({
      "defs.md":
        "| ID | Stability |\n| --- | --- |\n| A | stable |\n| B | experimental |\n",
      "refs.md": "| ID | Stability |\n| --- | --- |\n| A, B | stable |\n",
    });
    const result = await lint(cwd, [
      rule("REF-006", {
        stabilityColumn: "Stability",
        stabilityOrder: ["experimental", "stable"],
        definitions: ["defs.md"],
        references: ["refs.md"],
        idColumn: "ID",
      }),
    ]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.data).toMatchObject({
      referencedId: "B",
      referencedStability: "experimental",
      referencerStability: "stable",
    });
  });
});

describe("REF-007 undefined reference labels", () => {
  it("reports full link and image references with label, position and data", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# A\n\nSee [text][missing] and ![alt][Gone].\n",
    });
    const result = await lint(cwd, [rule("REF-007")]);
    expect(
      result.messages.map((message) => [
        message.ruleId,
        message.severity,
        message.line,
        message.column,
        message.message,
        message.data,
      ]),
    ).toEqual([
      [
        "REF-007",
        "error",
        3,
        5,
        'Reference "[missing]" has no definition, so it renders as literal text; add a "[missing]: <target>" definition or correct the label.',
        { label: "missing", kind: "link", referenceType: "full" },
      ],
      [
        "REF-007",
        "error",
        3,
        25,
        'Image reference "[Gone]" has no definition, so it renders as literal text; add a "[Gone]: <target>" definition or correct the label.',
        { label: "Gone", kind: "image", referenceType: "full" },
      ],
    ]);
  });

  it("reports a full link or image reference whose undefined label starts with `^`", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[text][^missing] ![alt][^gone] and a footnote[^1].\n",
    });
    const result = await lint(cwd, [rule("REF-007")]);
    expect(
      result.messages.map((message) => [message.column, message.data]),
    ).toEqual([
      [1, { label: "^missing", kind: "link", referenceType: "full" }],
      [18, { label: "^gone", kind: "image", referenceType: "full" }],
    ]);
  });

  it("matches a definition case-insensitively and reports nothing", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "[text][MISSING] ![alt][Missing] [Missing][]\n\n[missing]: b.md\n",
      "b.md": "# B\n",
    });
    expect((await lint(cwd, [rule("REF-007")])).messages).toEqual([]);
  });

  // `[sic]` and `[WIP]` in prose cannot be told apart from a shortcut reference, so the shortcut
  // form is opt-in; the collapsed form is an unambiguous attempt and is always reported.
  it("reports shortcut references only with `includeShortcut`", async () => {
    const cwd = await fixtureRepo({ "a.md": "[solo] and [pair][]\n" });
    const labels = async (options?: unknown) =>
      (await lint(cwd, [rule("REF-007", options)])).messages.map((message) => [
        message.data?.label,
        message.data?.referenceType,
      ]);

    expect(await labels()).toEqual([["pair", "collapsed"]]);
    expect(await labels({ includeShortcut: true })).toEqual([
      ["solo", "shortcut"],
      ["pair", "collapsed"],
    ]);
  });

  it("never reports a label inside a code span or a fenced block", async () => {
    const cwd = await fixtureRepo({
      "a.md": "Use `[a][b]` here.\n\n```md\n[a][b]\n[solo]\n```\n",
    });
    expect(
      (await lint(cwd, [rule("REF-007", { includeShortcut: true })])).messages,
    ).toEqual([]);
  });

  it("never reports a label inside nested inline HTML code", async () => {
    const cwd = await fixtureRepo({
      "a.md": "<code>a <code>b</code> [c][missing]</code>\n",
    });
    expect((await lint(cwd, [rule("REF-007")])).messages).toEqual([]);
  });

  it("is suppressed by an inline-disable directive", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "<!-- wastech-mdlint-disable-next-line REF-007 -->\n[a][missing]\n\n[b][missing]\n",
    });
    const result = await lint(cwd, [rule("REF-007")]);
    expect(result.messages.map((message) => message.line)).toEqual([4]);
  });

  // A defined label pointing at a missing file is REF-001's finding, not REF-007's: the reference
  // still resolves to a definition, so it must reach `links` exactly as before.
  it("leaves REF-001 on a defined reference unchanged and stays silent itself", async () => {
    const cwd = await fixtureRepo({ "a.md": "[x][d]\n\n[d]: missing.md\n" });
    const result = await lint(cwd, [rule("REF-001"), rule("REF-007")]);
    expect(result.messages.map((message) => message.ruleId)).toEqual([
      "REF-001",
    ]);
  });
});

describe("REF-008 empty targets and reversed link syntax", () => {
  function tuples(result: Awaited<ReturnType<typeof lint>>) {
    return result.messages.map((message) => [
      message.ruleId,
      message.severity,
      message.line,
      message.column,
      message.message,
      message.data,
    ]);
  }

  it("reports an empty link, a bare `#` link and an empty image with position and data", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# A\n\nSee [text]() and [top](#).\n\n![alt]()\n",
    });
    expect(tuples(await lint(cwd, [rule("REF-008")]))).toEqual([
      [
        "REF-008",
        "error",
        3,
        5,
        'Link "[text]" has an empty target, so it goes nowhere; add a target or remove the link.',
        { problem: "empty-target", kind: "link", target: "" },
      ],
      [
        "REF-008",
        "error",
        3,
        18,
        'Link "[top]" has a bare "#" target, so it only jumps to the top of the page; add a target or remove the link.',
        { problem: "empty-target", kind: "link", target: "#" },
      ],
      [
        "REF-008",
        "error",
        5,
        1,
        "Image has an empty target, so no image is shown; add a target or remove the image.",
        { problem: "empty-target", kind: "image", target: "" },
      ],
    ]);
  });

  // The parser resolves a reference through its definition before recording it, so an empty
  // definition is the same dead link as an empty inline target.
  it("reports an angle-bracket empty target and a reference whose definition is empty", async () => {
    const cwd = await fixtureRepo({ "a.md": "[t](<>) [x][d]\n\n[d]: <>\n" });
    const result = await lint(cwd, [rule("REF-008")]);
    expect(
      result.messages.map((message) => [message.column, message.data?.target]),
    ).toEqual([
      [1, ""],
      [9, ""],
    ]);
  });

  it("does not report a fragment with an anchor or a path ending in `#`", async () => {
    const cwd = await fixtureRepo({
      "a.md": "# Top\n\n[a](#top) [b](./a.md#)\n",
    });
    expect((await lint(cwd, [rule("REF-008")])).messages).toEqual([]);
  });

  it("reports reversed link syntax in prose at the opening paren", async () => {
    const cwd = await fixtureRepo({
      "a.md": "Read (the docs)[https://example.com] or (this)[./a.md].\n",
    });
    expect(tuples(await lint(cwd, [rule("REF-008")]))).toEqual([
      [
        "REF-008",
        "error",
        1,
        6,
        '"(the docs)[https://example.com]" is reversed link syntax and renders as literal text; write it as "[the docs](https://example.com)".',
        {
          problem: "reversed",
          text: "the docs",
          target: "https://example.com",
        },
      ],
      [
        "REF-008",
        "error",
        1,
        41,
        '"(this)[./a.md]" is reversed link syntax and renders as literal text; write it as "[this](./a.md)".',
        { problem: "reversed", text: "this", target: "./a.md" },
      ],
    ]);
  });

  it("never reports reversed syntax inside a code span or a fenced block", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "Use `(text)[https://example.com]` and `(text)[./a.md]`.\n\n```md\n(text)[https://example.com]\n(text)[./a.md]\n```\n",
    });
    expect((await lint(cwd, [rule("REF-008")])).messages).toEqual([]);
  });

  it("never reports reversed syntax inside nested inline HTML code, and reports it after", async () => {
    const cwd = await fixtureRepo({
      "a.md": "<code>outer <code>inner</code> (t)[./a.md]</code> (u)[./b.md]\n",
    });
    const result = await lint(cwd, [rule("REF-008")]);
    expect(
      result.messages.map((message) => [message.column, message.data?.text]),
    ).toEqual([[51, "u"]]);
  });

  it("does not report a parenthetical before a spaced citation or a defined reference link", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "As noted (see below) [1].\n\nRead (see the guide)[guide] first.\n\n[guide]: ./a.md\n",
    });
    expect((await lint(cwd, [rule("REF-008")])).messages).toEqual([]);
  });

  it("leaves REF-001 unchanged for non-empty targets", async () => {
    const cwd = await fixtureRepo({
      "a.md": "[a](missing.md) [b]() [c](./ok.md)\n",
      "ok.md": "# OK\n",
    });
    const result = await lint(cwd, [rule("REF-001"), rule("REF-008")]);
    expect(
      result.messages.map((message) => [
        message.ruleId,
        message.column,
        message.data?.target,
      ]),
    ).toEqual([
      ["REF-001", 1, "missing.md"],
      ["REF-008", 17, ""],
    ]);
  });

  it("is suppressed by an inline-disable directive", async () => {
    const cwd = await fixtureRepo({
      "a.md":
        "<!-- wastech-mdlint-disable-next-line REF-008 -->\n[a]() (b)[./b.md]\n\n[c]()\n",
    });
    const result = await lint(cwd, [rule("REF-008")]);
    expect(result.messages.map((message) => message.line)).toEqual([4]);
  });
});

// Run `--fix` twice and return the bytes after each run, plus what each run reported as fixed. The
// second run is the idempotency check: a fix whose output it would rewrite again is not
// deterministic, whatever the first run looked like.
async function fixTwice(
  cwd: string,
  rules: ConfiguredRule[],
  file: string,
): Promise<{ first: string; second: string; secondFixed: string[] }> {
  const input = { cwd, config: { rules: [] }, rules, settings: {} };
  await applyFixes(input);
  const first = await readFile(path.join(cwd, file), "utf8");
  const { fixedFiles } = await applyFixes(input);
  const second = await readFile(path.join(cwd, file), "utf8");
  return { first, second, secondFixed: fixedFiles };
}

describe("REF-002 --fix (case-only fragments)", () => {
  it("rewrites a same-file and a cross-file fragment to the exact slug, then changes nothing", async () => {
    const cwd = await fixtureRepo({
      "a.md": "## Demo\n\nSee [demo](#Demo) and [over](b.md#OverView) here.\n",
      "b.md": "## Overview\n",
    });
    const before = await lint(cwd, [rule("REF-002")]);
    expect(before.messages.map((message) => message.fixable)).toEqual([
      true,
      true,
    ]);

    const { first, second, secondFixed } = await fixTwice(
      cwd,
      [rule("REF-002")],
      "a.md",
    );
    expect(first).toBe(
      "## Demo\n\nSee [demo](#demo) and [over](b.md#overview) here.\n",
    );
    expect(second).toBe(first);
    expect(secondFixed).toEqual([]);
    expect((await lint(cwd, [rule("REF-002")])).messages).toEqual([]);
  });

  it("reports an ambiguous case-only match without fixing it", async () => {
    const content = '<a id="Setup"></a>\n\n# Setup\n\n[go](#SETUP)\n';
    const cwd = await fixtureRepo({ "a.md": content });
    const result = await lint(cwd, [rule("REF-002")]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.data?.anchor).toBe("SETUP");
    expect(result.messages[0]!.fixable).toBeUndefined();

    const written = await applyFixes({
      cwd,
      config: { rules: [] },
      rules: [rule("REF-002")],
      settings: {},
    });
    expect(written.fixedFiles).toEqual([]);
    await expect(readFile(path.join(cwd, "a.md"), "utf8")).resolves.toBe(
      content,
    );
  });

  it("reports but does not rewrite a reference-style link, a percent-encoded fragment, or a real miss", async () => {
    const content =
      "## Demo\n\n[ref][d] [enc](#%44emo) [miss](#nope)\n\n[d]: #Demo\n";
    const cwd = await fixtureRepo({ "a.md": content });
    const result = await lint(cwd, [rule("REF-002")]);
    expect(
      result.messages.map((message) => [message.data?.anchor, message.fixable]),
    ).toEqual([
      ["Demo", undefined],
      ["Demo", undefined],
      ["nope", undefined],
    ]);
    const { first } = await fixTwice(cwd, [rule("REF-002")], "a.md");
    expect(first).toBe(content);
  });

  it("has nothing to fix under ignoreCase", async () => {
    const content = "## Demo\n\n[demo](#Demo)\n";
    const cwd = await fixtureRepo({ "a.md": content });
    const configured = rule("REF-002", { ignoreCase: true });
    expect((await lint(cwd, [configured])).messages).toEqual([]);
    const { first } = await fixTwice(cwd, [configured], "a.md");
    expect(first).toBe(content);
  });

  it("leaves an out-of-scope file byte-unchanged", async () => {
    const content = "## Demo\n\n[demo](#Demo)\n";
    const cwd = await fixtureRepo({
      "docs/a.md": content,
      "drafts/b.md": content,
    });
    const written = await applyFixes({
      cwd,
      config: { rules: [] },
      rules: [rule("REF-002", { exclude: ["drafts/**"] })],
      settings: {},
    });
    expect(written.fixedFiles).toEqual(["docs/a.md"]);
    await expect(
      readFile(path.join(cwd, "drafts", "b.md"), "utf8"),
    ).resolves.toBe(content);
  });

  // Built at runtime: `.gitattributes` forces LF on committed files, so a checked-in CRLF fixture
  // would be converted before the test ever saw a `\r`.
  it("keeps CRLF line endings and every byte outside the fragment", async () => {
    const content = "## Demo\r\n\r\nSee [demo](#DEMO).\r\nEnd\r\n";
    const cwd = await fixtureRepo({ "a.md": content });
    const { first, second } = await fixTwice(cwd, [rule("REF-002")], "a.md");
    expect(first).toBe("## Demo\r\n\r\nSee [demo](#demo).\r\nEnd\r\n");
    expect(first.replace(/\r\n/g, "")).not.toContain("\n");
    expect(second).toBe(first);
  });
});

describe("REF-009 unused link reference definitions", () => {
  it("reports unused definitions as fixable warnings and ignores used ones and the comment idiom", async () => {
    const cwd = await fixtureRepo({
      "a.md": [
        "Read [the guide][Guide] and [x].",
        "",
        "[guide]: guide.md",
        "[x]: x.md",
        "[old]: old.md",
        '[//]: # "comment"',
        "",
      ].join("\n"),
    });
    const result = await lint(cwd, [rule("REF-009")]);
    expect(
      result.messages.map((message) => [
        message.ruleId,
        message.severity,
        message.line,
        message.column,
        message.fixable,
        message.data,
        message.message,
      ]),
    ).toEqual([
      [
        "REF-009",
        "warning",
        5,
        1,
        true,
        { label: "old" },
        'Reference definition "[old]" is not used by any reference link or image in this document; remove it or link to it.',
      ],
    ]);
  });

  it("honours ignoredDefinitions, which replaces the default", async () => {
    const cwd = await fixtureRepo({
      "a.md": '[keep]: k.md\n[//]: # "comment"\n',
    });
    const result = await lint(cwd, [
      rule("REF-009", { ignoredDefinitions: ["keep"] }),
    ]);
    expect(result.messages.map((message) => message.data?.label)).toEqual([
      "//",
    ]);
  });

  it("removes exactly the definition lines, then changes nothing", async () => {
    const cwd = await fixtureRepo({
      "a.md": [
        "Read [the guide][guide].",
        "",
        "[guide]: guide.md",
        "[old]: old.md",
        "[older]:",
        "  older.md",
        '  "title"',
        "",
        "Tail.",
        "",
      ].join("\n"),
    });
    const { first, second, secondFixed } = await fixTwice(
      cwd,
      [rule("REF-009")],
      "a.md",
    );
    expect(first).toBe(
      "Read [the guide][guide].\n\n[guide]: guide.md\n\nTail.\n",
    );
    expect(second).toBe(first);
    expect(secondFixed).toEqual([]);
  });

  it("removes a last definition with no trailing newline without leaving a blank line", async () => {
    const cwd = await fixtureRepo({
      "a.md": "Text [a].\n\n[a]: a.md\n[b]: b.md\n[c]: c.md",
    });
    const { first, second } = await fixTwice(cwd, [rule("REF-009")], "a.md");
    expect(first).toBe("Text [a].\n\n[a]: a.md");
    expect(second).toBe(first);
  });

  it("keeps CRLF line endings", async () => {
    const cwd = await fixtureRepo({
      "a.md": "Text [a].\r\n\r\n[a]: a.md\r\n[b]: b.md\r\nEnd\r\n",
    });
    const { first, second } = await fixTwice(cwd, [rule("REF-009")], "a.md");
    expect(first).toBe("Text [a].\r\n\r\n[a]: a.md\r\nEnd\r\n");
    expect(second).toBe(first);
  });

  it("reports but does not remove a definition inside a blockquote or list item", async () => {
    const content = "> [quoted]: q.md\n\n- [listed]: l.md\n";
    const cwd = await fixtureRepo({ "a.md": content });
    const result = await lint(cwd, [rule("REF-009")]);
    expect(
      result.messages.map((message) => [message.data?.label, message.fixable]),
    ).toEqual([
      ["quoted", undefined],
      ["listed", undefined],
    ]);
    const { first } = await fixTwice(cwd, [rule("REF-009")], "a.md");
    expect(first).toBe(content);
  });
});
