import { describe, expect, it } from "vitest";

import {
  classifyChanges,
  collectChangeSet,
  type CorpusMembership,
} from "../src/changes/change-set.js";
import { createScopeTester } from "../src/config/scope-tester.js";
import { openGitRepository } from "../src/git/git-repository.js";
import { hasGit, makeRepo } from "./support/git-fixture.js";

// A corpus whose scope is every `.md` file outside `drafts/`, holding exactly the given documents.
function corpusOf(documents: string[]): CorpusMembership {
  return {
    documents: new Set(documents),
    scope: {
      includes: (relPath) => relPath.endsWith(".md"),
      excludes: (relPath) => Promise.resolve(relPath.startsWith("drafts/")),
    },
    configPath: "wastech-mdlint.config.json",
  };
}

describe("classifyChanges", () => {
  it("sorts changed paths into documents, the config, Markdown outside the corpus and other files", async () => {
    const classified = await classifyChanges(
      [
        { status: "M", path: "src/app.ts" },
        { status: "M", path: "wastech-mdlint.config.json" },
        { status: "A", path: "docs/new.md" },
        { status: "M", path: "drafts/idea.md" },
        { status: "D", path: "docs/gone.md" },
        { status: "D", path: "drafts/old.md" },
        { status: "D", path: "src/old.ts" },
        { status: "M", path: "README.md" },
      ],
      corpusOf(["README.md", "docs/new.md"]),
    );
    expect(classified).toEqual({
      documents: [
        { status: "M", path: "README.md" },
        { status: "D", path: "docs/gone.md" },
        { status: "A", path: "docs/new.md" },
      ],
      configChanged: true,
      outsideCorpus: [
        { status: "M", path: "drafts/idea.md" },
        { status: "D", path: "drafts/old.md" },
      ],
      otherFiles: [
        { status: "M", path: "src/app.ts" },
        { status: "D", path: "src/old.ts" },
      ],
    });
  });

  it("splits a rename that crosses the scope's edge into its two halves", async () => {
    const classified = await classifyChanges(
      [
        { status: "R", path: "docs/kept.md", oldPath: "docs/was.md" },
        { status: "R", path: "drafts/parked.md", oldPath: "docs/parked.md" },
        {
          status: "R",
          path: "docs/promoted.md",
          oldPath: "drafts/promoted.md",
        },
        { status: "R", path: "drafts/b.md", oldPath: "drafts/a.md" },
        { status: "R", path: "src/new.ts", oldPath: "src/old.ts" },
      ],
      corpusOf(["docs/kept.md", "docs/promoted.md"]),
    );
    expect(classified.documents).toEqual([
      { status: "R", path: "docs/kept.md", oldPath: "docs/was.md" },
      { status: "D", path: "docs/parked.md" },
      { status: "A", path: "docs/promoted.md" },
    ]);
    expect(classified.outsideCorpus).toEqual([
      { status: "R", path: "drafts/b.md", oldPath: "drafts/a.md" },
      { status: "A", path: "drafts/parked.md" },
      { status: "D", path: "drafts/promoted.md" },
    ]);
    expect(classified.otherFiles).toEqual([
      { status: "R", path: "src/new.ts", oldPath: "src/old.ts" },
    ]);
  });

  it("counts a renamed config as a config change", async () => {
    const classified = await classifyChanges(
      [
        {
          status: "R",
          path: "config/old.json",
          oldPath: "wastech-mdlint.config.json",
        },
      ],
      corpusOf([]),
    );
    expect(classified.configChanged).toBe(true);
    expect(classified.otherFiles).toEqual([]);
  });
});

describe.skipIf(!hasGit)("collectChangeSet (requires git on PATH)", () => {
  it("compares the work tree with the merge-base and classifies it against the corpus", async () => {
    const fixture = await makeRepo();
    const config = { include: ["docs/**/*.md"], exclude: ["docs/drafts/**"] };
    await fixture.write("wastech-mdlint.config.json", JSON.stringify(config));
    await fixture.write("docs/guide.md", "# Guide\n");
    await fixture.write("docs/old.md", "# Old\n");
    await fixture.write("src/app.ts", "export {};\n");
    fixture.commit("base");
    fixture.git("checkout", "-q", "-b", "feature");
    await fixture.write("docs/guide.md", "# Guide, edited\n");
    await fixture.write("docs/new.md", "# New\n");
    await fixture.write("docs/drafts/idea.md", "# Idea\n");
    await fixture.write("src/app.ts", "export const app = 1;\n");
    fixture.git("rm", "-q", "docs/old.md");
    fixture.commit("feature");
    await fixture.write(
      "wastech-mdlint.config.json",
      JSON.stringify({ ...config, rules: [] }),
    );

    const repository = await openGitRepository(fixture.repo, {
      env: fixture.env,
    });
    if (!repository.available) {
      throw new Error(`expected a repository, got ${repository.reason}`);
    }
    const corpus: CorpusMembership = {
      documents: new Set(["docs/guide.md", "docs/new.md"]),
      scope: createScopeTester({ cwd: fixture.repo, config }),
      configPath: "wastech-mdlint.config.json",
    };

    const changeSet = await collectChangeSet(repository, {
      worktree: true,
      corpus,
    });
    const mainCommit = fixture.git("rev-parse", "main").trim();
    expect(changeSet).toEqual({
      base: { ref: "main", commit: mainCommit },
      mergeBase: mainCommit,
      head: fixture.git("rev-parse", "HEAD").trim(),
      worktree: true,
      documents: [
        { status: "M", path: "docs/guide.md" },
        { status: "A", path: "docs/new.md" },
        { status: "D", path: "docs/old.md" },
      ],
      configChanged: true,
      outsideCorpus: [{ status: "A", path: "docs/drafts/idea.md" }],
      otherFiles: [{ status: "M", path: "src/app.ts" }],
    });

    expect(
      await collectChangeSet(repository, { worktree: false, corpus }),
    ).toMatchObject({ worktree: false, configChanged: false });

    expect(
      await collectChangeSet(repository, {
        base: "no-such-branch",
        worktree: true,
        corpus,
      }),
    ).toMatchObject({ available: false, reason: "base-not-found" });
  }, 60_000);
});
