import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildDependencyGraph } from "../src/graph/build.js";
import { parseMarkdownFiles } from "../src/markdown/parse.js";
import type { MarkdownFile } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (tempDir) => {
      const fs = await import("node:fs/promises");
      await fs.rm(tempDir, { recursive: true, force: true });
    })
  );
});

async function createRepoFiles(fileMap: Record<string, string>): Promise<MarkdownFile[]> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-graph-"));
  tempDirs.push(tempDir);

  const files: MarkdownFile[] = [];

  for (const [relativePath, text] of Object.entries(fileMap)) {
    const absolutePath = path.join(tempDir, relativePath);
    await (await import("node:fs/promises")).mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, text, "utf8");
    files.push({
      path: relativePath.replaceAll("\\", "/"),
      absolutePath,
      bytes: Buffer.byteLength(text)
    });
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

describe("buildDependencyGraph", () => {
  it("creates a single edge from one doc to another", async () => {
    const files = await createRepoFiles({
      "README.md": "[Guide](docs/guide.md)\n",
      "docs/guide.md": "# Guide\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      buildDependencyGraph({
        files: parsed.files,
        links: parsed.links
      })
    ).toEqual({
      nodes: [
        { path: "docs/guide.md", bytes: 8 },
        { path: "README.md", bytes: 23 }
      ],
      edges: [{ from: "README.md", to: "docs/guide.md", kind: "markdown-link" }]
    });
  });

  it("deduplicates duplicate links", async () => {
    const files = await createRepoFiles({
      "README.md": "[One](docs/guide.md)\n[Two](docs/guide.md)\n",
      "docs/guide.md": "# Guide\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      buildDependencyGraph({
        files: parsed.files,
        links: parsed.links
      }).edges
    ).toEqual([{ from: "README.md", to: "docs/guide.md", kind: "markdown-link" }]);
  });

  it("creates no edge for same-file anchors", async () => {
    const files = await createRepoFiles({
      "README.md": "[Jump](#intro)\n## Intro\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      buildDependencyGraph({
        files: parsed.files,
        links: parsed.links
      }).edges
    ).toEqual([]);
  });

  it("creates no edge for missing local files", async () => {
    const files = await createRepoFiles({
      "README.md": "[Missing](docs/missing.md)\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      buildDependencyGraph({
        files: parsed.files,
        links: parsed.links
      }).edges
    ).toEqual([]);
  });

  it("creates no edge for external links", async () => {
    const files = await createRepoFiles({
      "README.md": "[Site](https://example.com)\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      buildDependencyGraph({
        files: parsed.files,
        links: parsed.links
      }).edges
    ).toEqual([]);
  });

  it("excludes self-links from the graph", async () => {
    const files = await createRepoFiles({
      "README.md": "[Self](README.md)\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      buildDependencyGraph({
        files: parsed.files,
        links: parsed.links
      }).edges
    ).toEqual([]);
  });

  it("renders a deterministic json snapshot for a small graph", async () => {
    const files = await createRepoFiles({
      "README.md": "[B](docs/b.md)\n[A](docs/a.md)\n",
      "docs/a.md": "[B](b.md)\n",
      "docs/b.md": "# B\n"
    });
    const parsed = await parseMarkdownFiles(files);
    const graph = buildDependencyGraph({
      files: parsed.files,
      links: parsed.links
    });

    expect(`${JSON.stringify(graph, null, 2)}\n`).toBe(`{
  "nodes": [
    {
      "path": "docs/a.md",
      "bytes": 10
    },
    {
      "path": "docs/b.md",
      "bytes": 4
    },
    {
      "path": "README.md",
      "bytes": 30
    }
  ],
  "edges": [
    {
      "from": "docs/a.md",
      "to": "docs/b.md",
      "kind": "markdown-link"
    },
    {
      "from": "README.md",
      "to": "docs/a.md",
      "kind": "markdown-link"
    },
    {
      "from": "README.md",
      "to": "docs/b.md",
      "kind": "markdown-link"
    }
  ]
}
`);
  });
});
