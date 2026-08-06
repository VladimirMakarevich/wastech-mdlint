import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXCLUDE_GLOBS,
  DEFAULT_INCLUDE_GLOBS,
  resolveCorpusScope,
} from "../src/config/corpus-scope.js";
import { compareStrings } from "../src/deterministic-sort.js";
import { matchesConfigGlob } from "../src/discovery/globs.js";
import { DEFAULT_NOISE_DIR_NAMES } from "../src/discovery/repo-scan-constants.js";

// The `__directory_probe__` form `shouldPruneDirectory` (`markdown/load-documents.ts`) uses to ask
// whether a *directory* is excluded before descending into it. Asserting both forms matters because
// the escape hatch only works at directory granularity: a negation that does not un-prune the
// directory can never rescue a file inside it, no matter what the file-level verdict says.
function directoryProbe(relativeDirectory: string): string {
  return `${relativeDirectory}/__directory_probe__`;
}

describe("DEFAULT_EXCLUDE_GLOBS", () => {
  // Reconstructed independently rather than imported from the production list — the same
  // reconstruction `config-writer.test.ts` already pins for what `init` writes. Two tests deriving
  // the same patterns from `DEFAULT_NOISE_DIR_NAMES` is what proves the "one list, reachable from
  // both `init` and lint" criterion without either test importing the other's expectation.
  it("is exactly the scan's noise names, depth-agnostic and sorted", () => {
    expect([...DEFAULT_EXCLUDE_GLOBS]).toEqual(
      DEFAULT_NOISE_DIR_NAMES.map((name) => `**/${name}/**`).sort(
        compareStrings,
      ),
    );
  });

  it("prunes a noise directory at any depth, not only at the root", () => {
    // The F-07 half of W-02: a root-anchored default would have left the nested copy — 2740 of the
    // field test's 3063 parsed files — in the corpus.
    for (const candidate of [
      "node_modules/pkg/README.md",
      "mobile/node_modules/leftpad/README.md",
      "packages/foo/dist/generated.md",
      // A hidden *dependency* tree is still excluded, but by name (`.venv` is in the noise list),
      // not by shape — which is the whole of W-15's answer.
      ".venv/lib/site-packages/README.md",
      directoryProbe(".venv"),
    ]) {
      expect(matchesConfigGlob(candidate, [...DEFAULT_EXCLUDE_GLOBS])).toBe(
        true,
      );
    }

    // W-15 (P14.03): a hidden directory that is *not* a dependency or build tree is no longer
    // excluded from the lint corpus merely for starting with a dot. `.claude/skills/` and
    // `.agents/rules/` were 31% of the field-test target's tracked Markdown.
    for (const candidate of [
      ".github/PULL_REQUEST_TEMPLATE.md",
      directoryProbe(".github"),
      ".agents/rules/testing.md",
      "packages/foo/.husky/NOTES.md",
      // A dot-prefixed *file* at the root was never a hidden directory, and still is not.
      ".README.md",
    ]) {
      expect(matchesConfigGlob(candidate, [...DEFAULT_EXCLUDE_GLOBS])).toBe(
        false,
      );
    }
  });
});

describe("resolveCorpusScope", () => {
  it("supplies every default for a config that names none", () => {
    expect(resolveCorpusScope({})).toEqual({
      include: [...DEFAULT_INCLUDE_GLOBS],
      exclude: [...DEFAULT_EXCLUDE_GLOBS],
      respectGitignore: false,
    });
  });

  it("appends a user exclude to the default rather than replacing it", () => {
    const scope = resolveCorpusScope({ exclude: ["drafts/**"] });

    // Default first, user last: a negation only subtracts from what precedes it, so this order is
    // what makes the escape hatch below work at all.
    expect(scope.exclude).toEqual([...DEFAULT_EXCLUDE_GLOBS, "drafts/**"]);
  });

  it("treats an empty exclude as no additions, not as an opt-out", () => {
    expect(resolveCorpusScope({ exclude: [] }).exclude).toEqual([
      ...DEFAULT_EXCLUDE_GLOBS,
    ]);
  });

  it("dedupes, so an init-written config resolves to exactly the default", () => {
    // `init` writes this very list. Without the dedupe every pattern would be compiled twice on
    // every path and directory the walk considers.
    const scope = resolveCorpusScope({ exclude: [...DEFAULT_EXCLUDE_GLOBS] });

    expect(scope.exclude).toEqual([...DEFAULT_EXCLUDE_GLOBS]);
  });

  it("keeps an explicit include and respectGitignore", () => {
    const scope = resolveCorpusScope({
      include: ["docs/**/*.md"],
      respectGitignore: true,
    });

    expect(scope.include).toEqual(["docs/**/*.md"]);
    expect(scope.respectGitignore).toBe(true);
  });

  it("returns fresh arrays so a caller cannot mutate the shared constants", () => {
    const scope = resolveCorpusScope({});
    scope.exclude.push("mutated/**");
    scope.include.push("mutated/**");

    expect(DEFAULT_EXCLUDE_GLOBS).not.toContain("mutated/**");
    expect(DEFAULT_INCLUDE_GLOBS).not.toContain("mutated/**");
  });

  it("lets a negated user entry un-exclude one default tree, directory probe included", () => {
    // The documented escape hatch for a project that really keeps docs under a `build/`. It must
    // hold for the directory probe too, or the tree is pruned before any file inside is judged.
    const scope = resolveCorpusScope({ exclude: ["!**/build/**"] });

    expect(matchesConfigGlob("build/x.md", scope.exclude)).toBe(false);
    expect(matchesConfigGlob(directoryProbe("build"), scope.exclude)).toBe(
      false,
    );
    expect(matchesConfigGlob("packages/foo/build/x.md", scope.exclude)).toBe(
      false,
    );
    // Nothing else is loosened.
    expect(matchesConfigGlob("node_modules/pkg/README.md", scope.exclude)).toBe(
      true,
    );
    expect(
      matchesConfigGlob(directoryProbe("node_modules"), scope.exclude),
    ).toBe(true);
  });

  it("lets `!**` disable the default wholesale", () => {
    const scope = resolveCorpusScope({ exclude: ["!**"] });

    expect(matchesConfigGlob("node_modules/pkg/README.md", scope.exclude)).toBe(
      false,
    );
    expect(
      matchesConfigGlob(directoryProbe("node_modules"), scope.exclude),
    ).toBe(false);
  });

  it("cannot rescue a single file from inside a default-excluded directory", () => {
    // Accepted limitation (P13.01): the negation has to name the *directory*, because the walk
    // prunes before descending. Pinned here so the guide's advice and the behavior stay one thing.
    const scope = resolveCorpusScope({ exclude: ["!**/vendor/keep.md"] });

    expect(matchesConfigGlob("vendor/keep.md", scope.exclude)).toBe(false);
    expect(matchesConfigGlob(directoryProbe("vendor"), scope.exclude)).toBe(
      true,
    );
  });
});
