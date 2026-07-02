import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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

async function createMarkdownFile(relativePath: string, text: string): Promise<MarkdownFile> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-markdown-"));
  tempDirs.push(tempDir);

  const absolutePath = path.join(tempDir, relativePath);
  const absoluteDirectory = path.dirname(absolutePath);
  const fs = await import("node:fs/promises");
  await fs.mkdir(absoluteDirectory, { recursive: true });
  await writeFile(absolutePath, text, "utf8");

  return {
    path: relativePath.replaceAll("\\", "/"),
    absolutePath,
    bytes: Buffer.byteLength(text)
  };
}

describe("parseMarkdownFiles", () => {
  it("extracts inline local links", async () => {
    const file = await createMarkdownFile("docs/guide.md", "[Plan](../PLAN.md)\n");

    const parsed = await parseMarkdownFiles([file]);

    expect(parsed.links).toEqual([
      {
        sourcePath: "docs/guide.md",
        rawTarget: "../PLAN.md",
        kind: "local-file",
        targetPath: "PLAN.md",
        line: 1,
        column: 1
      }
    ]);
  });

  it("extracts same-file anchors", async () => {
    const file = await createMarkdownFile("README.md", "[Section](#intro)\n## Intro\n");

    const parsed = await parseMarkdownFiles([file]);

    expect(parsed.links[0]).toEqual({
      sourcePath: "README.md",
      rawTarget: "#intro",
      kind: "same-file-anchor",
      anchor: "intro",
      line: 1,
      column: 1
    });
  });

  it("extracts cross-file anchors", async () => {
    const file = await createMarkdownFile("README.md", "[Guide](docs/guide.md#overview)\n");

    const parsed = await parseMarkdownFiles([file]);

    expect(parsed.links[0]).toEqual({
      sourcePath: "README.md",
      rawTarget: "docs/guide.md#overview",
      kind: "local-file",
      targetPath: "docs/guide.md",
      anchor: "overview",
      line: 1,
      column: 1
    });
  });

  it("ignores fenced code block links", async () => {
    const file = await createMarkdownFile(
      "README.md",
      "```md\n[Ignored](docs/ignored.md)\n```\n[Used](docs/used.md)\n"
    );

    const parsed = await parseMarkdownFiles([file]);

    expect(parsed.links).toHaveLength(1);
    expect(parsed.links[0]?.rawTarget).toBe("docs/used.md");
  });

  it("extracts reference-style links when definitions exist", async () => {
    const file = await createMarkdownFile("README.md", "[Guide][g]\n\n[g]: docs/guide.md\n");

    const parsed = await parseMarkdownFiles([file]);

    expect(parsed.links[0]).toEqual({
      sourcePath: "README.md",
      rawTarget: "docs/guide.md",
      kind: "local-file",
      targetPath: "docs/guide.md",
      line: 1,
      column: 1
    });
  });

  it("generates duplicate heading slugs", async () => {
    const file = await createMarkdownFile("README.md", "# Heading\n## Heading\n### Heading\n");

    const parsed = await parseMarkdownFiles([file]);

    expect(parsed.anchorIndex["README.md"]).toEqual(["heading", "heading-1", "heading-2"]);
  });

  it("preserves cyrillic heading text in slugs", async () => {
    const file = await createMarkdownFile("README.md", "# Привет мир\n");

    const parsed = await parseMarkdownFiles([file]);

    expect(parsed.anchorIndex["README.md"]).toEqual(["привет-мир"]);
  });

  it("classifies https, mailto, and unsupported schemes", async () => {
    const file = await createMarkdownFile(
      "README.md",
      [
        "[Site](https://example.com)",
        "[Mail](mailto:test@example.com)",
        "[Other](vscode://file/example)"
      ].join("\n")
    );

    const parsed = await parseMarkdownFiles([file]);

    expect(parsed.links.map((link) => ({ rawTarget: link.rawTarget, kind: link.kind }))).toEqual([
      { rawTarget: "https://example.com", kind: "external" },
      { rawTarget: "mailto:test@example.com", kind: "mailto" },
      { rawTarget: "vscode://file/example", kind: "other" }
    ]);
  });

  it("includes image links only when they point to markdown files", async () => {
    const file = await createMarkdownFile(
      "README.md",
      "![Doc](docs/image-target.md)\n![PNG](assets/example.png)\n"
    );

    const parsed = await parseMarkdownFiles([file]);

    expect(parsed.links).toHaveLength(1);
    expect(parsed.links[0]).toEqual({
      sourcePath: "README.md",
      rawTarget: "docs/image-target.md",
      kind: "local-file",
      targetPath: "docs/image-target.md",
      line: 1,
      column: 1
    });
  });

  it("decodes local paths for filesystem lookup and keeps raw targets", async () => {
    const file = await createMarkdownFile("README.md", "[Encoded](docs/%D1%82%D0%B5%D1%81%D1%82.md)\n");

    const parsed = await parseMarkdownFiles([file]);

    expect(parsed.links[0]).toEqual({
      sourcePath: "README.md",
      rawTarget: "docs/%D1%82%D0%B5%D1%81%D1%82.md",
      kind: "local-file",
      targetPath: "docs/тест.md",
      line: 1,
      column: 1
    });
  });
});
