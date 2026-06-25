import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseMarkdownFiles } from "../src/markdown/parse.js";
import { checkLocalLinks } from "../src/rules/local-links.js";
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

async function createRepoFiles(
  fileMap: Record<string, string>
): Promise<MarkdownFile[]> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-ctxlint-links-"));
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

describe("checkLocalLinks", () => {
  it("ignores existing relative file links", async () => {
    const files = await createRepoFiles({
      "README.md": "[Guide](docs/guide.md)\n",
      "docs/guide.md": "# Guide\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      checkLocalLinks({
        files: parsed.files,
        links: parsed.links,
        anchorIndex: parsed.anchorIndex
      })
    ).toEqual([]);
  });

  it("detects missing relative file links", async () => {
    const files = await createRepoFiles({
      "README.md": "[Guide](docs/missing.md)\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      checkLocalLinks({
        files: parsed.files,
        links: parsed.links,
        anchorIndex: parsed.anchorIndex
      })
    ).toEqual([
      {
        ruleId: "links/broken-links",
        severity: "warning",
        path: "README.md",
        line: 1,
        column: 1,
        message: 'Broken local link "docs/missing.md": target file not found.'
      }
    ]);
  });

  it("accepts existing same-file anchors", async () => {
    const files = await createRepoFiles({
      "README.md": "[Jump](#overview)\n## Overview\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      checkLocalLinks({
        files: parsed.files,
        links: parsed.links,
        anchorIndex: parsed.anchorIndex
      })
    ).toEqual([]);
  });

  it("detects missing same-file anchors", async () => {
    const files = await createRepoFiles({
      "README.md": "[Jump](#missing)\n## Overview\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      checkLocalLinks({
        files: parsed.files,
        links: parsed.links,
        anchorIndex: parsed.anchorIndex
      })
    ).toEqual([
      {
        ruleId: "links/broken-links",
        severity: "warning",
        path: "README.md",
        line: 1,
        column: 1,
        message: 'Broken local link "#missing": anchor "missing" not found in README.md.'
      }
    ]);
  });

  it("accepts existing cross-file anchors", async () => {
    const files = await createRepoFiles({
      "README.md": "[Guide](docs/guide.md#overview)\n",
      "docs/guide.md": "## Overview\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      checkLocalLinks({
        files: parsed.files,
        links: parsed.links,
        anchorIndex: parsed.anchorIndex
      })
    ).toEqual([]);
  });

  it("detects missing cross-file anchors", async () => {
    const files = await createRepoFiles({
      "README.md": "[Guide](docs/guide.md#missing)\n",
      "docs/guide.md": "## Overview\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      checkLocalLinks({
        files: parsed.files,
        links: parsed.links,
        anchorIndex: parsed.anchorIndex
      })
    ).toEqual([
      {
        ruleId: "links/broken-links",
        severity: "warning",
        path: "README.md",
        line: 1,
        column: 1,
        message: 'Broken local link "docs/guide.md#missing": anchor "missing" not found in docs/guide.md.'
      }
    ]);
  });

  it("ignores external https links", async () => {
    const files = await createRepoFiles({
      "README.md": "[Site](https://example.com)\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      checkLocalLinks({
        files: parsed.files,
        links: parsed.links,
        anchorIndex: parsed.anchorIndex
      })
    ).toEqual([]);
  });

  it("resolves encoded spaces consistently", async () => {
    const files = await createRepoFiles({
      "README.md": "[Doc](docs/with%20space.md)\n",
      "docs/with space.md": "# Encoded\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      checkLocalLinks({
        files: parsed.files,
        links: parsed.links,
        anchorIndex: parsed.anchorIndex
      })
    ).toEqual([]);
  });

  it("treats links outside the scan root as invalid local links", async () => {
    const files = await createRepoFiles({
      "docs/guide.md": "[Outside](../../README.md)\n"
    });
    const parsed = await parseMarkdownFiles(files);

    expect(
      checkLocalLinks({
        files: parsed.files,
        links: parsed.links,
        anchorIndex: parsed.anchorIndex
      })
    ).toEqual([
      {
        ruleId: "links/broken-links",
        severity: "warning",
        path: "docs/guide.md",
        line: 1,
        column: 1,
        message: 'Broken local link "../../README.md": target file not found.'
      }
    ]);
  });
});
