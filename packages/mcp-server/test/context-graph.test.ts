import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ContextGraph, ContextGraphSummary } from "@wastech-mdlint/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { handleContextGraph } from "../src/tools/context-graph.js";
// Shared with core and cli (P15.01): one 139-document corpus, not three copies.
import {
  LARGE_CORPUS_DOCUMENT_COUNT,
  LARGE_CORPUS_ENTRY_POINT_COUNT,
  LARGE_CORPUS_LINE_WIDTH_BOUND,
  writeLargeCorpus,
} from "../../core/test/support/large-corpus.js";
import { readHumanSections } from "../../core/test/support/output-parity.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);
const graphProject = path.join(fixturesDir, "graph-project");

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("handleContextGraph", () => {
  it("returns the raw graph with cycles when format is omitted", async () => {
    const result = await handleContextGraph({ cwd: graphProject });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as unknown as ContextGraph;
    expect(structured.nodes.map((node) => node.path).sort()).toEqual([
      "cycle-a.md",
      "cycle-b.md",
      "design.md",
      "guide.md",
      "index.md",
      "orphan.md",
      "requirements.md",
    ]);
    expect(structured.cycles).toHaveLength(1);
    expect(new Set(structured.cycles[0])).toEqual(
      new Set(["cycle-a.md", "cycle-b.md"]),
    );

    // The summary-only fields must be absent on the raw branch: `raw` means the verbatim
    // `ContextGraph`, which is what P15.02's rename claims and what keeps the default branch free of
    // coverage's disk re-scan.
    for (const field of [
      "components",
      "readingOrder",
      "excluded",
      "coverage",
    ]) {
      expect(
        structured as unknown as Record<string, unknown>,
      ).not.toHaveProperty(field);
    }
  });

  it("returns the same document as CLI graph --format json for format: summary", async () => {
    const result = await handleContextGraph({
      cwd: graphProject,
      format: "summary",
    });

    expect(result.isError).toBeFalsy();
    const structured =
      result.structuredContent as unknown as ContextGraphSummary;

    const components = structured.components.map((component) =>
      [...component].sort(),
    );
    expect(components).toContainEqual([
      "design.md",
      "guide.md",
      "index.md",
      "requirements.md",
    ]);
    expect(components).toContainEqual(["cycle-a.md", "cycle-b.md"]);
    expect(components).toContainEqual(["orphan.md"]);

    // Reading order is topological (cycle members excluded), never re-sorted at the boundary.
    expect(structured.readingOrder).toEqual([
      "design.md",
      "index.md",
      "guide.md",
      "orphan.md",
      "requirements.md",
    ]);
    // W-23/W-22: both keys the CLI's `json` carries now reach MCP too. `excluded` explains the short
    // reading order; `coverage` is the graph's best diagnostic and was unreachable from this host.
    expect(structured.excluded).toEqual(["cycle-a.md", "cycle-b.md"]);
    expect(structured.coverage).toEqual({
      nodeCount: 7,
      edgeCount: structured.edges.length,
      filesOutsideCorpus: [],
    });
  });

  it("names a linked-but-excluded file in coverage.filesOutsideCorpus", async () => {
    // The G5 signal the field test called the graph report's single best diagnostic, and W-22's
    // reason for adding coverage here: an agent asking for the graph could not see that 12 linked
    // files were never linted. The shared `graph-project` fixture has no out-of-corpus file and
    // other suites assert its exact node set, so this scenario builds its own root rather than
    // perturbing it — mirroring the CLI fixture's excluded `appendix.md`.
    const dir = await makeTempDir("mcp-cg-coverage-");
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      `${JSON.stringify({ include: ["**/*.md"], exclude: ["appendix.md"], rules: [] })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(dir, "index.md"),
      "# Index\n\nBackground: [appendix](appendix.md).\n",
      "utf8",
    );
    await writeFile(path.join(dir, "appendix.md"), "# Appendix\n", "utf8");

    const result = await handleContextGraph({ cwd: dir, format: "summary" });

    expect(result.isError).toBeFalsy();
    const structured =
      result.structuredContent as unknown as ContextGraphSummary;
    expect(structured.nodes.map((node) => node.path)).toEqual(["index.md"]);
    expect(structured.coverage?.filesOutsideCorpus).toEqual(["appendix.md"]);
  });

  it("returns an empty graph with no error for a zero-config empty directory", async () => {
    const dir = await makeTempDir("mcp-cg-empty-");

    const result = await handleContextGraph({ cwd: dir });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      nodes: [],
      edges: [],
      cycles: [],
    });
  });

  it("returns the human summary as the text block on both format branches", async () => {
    // Nothing asserted the text block before P15.01, yet it is the graph report a host actually
    // renders — and it is the same `formatContextGraphSummary` output regardless of `format`.
    const [raw, summary] = await Promise.all([
      handleContextGraph({ cwd: graphProject, format: "raw" }),
      handleContextGraph({ cwd: graphProject, format: "summary" }),
    ]);

    const textOf = (result: Awaited<ReturnType<typeof handleContextGraph>>) =>
      result.content.map((block) => (block as { text?: string }).text).join("");

    expect(textOf(raw)).toContain("entry points (");
    expect(textOf(raw)).toBe(textOf(summary));
  });

  it("passes a structured CONFIG_INVALID error through on malformed config", async () => {
    const dir = await makeTempDir("mcp-cg-invalid-");
    await writeFile(
      path.join(dir, "wastech-mdlint.config.json"),
      "{ not valid ",
      "utf8",
    );

    const result = await handleContextGraph({ cwd: dir });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe(
      "CONFIG_INVALID",
    );
  });
});

describe("handleContextGraph at corpus scale", () => {
  // The MCP text block is the same human report the CLI prints, so it inherits W-26's line-shape
  // fix — an exit criterion this suite is the only place to prove.
  let root: string;

  beforeAll(async () => {
    root = await makeTempDir("mcp-cg-large-");
    await writeLargeCorpus(root);
  }, 60_000);

  it("emits a line-oriented text block under the stated width at 139 documents", async () => {
    const result = await handleContextGraph({ cwd: root, format: "summary" });

    expect(result.isError).toBeFalsy();
    const text = result.content
      .map((block) => (block as { text?: string }).text ?? "")
      .join("");
    const lines = text.split("\n");
    const longest = lines.reduce(
      (widest, line) => (line.length > widest.length ? line : widest),
      "",
    );

    expect(lines).toContain(`nodes: ${LARGE_CORPUS_DOCUMENT_COUNT}`);
    expect(lines).toContain(
      `entry points (${LARGE_CORPUS_ENTRY_POINT_COUNT}):`,
    );
    expect(longest.length).toBeLessThanOrEqual(LARGE_CORPUS_LINE_WIDTH_BOUND);
  }, 60_000);

  // @boundary-guard host-parity
  // W-57 / P16.01 §5. This tool returns two documents for one call, and they are deliberately not the
  // same view: the text block is `formatContextGraphSummary` (nodes/edges/cycles/entry points/hubs)
  // while `structuredContent` on the `summary` branch is the full `ContextGraphSummary`. What must
  // hold is that where they overlap they agree — the narrower one being *stale* rather than narrow is
  // the failure, and reading the code cannot tell those apart.
  //
  // `entry points` is the whole overlap, which is itself the finding: the reading order and the set a
  // cycle excluded from it reach a model only through `structuredContent`. Stated in the tool's own
  // description, and worth pinning as a decision rather than rediscovering as an omission.
  it("agrees with its own structured payload on the text block's one path section", async () => {
    const result = await handleContextGraph({ cwd: root, format: "summary" });

    expect(result.isError).toBeFalsy();
    const text = result.content
      .map((block) => (block as { text?: string }).text ?? "")
      .join("");
    const summary = result.structuredContent as unknown as ContextGraphSummary;
    const sections = readHumanSections(text);

    expect(sections["entry points"]).toEqual(
      summary.nodes
        .filter((node) => node.inDegree === 0)
        .map((node) => node.path),
    );
    expect(sections["entry points"]).toHaveLength(
      LARGE_CORPUS_ENTRY_POINT_COUNT,
    );
    // The overlap is exactly one section: everything else the structured payload carries is absent
    // from the text, so a caller that reads only `content` sees no reading order at all.
    expect(Object.keys(sections)).toEqual(["entry points"]);
    expect(summary.excluded.length).toBeGreaterThan(0);
  }, 60_000);
});
