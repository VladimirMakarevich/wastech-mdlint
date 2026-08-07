import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lintContent } from "../src/engine/lint-content.js";
import { lintFiles } from "../src/engine/lint-files.js";
import { ruleRegistry } from "../src/engine/rules/index.js";
import type { ResolvedRule } from "../src/engine/types.js";

// W-58 (P16.01). `lintContent` exists so the ad-hoc lint path reaches the same steps in the same
// order as `lintFiles` — the MCP `lint` tool used to assemble that sequence itself, and nothing
// failed when the two disagreed. This suite is the differential: the same bytes through both entry
// points must produce the same `LintResult`.
//
// Written against **shipped** rules rather than a local fixture registry (the way
// `lint-files.test.ts` does) on purpose: the steps that could diverge are the scope split, the
// per-file suppression pass and the attribution of a project rule's findings, and only real rules of
// each kind exercise all three.

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

// One synthetic path for both sides, so a `filePath` difference can only come from the pipeline.
const AD_HOC_PATH = "content.md";

// Chosen to put one finding through each step that differs between the two paths:
//   - REF-001 is document-scope and resolves its target against `rootDir` on disk (the reason both
//     sides are given the same root).
//   - TBL-006 is project-scope: it runs once over the corpus and self-attributes every finding,
//     which is what makes running it without a `document`/`filePath` in context correct.
//   - SIZE-001 reports a whole-file finding at line 0, the case that sorts and renders differently.
//   - The `disable-next-line` directive proves the suppression pass runs on this path too, and it
//     covers the *second* REF-001 link so an unsuppressed one still reports (a total of zero would
//     also "match" if suppression swallowed everything).
const CONTENT = [
  "# Title",
  "",
  "[reported](missing-one.md)",
  "",
  "<!-- wastech-mdlint-disable-next-line REF-001 -->",
  "[suppressed](missing-two.md)",
  "",
  "| ID | Owner |",
  "| --- | --- |",
  "| REQ-1 | Ann |",
  "| REQ-1 | Bob |",
  "",
].join("\n");

function rules(): ResolvedRule[] {
  return [
    { rule: ruleRegistry.resolveRule("REF-001", {}) },
    { rule: ruleRegistry.resolveRule("TBL-006", { column: "ID" }) },
    { rule: ruleRegistry.resolveRule("SIZE-001", { lines: { error: 1 } }) },
  ];
}

async function corpusOfOne(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-adhoc-"));
  tempDirs.push(root);
  await writeFile(path.join(root, AD_HOC_PATH), CONTENT, "utf8");
  return root;
}

describe("lintContent agrees with lintFiles on the same document", () => {
  it("produces the identical LintResult for a one-document corpus", async () => {
    const root = await corpusOfOne();

    const viaFiles = await lintFiles({
      cwd: root,
      config: { include: [AD_HOC_PATH], rules: [] },
      // `lintFiles` takes config-shaped entries; the severity field is the same `undefined` either
      // way, so the two rule lists are the same rules with the same overrides.
      rules: rules().map((entry) => ({ rule: entry.rule })),
      settings: {},
    });

    const viaContent = lintContent({
      path: AD_HOC_PATH,
      content: CONTENT,
      rules: rules(),
      // The same root, so REF-001's on-disk fallback answers identically on both sides. Without this
      // the comparison would silently be about two different filesystems.
      rootDir: root,
    });

    // The whole record, not just `messages`: `files`, `errorCount` and `warningCount` are steps of
    // the same sequence and are exactly what a host would otherwise recompute for itself.
    expect(viaContent).toEqual(viaFiles);

    // Non-vacuous in both directions — each rule fired, and the suppressed link did not.
    expect(viaContent.messages.map((message) => message.ruleId).sort()).toEqual(
      ["REF-001", "SIZE-001", "TBL-006"],
    );
    expect(
      viaContent.messages.filter((message) =>
        message.message.includes("missing-two.md"),
      ),
    ).toEqual([]);
    expect(viaContent.files).toEqual([AD_HOC_PATH]);
  });

  it("attributes a project rule's finding without a document in context", () => {
    // The one behavior the extraction changed: `handleLint` used to hand every rule a `document` and
    // `filePath`, so a project rule that forgot to attribute a finding would have inherited the
    // ad-hoc path. Under the shared pipeline it inherits `""` instead — which is why every shipped
    // project rule self-attributes, and why that is worth pinning at this entry point rather than
    // only at `lintFiles`, where a real corpus makes the fallback look harmless.
    const result = lintContent({
      path: AD_HOC_PATH,
      content: CONTENT,
      rules: [{ rule: ruleRegistry.resolveRule("TBL-006", { column: "ID" }) }],
      rootDir: process.cwd(),
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.filePath).toBe(AD_HOC_PATH);
  });

  it("runs a graph-aware rule as a no-op rather than throwing without a graph", () => {
    // `lintContent` builds no `ContextGraph` (documented on the entry point). GRP-001 must degrade
    // quietly: the alternative — a crash — would reach an MCP caller as INTERNAL_ERROR for a request
    // that is entirely valid.
    const result = lintContent({
      path: AD_HOC_PATH,
      content: CONTENT,
      rules: [{ rule: ruleRegistry.resolveRule("GRP-001", {}) }],
      rootDir: process.cwd(),
    });

    expect(result.messages).toEqual([]);
    expect(result.files).toEqual([AD_HOC_PATH]);
  });
});
