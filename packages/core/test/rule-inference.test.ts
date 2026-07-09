import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { DocCluster } from "../src/discovery/repo-scan.js";
import { scanRepository } from "../src/discovery/repo-scan.js";
import { inferRuleSet } from "../src/discovery/rule-inference.js";
import { defineRule, RuleRegistry } from "../src/engine/registry.js";
import { ruleRegistry } from "../src/engine/rules/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true }))
  );
});

async function createFixtureTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-inference-"));
  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return root;
}

// Hand-built DocCluster for tests that pin exact gate behavior independent of scanRepository.
function buildCluster(overrides: Partial<DocCluster> & { path: string; sampleFiles: string[] }): DocCluster {
  return {
    kind: "cluster",
    score: 1,
    subtreeCount: overrides.sampleFiles.length,
    includeGlob: `${overrides.path}/**/*.{md,mdx}`,
    ...overrides
  };
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
        ""
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
        ""
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
        ""
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
        ""
      ].join("\n")
    });

    const scan = await scanRepository({ cwd: root });
    const result = await inferRuleSet({ cwd: root, clusters: scan.clusters, registry: ruleRegistry });

    const globalRules = result.rules.filter((rule) => rule.options === undefined);
    expect(globalRules.map((rule) => rule.rule)).toEqual([
      "CTX-001",
      "CTX-002",
      "GRP-001",
      "REF-001",
      "REF-002",
      "TBL-002"
    ]);
    for (const rule of globalRules) {
      expect(rule.rationale.length).toBeGreaterThan(0);
      expect(rule.description.length).toBeGreaterThan(0);
    }

    const sec001 = result.rules.find((rule) => rule.rule === "SEC-001");
    expect(sec001).toMatchObject({
      // Reading order from the sampled ADRs ("## Status" then "## Context" then "## Decision"),
      // not alphabetical — SEC-001's fix scaffolds missing sections in this order.
      options: { files: ["adr/**/*.{md,mdx}"], sections: ["Status", "Context", "Decision"] }
    });

    const adrCluster = result.clusters.find((cluster) => cluster.clusterPath === "adr");
    expect(adrCluster?.patterns.adrSections).toEqual(["Status", "Context", "Decision"]);
    expect(adrCluster?.contributesTo).toContain("SEC-001");

    const docsCluster = result.clusters.find((cluster) => cluster.clusterPath === "docs");
    expect(docsCluster?.contributesTo).toEqual(
      ["CTX-001", "CTX-002", "GRP-001", "REF-001", "REF-002", "TBL-002"].sort((left, right) =>
        left.localeCompare(right)
      )
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
        ""
      ].join("\n")
    });

    const cluster = buildCluster({ path: "docs", sampleFiles: ["docs/only-tables.md"] });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

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
        ""
      ].join("\n")
    });

    const cluster = buildCluster({ path: "docs", sampleFiles: ["docs/only-checklist.md"] });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

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
        ""
      ].join("\n")
    });

    const cluster = buildCluster({ path: "docs", sampleFiles: ["docs/only-images.md"] });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

    expect(result.rules.map((rule) => rule.rule)).toEqual(["REF-003"]);
  });

  it("produces no rules when a sample has none of the detectable patterns", async () => {
    const root = await createFixtureTree({
      "docs/plain.md": ["# Plain", "", "## Overview", "", "Just prose, nothing notable.", ""].join(
        "\n"
      )
    });

    const cluster = buildCluster({ path: "docs", sampleFiles: ["docs/plain.md"] });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

    expect(result.rules).toEqual([]);
    expect(result.clusters[0]?.contributesTo).toEqual([]);
  });
});

describe("inferRuleSet · ADR detection", () => {
  it("does not propose SEC-001 for generic headings that are not an ADR triplet", async () => {
    const root = await createFixtureTree({
      "notes/a.md": ["# A", "", "## Overview", "", "Some content.", "", "## Summary", "", "Wrap up.", ""].join(
        "\n"
      ),
      "notes/b.md": ["# B", "", "## Overview", "", "Other content.", "", "## Summary", "", "Wrap up.", ""].join(
        "\n"
      )
    });

    const cluster = buildCluster({ path: "notes", sampleFiles: ["notes/a.md", "notes/b.md"] });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

    expect(result.clusters[0]?.patterns.adrSections).toEqual([]);
    expect(result.rules.some((rule) => rule.rule === "SEC-001")).toBe(false);
  });

  it("excludes a section whose casing differs across samples from the exact-string intersection", async () => {
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
        ""
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
        ""
      ].join("\n")
    });

    const cluster = buildCluster({ path: "adr", sampleFiles: ["adr/0001.md", "adr/0002.md"] });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

    const adrSections = result.clusters[0]?.patterns.adrSections ?? [];
    expect(adrSections).not.toContain("Status");
    expect(adrSections).not.toContain("STATUS");
    expect(adrSections).toEqual(["Context", "Decision"]);

    const sec001 = result.rules.find((rule) => rule.rule === "SEC-001");
    expect(sec001?.options).toEqual({ files: [cluster.includeGlob], sections: ["Context", "Decision"] });
  });

  it("does not propose SEC-001 when the cluster's includeGlob does not match its own .mdx samples", async () => {
    // Mirrors the accepted P6.01 fallback shape: scanRepository's global fallback cluster uses
    // the literal glob "**/*.md" even when its sampled files are .mdx (deliberately not
    // .mdx-aware, so it matches the tool's real zero-config default). Proposing SEC-001 scoped to
    // that glob would be a dead rule — valid config that checks none of the files that justified it.
    const root = await createFixtureTree({
      "adr/0001.mdx": [
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
        ""
      ].join("\n"),
      "adr/0002.mdx": [
        "# ADR 2",
        "",
        "## Status",
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
        ""
      ].join("\n")
    });

    const cluster = buildCluster({
      path: "",
      kind: "fallback",
      includeGlob: "**/*.md",
      sampleFiles: ["adr/0001.mdx", "adr/0002.mdx"]
    });

    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

    // The ADR evidence is still detected from the sampled content...
    expect(result.clusters[0]?.patterns.adrSections).toEqual(["Status", "Context", "Decision"]);
    // ...but SEC-001 must not be proposed: "**/*.md" does not match either sampled .mdx file.
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
        ""
      ].join("\n")
    });

    // Trimmed registry (registry.test.ts style): a real rule can be renamed or removed without
    // inferRuleSet crashing or emitting a dangling id — every gate id is a lookup key, not a
    // standalone hardcoded metadata object.
    const trimmedRegistry = new RuleRegistry(
      ["REF-001", "REF-002", "REF-003", "TBL-002", "CTX-001", "GRP-001"].map((id) =>
        defineRule({
          metadata: {
            id,
            category: id.split("-")[0] as "REF" | "TBL" | "CTX" | "GRP",
            description: `${id} description`,
            defaultSeverity: "warning",
            scope: "document",
            fixable: false
          },
          optionsSchema: z.object({}).strict(),
          check: () => () => {}
        })
      )
    );

    const cluster = buildCluster({ path: "adr", sampleFiles: ["adr/0001.md"] });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: trimmedRegistry });

    const ruleIds = result.rules.map((rule) => rule.rule);
    expect(ruleIds).not.toContain("CTX-002");
    expect(ruleIds).not.toContain("SEC-001");
    expect(result.clusters[0]?.contributesTo).not.toContain("CTX-002");
    expect(result.clusters[0]?.contributesTo).not.toContain("SEC-001");
  });
});

describe("inferRuleSet · unreadable sample file", () => {
  it("skips a sample path that no longer exists on disk without throwing", async () => {
    const root = await createFixtureTree({
      "docs/exists.md": [
        "# Exists",
        "",
        "## Data",
        "",
        "| Name | Value |",
        "| --- | --- |",
        "| a | b |",
        ""
      ].join("\n")
    });

    const cluster = buildCluster({
      path: "docs",
      sampleFiles: ["docs/exists.md", "docs/missing.md"]
    });

    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

    expect(result.clusters[0]?.sampledFiles).toEqual(["docs/exists.md"]);
    expect(result.rules.map((rule) => rule.rule)).toEqual(["TBL-002"]);
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
        ""
      ].join("\n"),
      "docs/b.md": "# B\n\nSee [A](a.md).\n"
    });

    const scan = await scanRepository({ cwd: root });
    const first = await inferRuleSet({ cwd: root, clusters: scan.clusters, registry: ruleRegistry });
    const second = await inferRuleSet({ cwd: root, clusters: scan.clusters, registry: ruleRegistry });

    expect(first).toEqual(second);
    const ids = first.rules.map((rule) => rule.rule);
    expect(ids).toEqual([...ids].sort((left, right) => left.localeCompare(right)));
  });
});

describe("inferRuleSet · cross-cluster cycle heuristic", () => {
  it("surfaces a concrete file pair in the GRP-001 rationale when two clusters reference each other", async () => {
    const root = await createFixtureTree({
      "docs/a.md": "# A\n\nSee [B](../other/b.md).\n",
      "other/b.md": "# B\n\nSee [A](../docs/a.md).\n"
    });

    const docsCluster = buildCluster({ path: "docs", sampleFiles: ["docs/a.md"] });
    const otherCluster = buildCluster({ path: "other", sampleFiles: ["other/b.md"] });

    const result = await inferRuleSet({
      cwd: root,
      clusters: [docsCluster, otherCluster],
      registry: ruleRegistry
    });

    const grp001 = result.rules.find((rule) => rule.rule === "GRP-001");
    expect(grp001).toBeDefined();
    expect(grp001?.rationale).toContain("docs/a.md");
    expect(grp001?.rationale).toContain("other/b.md");
  });

  it("resolves a root-relative link the same way the shared reference pipeline does", async () => {
    // Root-relative targets resolve from the repo root, not from the source file's directory —
    // resolveRelativeToSource alone would have misresolved "/other/b.md" against "docs/a.md" as
    // "docs/other/b.md", missing the real sample at "other/b.md" entirely.
    const root = await createFixtureTree({
      "docs/a.md": "# A\n\nSee [B](/other/b.md).\n",
      "other/b.md": "# B\n\nSee [A](/docs/a.md).\n"
    });

    const docsCluster = buildCluster({ path: "docs", sampleFiles: ["docs/a.md"] });
    const otherCluster = buildCluster({ path: "other", sampleFiles: ["other/b.md"] });

    const result = await inferRuleSet({
      cwd: root,
      clusters: [docsCluster, otherCluster],
      registry: ruleRegistry
    });

    const grp001 = result.rules.find((rule) => rule.rule === "GRP-001");
    expect(grp001).toBeDefined();
    expect(grp001?.rationale).toContain("docs/a.md");
    expect(grp001?.rationale).toContain("other/b.md");
  });

  it("does not treat a broken anchor as a graph edge when checking for a sample cycle", async () => {
    // b.md's only heading ("# B") slugs to "b", not "missing-heading" — REF-002's evidence, not a
    // real edge back to a.md, so no sampled cycle should be found at all.
    const root = await createFixtureTree({
      "docs/a.md": "# A\n\nSee [B](b.md#missing-heading).\n",
      "docs/b.md": "# B\n\nSee [A](a.md).\n"
    });

    const cluster = buildCluster({ path: "docs", sampleFiles: ["docs/a.md", "docs/b.md"] });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

    const grp001 = result.rules.find((rule) => rule.rule === "GRP-001");
    expect(grp001).toBeDefined();
    expect(grp001?.rationale).not.toContain("loops back on itself");
    expect(grp001?.rationale).toContain("forming a reference graph");
  });

  it("describes the full sampled chain, not just the closing back-edge, for a 3-node cycle", async () => {
    // The back-edge alone is c.md -> a.md; wording must not claim those two endpoints mutually
    // reference each other, since only a -> b and c -> a actually exist as sampled links.
    const root = await createFixtureTree({
      "docs/a.md": "# A\n\nSee [B](b.md).\n",
      "docs/b.md": "# B\n\nSee [C](c.md).\n",
      "docs/c.md": "# C\n\nSee [A](a.md).\n"
    });

    const cluster = buildCluster({
      path: "docs",
      sampleFiles: ["docs/a.md", "docs/b.md", "docs/c.md"]
    });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

    const grp001 = result.rules.find((rule) => rule.rule === "GRP-001");
    expect(grp001).toBeDefined();
    expect(grp001?.rationale).toContain("docs/a.md");
    expect(grp001?.rationale).toContain("docs/b.md");
    expect(grp001?.rationale).toContain("docs/c.md");
    expect(grp001?.rationale).not.toContain("reference each other");
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
        ""
      ].join("\n")
    });

    const cluster = buildCluster({ path: "docs", sampleFiles: ["docs/external-images.md"] });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

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
        ""
      ].join("\n")
    });

    const cluster = buildCluster({ path: "docs", sampleFiles: ["docs/empty-link.md"] });
    const result = await inferRuleSet({ cwd: root, clusters: [cluster], registry: ruleRegistry });

    expect(result.clusters[0]?.patterns.localLinkCount).toBe(0);
    expect(result.rules).toEqual([]);
  });
});
