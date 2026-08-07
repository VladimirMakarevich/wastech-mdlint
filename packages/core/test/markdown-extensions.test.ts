import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_INCLUDE_GLOBS } from "../src/config/corpus-scope.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { matchesConfigGlob } from "../src/discovery/globs.js";
import {
  isMarkdownFile,
  LINTED_MARKDOWN_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  MARKDOWN_GLOB_SUFFIX,
} from "../src/discovery/markdown-extensions.js";
import { scanRepository } from "../src/discovery/repo-scan.js";
import { buildContextGraph } from "../src/graph/build-context-graph.js";
import { computeGraphCoverage } from "../src/graph/coverage.js";
import type { ParsedDocument } from "../src/markdown/document-types.js";
import { loadDocuments } from "../src/markdown/load-documents.js";

// P13.05 / W-09: three subsystems used to disagree on what "a Markdown file" is — coverage said
// `.md`+`.markdown`, the `init` scan said `.md`+`.mdx`, the default `include` said `.md`. This suite
// is the exit criterion for that: it drives the three sites end to end rather than comparing
// constants, so a site that stops reading the shared module fails here even though the module itself
// still exports the right set.

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-mdext-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

async function loadCorpus(
  root: string,
  include: string[],
): Promise<Map<string, ParsedDocument>> {
  const loaded = await loadDocuments(include, { cwd: root });
  const documents = new Map<string, ParsedDocument>();
  for (const document of loaded.values()) {
    documents.set(document.path, document);
  }
  return documents;
}

describe("one Markdown-extension definition across the three sites", () => {
  it("declares the linted extensions as a subset of the on-disk ones", () => {
    expect(LINTED_MARKDOWN_EXTENSIONS.length).toBeGreaterThan(0);
    for (const extension of LINTED_MARKDOWN_EXTENSIONS) {
      expect(MARKDOWN_EXTENSIONS).toContain(extension);
    }
    // Every extension is dotted and lower-case — `isMarkdownFile` compares against
    // `path.posix.extname(...).toLowerCase()`, so an entry shaped otherwise could never match.
    for (const extension of MARKDOWN_EXTENSIONS) {
      expect(extension).toBe(extension.toLowerCase());
      expect(extension.startsWith(".")).toBe(true);
    }
  });

  it("the coverage signal reports every on-disk extension and nothing outside the set", async () => {
    const linked = MARKDOWN_EXTENSIONS.map(
      (extension) => `outside/page${extension}`,
    );
    const root = await fixtureRepo({
      "hub.md": [
        ...linked.map((target) => `[out](${target})`),
        // `.markdown` is deliberately not in the set (it existed only in the old coverage helper).
        "[legacy](outside/legacy.markdown)",
      ].join("\n"),
      ...Object.fromEntries(
        [...linked, "outside/legacy.markdown"].map((file) => [file, "# Out\n"]),
      ),
    });

    // Corpus is `hub.md` alone, so every linked file is on disk and outside it.
    const documents = await loadCorpus(root, ["hub.md"]);
    const coverage = computeGraphCoverage(
      documents,
      buildContextGraph(documents),
      { rootDir: root },
    );

    // Sorted with the product's own comparator — `filesOutsideCorpus` is `compareStrings`-sorted,
    // so a hand-rolled sort here would drift from it as soon as the set grows.
    expect(coverage.filesOutsideCorpus).toEqual(
      [...linked].sort(compareStrings),
    );
  });

  it("the `init` scan walks every on-disk extension and proposes the derived glob", async () => {
    const root = await fixtureRepo(
      Object.fromEntries(
        MARKDOWN_EXTENSIONS.map((extension) => [
          `docs/page${extension}`,
          "# Page\n",
        ]),
      ),
    );

    const { clusters } = await scanRepository({ cwd: root });
    const docsCluster = clusters.find((cluster) => cluster.path === "docs");

    expect(docsCluster?.subtreeCount).toBe(MARKDOWN_EXTENSIONS.length);
    expect(docsCluster?.includeGlob).toBe(`docs/**/${MARKDOWN_GLOB_SUFFIX}`);
  });

  it("the default `include` admits the linted subset and only that", () => {
    for (const extension of MARKDOWN_EXTENSIONS) {
      expect(
        matchesConfigGlob(`docs/page${extension}`, [...DEFAULT_INCLUDE_GLOBS]),
      ).toBe(LINTED_MARKDOWN_EXTENSIONS.includes(extension));
    }
  });

  it("classifies by extension, not by suffix", () => {
    expect(isMarkdownFile("docs/PAGE.MD")).toBe(true);
    expect(isMarkdownFile("docs/page.md")).toBe(true);
    expect(isMarkdownFile("docs/notes.txt")).toBe(false);
    // A file whose whole name is the extension has no extension by `path.posix.extname`, so it is
    // not a Markdown file here — unlike the `endsWith` check coverage used before P13.05.
    expect(isMarkdownFile(".md")).toBe(false);
    // `.markdown` ends with neither member; the old coverage helper's `endsWith` would have said
    // `.md` matched it.
    expect(isMarkdownFile("docs/legacy.markdown")).toBe(false);
  });
});
