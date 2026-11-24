import path from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeSince } from "../src/changes/branch-review.js";
import {
  renderSinceHeader,
  sinceImpact,
  sinceLintResult,
} from "../src/changes/since-report.js";
import { loadConfiguration } from "../src/config/load-config.js";
import { classifyChangeImpact } from "../src/graph/impact-analysis.js";
import type { ContextGraph } from "../src/graph/context-graph-types.js";
import { hasGit, makeRepo } from "./support/git-fixture.js";

const TIMEOUT_MS = 60_000;

// A branch that breaks one link and fixes another: `lint --since` must report the first only, and
// count the second as removed, while the finding on a document the branch never touched stays out.
async function linkBranch() {
  const fixture = await makeRepo();
  await fixture.write(
    "wastech-mdlint.config.json",
    `${JSON.stringify({ rules: [{ rule: "REF-001" }] })}\n`,
  );
  await fixture.write("docs/hub.md", "# Hub\n\n[a](a.md) [b](b.md)\n");
  await fixture.write("docs/a.md", "# A\n\nText.\n");
  await fixture.write("docs/b.md", "# B\n\n[gone](gone.md)\n");
  await fixture.write("docs/old.md", "# Old\n\n[missing](nowhere.md)\n");
  fixture.commit("base");
  fixture.git("checkout", "-q", "-b", "feature");
  await fixture.write("docs/a.md", "# A\n\nText, and [a typo](hbu.md).\n");
  await fixture.write("docs/b.md", "# B\n\n[hub](hub.md)\n");
  return fixture;
}

async function analysis(cwd: string, env: NodeJS.ProcessEnv, ref = "main") {
  const configuration = await loadConfiguration({ cwd });
  return analyzeSince({ cwd, configuration, ref, env });
}

describe("classifyChangeImpact", () => {
  const graph = {
    nodes: ["a.md", "b.md", "c.md", "d.md"].map((path) => ({ path })),
    edges: [
      { from: "c.md", to: "a.md" },
      { from: "c.md", to: "b.md" },
      { from: "d.md", to: "c.md" },
    ],
    cycles: [],
  } as unknown as ContextGraph;

  it("merges the blast radius of several files, each document once at its shortest distance", () => {
    expect(classifyChangeImpact(graph, ["b.md", "a.md", "gone.md"])).toEqual({
      files: ["a.md", "b.md"],
      directlyAffected: [{ path: "c.md", references: 2 }],
      transitivelyAffected: [{ path: "d.md", depth: 2, via: "c.md" }],
      readingOrder: ["d.md", "c.md", "a.md", "b.md"],
      excluded: [],
    });
  });

  it("leaves a changed file out of the affected lists even when another changed file reaches it", () => {
    const result = classifyChangeImpact(graph, ["a.md", "c.md"]);
    expect(result.files).toEqual(["a.md", "c.md"]);
    expect(result.directlyAffected).toEqual([{ path: "d.md", references: 1 }]);
    expect(result.transitivelyAffected).toEqual([]);
  });
});

describe.skipIf(!hasGit)("since a ref (requires git on PATH)", () => {
  it(
    "reports only the findings the branch adds, and counts the ones it removes",
    async () => {
      const fixture = await linkBranch();
      const result = await analysis(fixture.repo, fixture.env);
      if ("available" in result) {
        throw new Error(result.message);
      }
      const lint = sinceLintResult(result);
      expect(
        lint.messages.map((message) => `${message.filePath} ${message.ruleId}`),
      ).toEqual(["docs/a.md REF-001"]);
      expect(lint.errorCount).toBe(1);
      expect(lint.files).toEqual(["docs/a.md", "docs/b.md"]);
      expect(lint.since).toMatchObject({
        ref: "main",
        changed: ["docs/a.md", "docs/b.md"],
      });
      expect(lint.since.removed.map((message) => message.filePath)).toEqual([
        "docs/b.md",
      ]);
      expect(lint.since.mergeBase).toMatch(/^[0-9a-f]{40,64}$/);
      expect(renderSinceHeader(lint.since)).toBe(
        `since main (merge-base ${lint.since.mergeBase.slice(0, 7)}): 2 changed documents, 1 finding removed\n`,
      );

      const impact = sinceImpact(result);
      expect(impact.files).toEqual(["docs/a.md", "docs/b.md"]);
      expect(impact.directlyAffected).toEqual([
        { path: "docs/hub.md", references: 2 },
      ]);
    },
    TIMEOUT_MS,
  );

  it(
    "lints the base with the base's config when the config sits above the linted directory",
    async () => {
      // The branch turns a rule on and touches no document: every finding it brings is new, and
      // only a base linted with the base's own config — which had no rules — can say so. A root
      // below the config that compared only its own directory would never see the config change,
      // would lint the base with the head's config, and would report nothing.
      const fixture = await makeRepo();
      await fixture.write(
        "wastech-mdlint.config.json",
        `${JSON.stringify({ rules: [] })}\n`,
      );
      await fixture.write("docs/a.md", "# A\n\n[missing](nowhere.md)\n");
      fixture.commit("base");
      fixture.git("checkout", "-q", "-b", "feature");
      await fixture.write(
        "wastech-mdlint.config.json",
        `${JSON.stringify({ rules: [{ rule: "REF-001" }] })}\n`,
      );

      const reported = async (cwd: string) => {
        const result = await analysis(cwd, fixture.env);
        if ("available" in result) {
          throw new Error(result.message);
        }
        return {
          config: result.review.config?.path,
          configChanged: result.review.set.configChanged,
          messages: sinceLintResult(result).messages.map(
            (message) => `${message.filePath} ${message.ruleId}`,
          ),
        };
      };
      expect(await reported(fixture.repo)).toEqual({
        config: "wastech-mdlint.config.json",
        configChanged: true,
        messages: ["docs/a.md REF-001"],
      });
      expect(await reported(path.join(fixture.repo, "docs"))).toEqual({
        config: "../wastech-mdlint.config.json",
        configChanged: true,
        messages: ["a.md REF-001"],
      });
    },
    TIMEOUT_MS,
  );

  it(
    "answers why there is nothing to compare rather than reporting a clean branch",
    async () => {
      const fixture = await linkBranch();
      const result = await analysis(
        fixture.repo,
        fixture.env,
        "no-such-branch",
      );
      expect(result).toMatchObject({
        available: false,
        reason: "base-not-found",
      });
    },
    TIMEOUT_MS,
  );
});
