import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { DocCluster } from "../src/discovery/repo-scan.js";
import { scanRepository } from "../src/discovery/repo-scan.js";
import {
  inferRuleSet,
  type InferenceScope,
  type RuleInferenceResult,
} from "../src/discovery/rule-inference.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { defineRule, RuleRegistry } from "../src/engine/registry.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

async function createFixtureTree(
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "wastech-mdlint-inference-"),
  );
  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return root;
}

// Hand-built DocCluster for tests that pin exact gate behavior independent of scanRepository.
//
// `sampleFiles` defaults to empty and every test below leaves it that way, which is the point:
// inference reads the corpus its scope selects and never this list. The field stays on the type
// because the scan still reports it for the confirmation prompt, and a test that fed it here would
// pass while proving nothing about what a config measures.
function buildCluster(
  overrides: Partial<DocCluster> & { path: string },
): DocCluster {
  return {
    kind: "cluster",
    score: 1,
    subtreeCount: 1,
    includeGlob: `${overrides.path}/**/*.{md,mdx}`,
    sampleFiles: [],
    ...overrides,
  };
}

// The scope a fresh `init` writes for these clusters. Passing it — rather than letting the call
// default to something — is what makes these tests measure the corpus the drafted config lints.
function scopeFor(clusters: DocCluster[]): InferenceScope {
  return { include: clusters.map((cluster) => cluster.includeGlob) };
}

function infer(
  root: string,
  clusters: DocCluster[],
  registry = ruleRegistry,
): Promise<RuleInferenceResult> {
  return inferRuleSet({
    cwd: root,
    clusters,
    registry,
    scope: scopeFor(clusters),
  });
}

describe("inferRuleSet · end to end", () => {
  it("proposes global rules from cross-linked docs plus a cluster-scoped SEC-001 from ADR sections", async () => {
    const root = await createFixtureTree({
      "docs/a.md": [
        "# A",
        "",
        "See [B](b.md) and an [anchored link](b.md#some-heading).",
        "",
        "## Overview",
        "",
        "Real content describing the project.",
        "",
        "| Name | Status |",
        "| --- | --- |",
        "| Widget | Done |",
        "",
        "## Tasks",
        "",
        "- [ ] write tests",
        "- [x] write code",
        "",
      ].join("\n"),
      "docs/b.md": [
        "# B",
        "",
        "Back to [A](a.md).",
        "",
        "## Some Heading",
        "",
        "More real content.",
        "",
        "## Notes",
        "",
        "TBD",
        "",
      ].join("\n"),
      "adr/0001-use-typescript.md": [
        "# ADR 0001: Use TypeScript",
        "",
        "## Status",
        "",
        "Accepted",
        "",
        "## Context",
        "",
        "We need a language.",
        "",
        "## Decision",
        "",
        "Use TypeScript.",
        "",
      ].join("\n"),
      "adr/0002-use-vitest.md": [
        "# ADR 0002: Use Vitest",
        "",
        "## Status",
        "",
        "Accepted",
        "",
        "## Context",
        "",
        "We need a test runner.",
        "",
        "## Decision",
        "",
        "Use Vitest.",
        "",
      ].join("\n"),
    });

    const scan = await scanRepository({ cwd: root });
    const result = await infer(root, scan.clusters);

    // "Global" is about the *evidence*, not about carrying no options: every rule here but SEC-001
    // is proposed from corpus-wide patterns, while SEC-001 is scoped to the cluster that earned it.
    const globalRules = result.rules.filter((rule) => rule.rule !== "SEC-001");
    expect(globalRules.map((rule) => rule.rule)).toEqual([
      "CTX-001",
      "CTX-002",
      "GRP-001",
      "REF-001",
      "REF-002",
      "TBL-002",
    ]);
    // The cycle in this corpus is `docs/a.md -> docs/b.md -> docs/a.md`, two documents — below
    // GRP-001's floor of 3. The entry must not carry an option lowering that floor: the floor is
    // there because an index and a member linking each other is an ordinary shape, and a config that
    // reinstates it at `error` hands a new adopter a failing build for writing documentation
    // normally. The rationale names the cycle and says it will not be reported instead.
    const grp001 = globalRules.find((rule) => rule.rule === "GRP-001");
    expect(grp001?.options).toBeUndefined();
    expect(grp001?.rationale).toContain("will NOT report");
    expect(grp001?.rationale).toContain("docs/a.md -> docs/b.md -> docs/a.md");

    for (const rule of globalRules) {
      expect(rule.rationale.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
    }

    // One unchecked box and one TBD section are real findings over this corpus, so those two rules
    // are written disabled; everything else reports nothing and is enabled.
    expect(
      Object.fromEntries(
        result.rules.map((rule) => [rule.rule, rule.severity]),
      ),
    ).toEqual({
      "CTX-001": "off",
      "CTX-002": "off",
      "GRP-001": undefined,
      "REF-001": undefined,
      "REF-002": undefined,
      "SEC-001": undefined,
      "TBL-002": undefined,
    });

    const sec001 = result.rules.find((rule) => rule.rule === "SEC-001");
    expect(sec001).toMatchObject({
      // Reading order from the ADRs ("## Status" then "## Context" then "## Decision"),
      // not alphabetical — SEC-001's fix scaffolds missing sections in this order.
      options: {
        files: ["adr/**/*.{md,mdx}"],
        sections: ["Status", "Context", "Decision"],
      },
    });

    const adrCluster = result.clusters.find(
      (cluster) => cluster.clusterPath === "adr",
    );
    expect(adrCluster?.patterns.adrSections).toEqual([
      "Status",
      "Context",
      "Decision",
    ]);
    expect(adrCluster?.contributesTo).toContain("SEC-001");

    const docsCluster = result.clusters.find(
      (cluster) => cluster.clusterPath === "docs",
    );
    expect(docsCluster?.contributesTo).toEqual(
      ["CTX-001", "CTX-002", "GRP-001", "REF-001", "REF-002", "TBL-002"].sort(
        compareStrings,
      ),
    );
    expect(result.corpusFileCount).toBe(4);
  });
});

describe("inferRuleSet · severity policy", () => {
  // The defect this pins: a rationale measured on three-to-five sampled files decided a rule that
  // then ran over everything. A document holding forty unchecked boxes sorts last here, so a
  // five-file sample never reaches it — the proposal has to come from the corpus or not at all.
  it("counts a checklist volume no sample would reach, and writes the rule off rather than red", async () => {
    const filler = Object.fromEntries(
      ["a", "b", "c", "d", "e"].map((name) => [
        `docs/${name}.md`,
        `# ${name.toUpperCase()}\n\n## Overview\n\nOrdinary prose, no checklists.\n`,
      ]),
    );
    const boxes = Array.from(
      { length: 40 },
      (_unused, index) => `- [ ] task ${index + 1}`,
    ).join("\n");
    const root = await createFixtureTree({
      ...filler,
      "docs/z-checklist.md": `# Checklist\n\n## Tasks\n\n${boxes}\n`,
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    const ctx002 = result.rules.find((rule) => rule.rule === "CTX-002");
    expect(ctx002).toBeDefined();
    expect(ctx002?.severity).toBe("off");
    expect(ctx002?.rationale).toContain("40 checklist item(s)");
    expect(ctx002?.rationale).toContain("40 finding(s)");
    expect(ctx002?.rationale).toContain("6 file(s) this config lints");
  });

  it("enables a rule the corpus already satisfies, with no severity key at all", async () => {
    const root = await createFixtureTree({
      "docs/a.md": [
        "# A",
        "",
        "## Tasks",
        "",
        "- [x] done",
        "- [x] also done",
        "",
      ].join("\n"),
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    const ctx002 = result.rules.find((rule) => rule.rule === "CTX-002");
    expect(ctx002).toBeDefined();
    // Absent rather than `"error"`/`"warning"`: an entry that restates the registry default is a key
    // a later reader has to prove is inert, and the written file stays scannable without it.
    expect(ctx002?.severity).toBeUndefined();
    expect(ctx002?.rationale).toContain(
      "It reports nothing over the 1 file(s)",
    );
  });
});

describe("inferRuleSet · per-pattern isolation", () => {
  it("gates TBL-002 on table presence alone", async () => {
    const root = await createFixtureTree({
      "docs/only-tables.md": [
        "# Only tables",
        "",
        "## Data",
        "",
        "| Name | Value |",
        "| --- | --- |",
        "| a | b |",
        "",
      ].join("\n"),
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    expect(result.rules.map((rule) => rule.rule)).toEqual(["TBL-002"]);
  });

  it("gates CTX-002 on checklist presence alone", async () => {
    const root = await createFixtureTree({
      "docs/only-checklist.md": [
        "# Only checklist",
        "",
        "## Tasks",
        "",
        "- [ ] one",
        "- [x] two",
        "",
      ].join("\n"),
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    expect(result.rules.map((rule) => rule.rule)).toEqual(["CTX-002"]);
  });

  it("gates REF-003 on image presence without any local links", async () => {
    const root = await createFixtureTree({
      "docs/only-images.md": [
        "# Only images",
        "",
        "## Overview",
        "",
        "Real content with a picture.",
        "",
        "![diagram](diagram.png)",
        "",
      ].join("\n"),
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    expect(result.rules.map((rule) => rule.rule)).toEqual(["REF-003"]);
  });

  it("produces no rules when the corpus has none of the detectable patterns", async () => {
    const root = await createFixtureTree({
      "docs/plain.md": [
        "# Plain",
        "",
        "## Overview",
        "",
        "Just prose, nothing notable.",
        "",
      ].join("\n"),
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    expect(result.rules).toEqual([]);
    expect(result.clusters[0]?.contributesTo).toEqual([]);
  });
});

describe("inferRuleSet · corpus scope decides the evidence", () => {
  // The property that makes a merge safe: a rule can only be justified by files the config being
  // written will read. Here the images and tables live outside the scope, so neither REF-003 nor
  // TBL-002 has any evidence at all — not evidence that is later filtered out.
  it("ignores files outside the scope entirely, however the clusters were drawn", async () => {
    const root = await createFixtureTree({
      "docs/a.md": "# A\n\n## Overview\n\nProse with a [link](b.md).\n",
      "docs/b.md": "# B\n\n## Overview\n\nMore prose.\n",
      "assets/gallery.md": [
        "# Gallery",
        "",
        "## Pictures",
        "",
        "![diagram](diagram.png)",
        "",
        "| Name | Value |",
        "| --- | --- |",
        "| a | b |",
        "",
      ].join("\n"),
    });

    const result = await inferRuleSet({
      cwd: root,
      clusters: [
        buildCluster({ path: "docs" }),
        buildCluster({ path: "assets" }),
      ],
      registry: ruleRegistry,
      scope: { include: ["docs/**/*.md"] },
    });

    expect(result.rules.map((rule) => rule.rule)).toEqual([
      "GRP-001",
      "REF-001",
    ]);
    expect(result.corpusFileCount).toBe(2);
    // The out-of-scope cluster is still reported, with an empty file list — the confirmation prompt
    // needs to show it was considered, and an empty list is how it shows nothing backed it.
    const assets = result.clusters.find(
      (cluster) => cluster.clusterPath === "assets",
    );
    expect(assets?.files).toEqual([]);
    expect(assets?.contributesTo).toEqual([]);
  });

  it("reports each cluster's own corpus files as the evidence it was measured on", async () => {
    const root = await createFixtureTree({
      "docs/a.md": "# A\n\n## Overview\n\nProse.\n",
      "docs/nested/b.md": "# B\n\n## Overview\n\nProse.\n",
      "other/c.md": "# C\n\n## Overview\n\nProse.\n",
    });

    const clusters = [
      buildCluster({ path: "docs" }),
      buildCluster({ path: "other" }),
    ];
    const result = await infer(root, clusters);

    expect(result.clusters[0]?.files).toEqual([
      "docs/a.md",
      "docs/nested/b.md",
    ]);
    expect(result.clusters[1]?.files).toEqual(["other/c.md"]);
  });
});

describe("inferRuleSet · ADR detection", () => {
  it("does not propose SEC-001 for generic headings that are not an ADR triplet", async () => {
    const root = await createFixtureTree({
      "notes/a.md": [
        "# A",
        "",
        "## Overview",
        "",
        "Some content.",
        "",
        "## Summary",
        "",
        "Wrap up.",
        "",
      ].join("\n"),
      "notes/b.md": [
        "# B",
        "",
        "## Overview",
        "",
        "Other content.",
        "",
        "## Summary",
        "",
        "Wrap up.",
        "",
      ].join("\n"),
    });

    const result = await infer(root, [buildCluster({ path: "notes" })]);

    expect(result.clusters[0]?.patterns.adrSections).toEqual([]);
    expect(result.rules.some((rule) => rule.rule === "SEC-001")).toBe(false);
  });

  it("excludes a section whose casing differs across documents from the exact-string intersection", async () => {
    const root = await createFixtureTree({
      "adr/0001.md": [
        "# ADR 1",
        "",
        "## Status",
        "",
        "Accepted",
        "",
        "## Context",
        "",
        "Some context.",
        "",
        "## Decision",
        "",
        "Some decision.",
        "",
      ].join("\n"),
      "adr/0002.md": [
        "# ADR 2",
        "",
        "## STATUS",
        "",
        "Accepted",
        "",
        "## Context",
        "",
        "Other context.",
        "",
        "## Decision",
        "",
        "Other decision.",
        "",
      ].join("\n"),
    });

    const cluster = buildCluster({ path: "adr" });
    const result = await infer(root, [cluster]);

    const adrSections = result.clusters[0]?.patterns.adrSections ?? [];
    expect(adrSections).not.toContain("Status");
    expect(adrSections).not.toContain("STATUS");
    expect(adrSections).toEqual(["Context", "Decision"]);

    const sec001 = result.rules.find((rule) => rule.rule === "SEC-001");
    expect(sec001?.options).toEqual({
      files: [cluster.includeGlob],
      sections: ["Context", "Decision"],
    });
  });

  it("finds no ADR evidence in .mdx files a `**/*.md` scope does not select", async () => {
    // The scan's global fallback cluster uses the literal glob "**/*.md" even where the directory
    // holds .mdx files, mirroring the tool's real zero-config default rather than the scan's own
    // discovery criteria. SEC-001 scoped to that glob would be a dead rule — valid config checking
    // none of the files that justified it. Measuring the corpus that glob selects makes that
    // unreachable rather than guarded against: the .mdx files are never read, so they cannot
    // contribute evidence in the first place.
    const adrBody = [
      "## Status",
      "",
      "Accepted",
      "",
      "## Context",
      "",
      "Some context.",
      "",
      "## Decision",
      "",
      "Some decision.",
      "",
    ].join("\n");
    const root = await createFixtureTree({
      "adr/0001.mdx": `# ADR 1\n\n${adrBody}`,
      "adr/0002.mdx": `# ADR 2\n\n${adrBody}`,
    });

    const cluster = buildCluster({
      path: "",
      kind: "fallback",
      includeGlob: "**/*.md",
    });
    const result = await infer(root, [cluster]);

    expect(result.corpusFileCount).toBe(0);
    expect(result.clusters[0]?.patterns.adrSections).toEqual([]);
    expect(result.rules.some((rule) => rule.rule === "SEC-001")).toBe(false);
    expect(result.clusters[0]?.contributesTo).not.toContain("SEC-001");
  });
});

describe("inferRuleSet · registry drift safety", () => {
  it("omits ids missing from the registry instead of throwing", async () => {
    const root = await createFixtureTree({
      "adr/0001.md": [
        "# ADR 1",
        "",
        "## Status",
        "",
        "Accepted",
        "",
        "## Context",
        "",
        "Some context.",
        "",
        "## Decision",
        "",
        "Some decision.",
        "",
        "## Tasks",
        "",
        "- [ ] follow up",
        "",
      ].join("\n"),
    });

    // Trimmed registry (registry.test.ts style): a real rule can be renamed or removed without
    // inferRuleSet crashing or emitting a dangling id — every gate id is a lookup key, not a
    // standalone hardcoded metadata object.
    const trimmedRegistry = new RuleRegistry(
      ["REF-001", "REF-002", "REF-003", "TBL-002", "CTX-001", "GRP-001"].map(
        (id) =>
          defineRule({
            metadata: {
              id,
              category: id.split("-")[0] as "REF" | "TBL" | "CTX" | "GRP",
              description: `${id} description`,
              defaultSeverity: "warning",
              scope: "document",
              fixable: false,
            },
            optionsSchema: z.object({}).strict(),
            check: () => () => {},
          }),
      ),
    );

    const result = await infer(
      root,
      [buildCluster({ path: "adr" })],
      trimmedRegistry,
    );

    const ruleIds = result.rules.map((rule) => rule.rule);
    expect(ruleIds).not.toContain("CTX-002");
    expect(ruleIds).not.toContain("SEC-001");
    expect(result.clusters[0]?.contributesTo).not.toContain("CTX-002");
    expect(result.clusters[0]?.contributesTo).not.toContain("SEC-001");
  });
});

describe("inferRuleSet · determinism", () => {
  it("is deterministic across repeated calls and sorts rules by id", async () => {
    const root = await createFixtureTree({
      "docs/a.md": [
        "# A",
        "",
        "See [B](b.md).",
        "",
        "## Notes",
        "",
        "TODO",
        "",
        "| Name | Value |",
        "| --- | --- |",
        "| a | b |",
        "",
        "- [ ] task",
        "",
      ].join("\n"),
      "docs/b.md": "# B\n\nSee [A](a.md).\n",
    });

    const scan = await scanRepository({ cwd: root });
    const first = await infer(root, scan.clusters);
    const second = await infer(root, scan.clusters);

    expect(first).toEqual(second);
    const ids = first.rules.map((rule) => rule.rule);
    expect(ids).toEqual([...ids].sort(compareStrings));
  });
});

describe("inferRuleSet · the cycle a GRP-001 rationale cites", () => {
  it("names a concrete file pair when two clusters reference each other", async () => {
    const root = await createFixtureTree({
      "docs/a.md": "# A\n\nSee [B](../other/b.md).\n",
      "other/b.md": "# B\n\nSee [A](../docs/a.md).\n",
    });

    const result = await infer(root, [
      buildCluster({ path: "docs" }),
      buildCluster({ path: "other" }),
    ]);

    const grp001 = result.rules.find((rule) => rule.rule === "GRP-001");
    expect(grp001).toBeDefined();
    expect(grp001?.rationale).toContain("docs/a.md");
    expect(grp001?.rationale).toContain("other/b.md");
  });

  it("resolves a root-relative link the same way the shared reference pipeline does", async () => {
    // Root-relative targets resolve from the repo root, not from the source file's directory —
    // resolving against "docs/a.md" instead would misread "/other/b.md" as "docs/other/b.md" and
    // miss the real document at "other/b.md" entirely.
    const root = await createFixtureTree({
      "docs/a.md": "# A\n\nSee [B](/other/b.md).\n",
      "other/b.md": "# B\n\nSee [A](/docs/a.md).\n",
    });

    const result = await infer(root, [
      buildCluster({ path: "docs" }),
      buildCluster({ path: "other" }),
    ]);

    const grp001 = result.rules.find((rule) => rule.rule === "GRP-001");
    expect(grp001).toBeDefined();
    expect(grp001?.rationale).toContain("docs/a.md");
    expect(grp001?.rationale).toContain("other/b.md");
  });

  it("does not treat a broken anchor as a graph edge", async () => {
    // b.md's only heading ("# B") slugs to "b", not "missing-heading" — REF-002's evidence, not a
    // real edge back to a.md, so there is no cycle here at all.
    const root = await createFixtureTree({
      "docs/a.md": "# A\n\nSee [B](b.md#missing-heading).\n",
      "docs/b.md": "# B\n\nSee [A](a.md).\n",
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    const grp001 = result.rules.find((rule) => rule.rule === "GRP-001");
    expect(grp001).toBeDefined();
    expect(grp001?.rationale).not.toContain("loops back on itself");
    expect(grp001?.rationale).toContain("no cycles in it today");
  });

  it("cites a two-document loop and states that the proposed config will not report it", async () => {
    const root = await createFixtureTree({
      "docs/index.md": "# Index\n\nSee [member](member.md).\n",
      "docs/member.md": "# Member\n\nBack to the [index](index.md).\n",
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    const grp001 = result.rules.find((rule) => rule.rule === "GRP-001");
    expect(grp001).toBeDefined();
    // Both halves matter. Dropping the citation would hide a real loop the user can see; dropping
    // the caveat would annotate the entry with a finding the config it sits in never produces.
    expect(grp001?.rationale).toContain(
      "docs/index.md -> docs/member.md -> docs/index.md",
    );
    expect(grp001?.rationale).toContain("will NOT report");
    expect(grp001?.rationale).toContain("3 or more documents");
    expect(grp001?.options).toBeUndefined();
    // No finding, so the entry is enabled: the loop is below the floor and nothing else is wrong.
    expect(grp001?.severity).toBeUndefined();
  });

  it("describes the full chain, not just the closing back-edge, for a 3-node cycle", async () => {
    // The back-edge alone is c.md -> a.md; wording must not claim those two endpoints mutually
    // reference each other, since only a -> b and c -> a actually exist as links.
    const root = await createFixtureTree({
      "docs/a.md": "# A\n\nSee [B](b.md).\n",
      "docs/b.md": "# B\n\nSee [C](c.md).\n",
      "docs/c.md": "# C\n\nSee [A](a.md).\n",
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    const grp001 = result.rules.find((rule) => rule.rule === "GRP-001");
    expect(grp001).toBeDefined();
    expect(grp001?.rationale).toContain("docs/a.md");
    expect(grp001?.rationale).toContain("docs/b.md");
    expect(grp001?.rationale).toContain("docs/c.md");
    expect(grp001?.rationale).not.toContain("reference each other");
    expect(grp001?.rationale).not.toContain("will NOT report");
    expect(grp001?.options).toBeUndefined();
    // Three documents is the rule's own floor, so this cycle *is* reported — which is exactly why
    // the entry is written disabled rather than failing the first run.
    expect(grp001?.severity).toBe("off");
  });
});

describe("inferRuleSet · gate evidence matches what the rule evaluates", () => {
  it("does not count an external or data image target towards REF-003", async () => {
    const root = await createFixtureTree({
      "docs/external-images.md": [
        "# External images",
        "",
        "## Overview",
        "",
        "Real content with pictures.",
        "",
        "![remote](https://example.com/pic.png)",
        "![inline](data:image/png;base64,AAAA)",
        "",
      ].join("\n"),
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    expect(result.clusters[0]?.patterns.imageCount).toBe(0);
    expect(result.rules).toEqual([]);
  });

  it("does not count an empty local link target towards REF-001/GRP-001", async () => {
    const root = await createFixtureTree({
      "docs/empty-link.md": [
        "# Empty link",
        "",
        "## Overview",
        "",
        "Real content mentioning [an empty link]().",
        "",
      ].join("\n"),
    });

    const result = await infer(root, [buildCluster({ path: "docs" })]);

    expect(result.clusters[0]?.patterns.localLinkCount).toBe(0);
    expect(result.rules).toEqual([]);
  });
});
