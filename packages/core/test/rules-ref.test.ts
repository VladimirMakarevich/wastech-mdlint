import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ConfiguredRule } from "../src/config/load-config.js";
import { compareStrings } from "../src/deterministic-sort.js";
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

// The REF half of the shared `exclude` matrix. REF-002 is the only REF rule that mixes in
// the shared file-scope shape; REF-001/REF-003 spell `exclude` too but mean something else, which is
// pinned separately below.
describe("REF-002 file scope (exclude)", () => {
  const ANCHOR_DOC = "## Intro\n\n[bad](#nope)\n";

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
      "docs/a.md": ANCHOR_DOC,
      "drafts/b.md": ANCHOR_DOC,
    });

    expect(await reportedFiles(cwd, rule("REF-002"))).toEqual([
      "docs/a.md",
      "drafts/b.md",
    ]);
    // The unscoped shape — `exclude` with no `files` beside it to carry the filtering.
    expect(
      await reportedFiles(cwd, rule("REF-002", { exclude: ["drafts/**"] })),
    ).toEqual(["docs/a.md"]);
    expect(
      await reportedFiles(
        cwd,
        rule("REF-002", { files: ["**/*.md"], exclude: ["drafts/**"] }),
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

  // Every REF rule except REF-002 is whole-corpus or identity-based by design, so `files` is not a
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

  it("accepts `files` and `exclude` on REF-002, the one file-scoped REF rule", () => {
    expect(
      ruleRegistry.resolveRule("REF-002", {
        files: ["docs/**"],
        exclude: ["docs/drafts/**"],
      }).id,
    ).toBe("REF-002");
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
