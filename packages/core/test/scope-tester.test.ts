import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LintConfig } from "../src/config/config-schema.js";
import { resolveCorpusScope } from "../src/config/corpus-scope.js";
import { createScopeTester } from "../src/config/scope-tester.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { loadDocuments } from "../src/markdown/load-documents.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

async function createTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-scope-"));
  tempDirs.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
  return root;
}

// Every case the walk prunes or keeps for a different reason: a user `exclude`, a default noise
// directory, a root `.gitignore` pattern, a directory-only pattern, and a nested `.gitignore` that
// drops its folder's Markdown but negates one file back in.
const TREE: Record<string, string> = {
  ".gitignore": "*.local.md\nbuild/\n.env\n",
  "README.md": "# Home\n",
  "notes.local.md": "# Local\n",
  ".env": "SECRET=1\n",
  "docs/guide.md": "# Guide\n",
  "docs/.gitignore": "*.md\n!keep.md\n",
  "docs/keep.md": "# Keep\n",
  "docs/drop.md": "# Drop\n",
  "drafts/idea.md": "# Idea\n",
  "build/out.md": "# Out\n",
  "node_modules/pkg/README.md": "# Pkg\n",
  "src/app.ts": "export {};\n",
};

const CONFIG: LintConfig = {
  include: ["**/*.md"],
  exclude: ["drafts/**"],
  respectGitignore: true,
};

describe("createScopeTester", () => {
  // The tester answers for one path what the walk answers for all of them. Compared in both
  // directions over every Markdown file in the tree, so a file the walk keeps that the tester
  // calls out of scope fails as surely as the reverse.
  it("calls exactly the walk's corpus in scope", async () => {
    const root = await createTree(TREE);
    const scope = resolveCorpusScope(CONFIG);
    const walked = [
      ...(
        await loadDocuments(scope.include, {
          cwd: root,
          exclude: scope.exclude,
          respectGitignore: scope.respectGitignore,
        })
      ).values(),
    ]
      .map((document) => document.path)
      .sort(compareStrings);

    const tester = createScopeTester({ cwd: root, config: CONFIG });
    const markdown = Object.keys(TREE).filter((file) => file.endsWith(".md"));
    const inScope: string[] = [];
    for (const file of markdown) {
      if (tester.includes(file) && !(await tester.excludes(file, false))) {
        inScope.push(file);
      }
    }
    expect(walked).toEqual(["README.md", "docs/keep.md"]);
    expect(inScope.sort(compareStrings)).toEqual(walked);
  });

  it("prunes a directory the way the walk does", async () => {
    const root = await createTree(TREE);
    const tester = createScopeTester({ cwd: root, config: CONFIG });
    expect(await tester.excludes("drafts", true)).toBe(true);
    expect(await tester.excludes("build", true)).toBe(true);
    expect(await tester.excludes("node_modules", true)).toBe(true);
    expect(await tester.excludes("build/new/deep.png", false)).toBe(true);
    expect(await tester.excludes("docs", true)).toBe(false);
    expect(await tester.excludes("src", true)).toBe(false);
    expect(await tester.excludes("src/app.ts", false)).toBe(false);
  });

  it("names a path include takes in, whatever excludes it", async () => {
    const root = await createTree(TREE);
    const tester = createScopeTester({ cwd: root, config: CONFIG });
    expect(tester.includes("drafts/idea.md")).toBe(true);
    expect(tester.includes("src/app.ts")).toBe(false);
  });

  // `.gitignore` is opt-in for the corpus, so without `respectGitignore` an ignored file is in
  // scope; a caller that hands files out can still ask for every `.gitignore` to count.
  it("honors .gitignore as the config says, or always when asked", async () => {
    const root = await createTree(TREE);
    const config = { ...CONFIG, respectGitignore: false };
    const byConfig = createScopeTester({ cwd: root, config });
    expect(await byConfig.excludes(".env", false)).toBe(false);
    expect(await byConfig.excludes("notes.local.md", false)).toBe(false);

    const always = createScopeTester({
      cwd: root,
      config,
      respectGitignore: true,
    });
    expect(await always.excludes(".env", false)).toBe(true);
    expect(await always.excludes("notes.local.md", false)).toBe(true);
    expect(await always.excludes("docs/drop.md", false)).toBe(true);
    expect(await always.excludes("docs/keep.md", false)).toBe(false);
    // `exclude` applies either way.
    expect(await always.excludes("drafts/idea.md", false)).toBe(true);
  });
});
