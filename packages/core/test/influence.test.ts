import { describe, expect, it } from "vitest";

import {
  eagerContextPaths,
  rankByInfluence,
} from "../src/changes/influence.js";
import { openGitRepository } from "../src/git/git-repository.js";
import { buildContextGraph } from "../src/graph/build-context-graph.js";
import { parseDocument } from "../src/markdown/parse-document.js";
import { hasGit, makeRepo } from "./support/git-fixture.js";

// CLAUDE.md eagerly imports the rules, which import the style guide; two guides link to the hub, and
// the hub links to nothing.
function graphOf(files: Record<string, string>) {
  return buildContextGraph(
    new Map(
      Object.entries(files).map(([path, content]) => [
        path,
        parseDocument({ path, content }),
      ]),
    ),
  );
}

const graph = graphOf({
  "CLAUDE.md": "# Agent\n\n@rules/index.md\n",
  // An eager import resolves from the importing file's own folder.
  "rules/index.md": "# Rules\n\n@style.md\n",
  "rules/style.md": "# Style\n",
  "docs/a.md": "# A\n\n[hub](hub.md)\n",
  "docs/b.md": "# B\n\n[hub](hub.md)\n",
  "docs/hub.md": "# Hub\n",
  "docs/lone.md": "# Lone\n",
});

const llm = (entrypoints: string[], severity?: "off") => ({
  rules: [
    {
      rule: "LLM-001",
      ...(severity === undefined ? {} : { severity }),
      options: { entrypoints, maxTokensPerEntrypoint: 1000 },
    },
  ],
});

describe("eagerContextPaths", () => {
  it("follows the configured entrypoints through every eager import", () => {
    expect([...eagerContextPaths(graph, llm(["CLAUDE.md"]))].sort()).toEqual([
      "CLAUDE.md",
      "rules/index.md",
      "rules/style.md",
    ]);
  });

  it("is empty when LLM-001 is not configured or is switched off", () => {
    expect(eagerContextPaths(graph, { rules: [] }).size).toBe(0);
    expect(eagerContextPaths(graph, llm(["CLAUDE.md"], "off")).size).toBe(0);
  });
});

describe("rankByInfluence", () => {
  it("puts eager context first, then the most reached, then the path", () => {
    const ranked = rankByInfluence(
      [
        { status: "M", path: "docs/lone.md" },
        { status: "D", path: "docs/gone.md" },
        { status: "M", path: "docs/hub.md" },
        { status: "M", path: "rules/style.md" },
        { status: "A", path: "docs/a.md" },
      ],
      { graph, eager: eagerContextPaths(graph, llm(["CLAUDE.md"])) },
    );
    expect(
      ranked.map(({ path, eager, reach }) => ({ path, eager, reach })),
    ).toEqual([
      { path: "rules/style.md", eager: true, reach: 2 },
      { path: "docs/hub.md", eager: false, reach: 2 },
      { path: "docs/a.md", eager: false, reach: 0 },
      { path: "docs/gone.md", eager: false, reach: 0 },
      { path: "docs/lone.md", eager: false, reach: 0 },
    ]);
  });
});

describe.skipIf(!hasGit)("revisionKey (requires git on PATH)", () => {
  it("changes when HEAD moves and is undefined for a base that names nothing", async () => {
    const fixture = await makeRepo();
    await fixture.write("a.md", "a\n");
    fixture.commit("base");
    fixture.git("checkout", "-q", "-b", "feature");
    const repository = await openGitRepository(fixture.repo, {
      env: fixture.env,
    });
    if (!repository.available) {
      throw new Error(`expected a repository, got ${repository.reason}`);
    }
    const base = await repository.resolveBase();
    if ("available" in base) {
      throw new Error(`expected a base, got ${base.reason}`);
    }
    const before = await repository.revisionKey(base);
    expect(before).toBe(`${base.commit}:${base.commit}`);

    await fixture.write("a.md", "a, edited\n");
    fixture.commit("feature");
    const after = await repository.revisionKey(base);
    expect(after).toBe(
      `${fixture.git("rev-parse", "HEAD").trim()}:${base.commit}`,
    );

    expect(
      await repository.revisionKey({ ref: "gone", commit: base.commit }),
    ).toBeUndefined();
    expect(
      await repository.revisionKey({ ref: "--all", commit: base.commit }),
    ).toBeUndefined();
  }, 60_000);

  it("keys an auto-detected base by the branch it was found as, not a tag of the same name", async () => {
    const fixture = await makeRepo();
    await fixture.write("a.md", "a\n");
    fixture.commit("base");
    const mainCommit = fixture.git("rev-parse", "HEAD").trim();
    fixture.git("checkout", "-q", "-b", "feature");
    await fixture.write("a.md", "a, edited\n");
    fixture.commit("feature");
    // A tag named like the base branch but pointing elsewhere: `main` alone now resolves to it.
    fixture.git("tag", "main", "HEAD");
    const repository = await openGitRepository(fixture.repo, {
      env: fixture.env,
    });
    if (!repository.available) {
      throw new Error(`expected a repository, got ${repository.reason}`);
    }
    const base = await repository.resolveBase();
    if ("available" in base) {
      throw new Error(`expected a base, got ${base.reason}`);
    }
    expect(base).toMatchObject({ ref: "main", commit: mainCommit });

    const head = fixture.git("rev-parse", "HEAD").trim();
    expect(await repository.revisionKey(base)).toBe(`${head}:${mainCommit}`);
  }, 60_000);
});
