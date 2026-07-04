import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildContextGraph } from "../src/graph/build-context-graph.js";
import { computeGraphCoverage } from "../src/graph/coverage.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { loadDocuments } from "../src/markdown/load-documents.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-coverage-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

// Load the corpus and re-key by repo-relative path, mirroring lintFiles' re-keying of loadDocuments'
// absolute-keyed map (computeGraphCoverage reads `document.path`, not the map key, but this keeps the
// fixture idiomatic with the rest of the graph test suite).
async function loadCorpus(root: string, exclude: string[] = []): Promise<Map<string, ParsedDocument>> {
  const loaded = await loadDocuments(["**/*.md"], { cwd: root, exclude });
  const documents = new Map<string, ParsedDocument>();
  for (const document of loaded.values()) {
    documents.set(document.path, document);
  }
  return documents;
}

describe("computeGraphCoverage", () => {
  it("reports node/edge counts and lists an on-disk Markdown file linked-to but outside the corpus", async () => {
    const root = await fixtureRepo({
      "index.md": "[a](a.md) [excluded](excluded.md) [excluded again](excluded.md)\n",
      "a.md": "# A\n",
      "excluded.md": "# Excluded\n"
    });
    const documents = await loadCorpus(root, ["excluded.md"]);
    const graph = buildContextGraph(documents);

    const coverage = computeGraphCoverage(documents, graph, { rootDir: root });

    expect(coverage.nodeCount).toBe(2);
    expect(coverage.edgeCount).toBe(1);
    expect(coverage.filesOutsideCorpus).toEqual(["excluded.md"]);
  });

  it("skips non-Markdown, missing, corpus-member, and root-escaping targets", async () => {
    const root = await fixtureRepo({
      "index.md":
        "[a](a.md)\n[asset](asset.png)\n[missing](missing.md)\n[outside](../outside.md)\n",
      "a.md": "# A\n",
      "asset.png": "binary\n"
    });
    const documents = await loadCorpus(root);
    const graph = buildContextGraph(documents);

    const coverage = computeGraphCoverage(documents, graph, { rootDir: root });

    expect(coverage.filesOutsideCorpus).toEqual([]);
  });

  it("resolves a root-relative link through the site router and flags the out-of-corpus target", async () => {
    const root = await fixtureRepo({
      "src/content/docs/guide.md": "[intro](/intro)\n",
      "src/content/docs/intro.md": "# Intro\n"
    });
    const documents = await loadCorpus(root, ["src/content/docs/intro.md"]);
    const graph = buildContextGraph(documents, { siteRouter: { preset: "starlight" } });

    const coverage = computeGraphCoverage(documents, graph, {
      rootDir: root,
      siteRouter: { preset: "starlight" }
    });

    expect(coverage.filesOutsideCorpus).toEqual(["src/content/docs/intro.md"]);
  });

  it("dedupes repeated targets across documents and returns a sorted result", async () => {
    const root = await fixtureRepo({
      "index.md": "[x](x.md)\n",
      "other.md": "[x](x.md)\n[a](a.md)\n",
      "a.md": "# A\n",
      "x.md": "# X\n"
    });
    const documents = await loadCorpus(root, ["x.md"]);
    const graph = buildContextGraph(documents);

    const coverage = computeGraphCoverage(documents, graph, { rootDir: root });

    expect(coverage.filesOutsideCorpus).toEqual(["x.md"]);
  });
});
