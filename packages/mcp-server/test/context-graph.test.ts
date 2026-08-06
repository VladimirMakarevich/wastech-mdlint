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

    // The summary-only fields must be absent on the json branch.
    expect(
      (structured as unknown as { components?: unknown }).components,
    ).toBeUndefined();
  });

  it("returns components and topological reading order for format: summary", async () => {
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
    const [json, summary] = await Promise.all([
      handleContextGraph({ cwd: graphProject }),
      handleContextGraph({ cwd: graphProject, format: "summary" }),
    ]);

    const textOf = (result: Awaited<ReturnType<typeof handleContextGraph>>) =>
      result.content.map((block) => (block as { text?: string }).text).join("");

    expect(textOf(json)).toContain("entry points (");
    expect(textOf(json)).toBe(textOf(summary));
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
});
