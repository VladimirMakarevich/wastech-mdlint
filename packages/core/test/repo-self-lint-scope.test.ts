import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveCorpusScope } from "../src/config/corpus-scope.js";
import { loadConfiguration } from "../src/config/load-config.js";
import { loadDocuments } from "../src/markdown/load-documents.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// A skip rather than a failure when `git` is missing: the oracle below is the tracked-file list, and
// a contributor without git installed should not see an assertion diff caused by their toolchain.
const hasGit = (() => {
  const probe = spawnSync("git", ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return !probe.error && probe.status === 0;
})();

// `-z` avoids git's quoting of non-ASCII and space-bearing names, and git always emits `/`
// separators, so no separator normalization is needed on Windows.
function trackedFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git ls-files failed with status ${String(result.status)}`);
  }
  return result.stdout.split("\0").filter((entry) => entry.length > 0);
}

function isSelfLintTarget(relPath: string): boolean {
  return (
    relPath === "README.md" ||
    (relPath.startsWith("docs/") && relPath.endsWith(".md"))
  );
}

// Reading and parsing the whole real corpus is seconds of work — several times the default per-test
// budget once the rest of the suite is running in parallel — so both directions below share one
// walk and both raise the budget. Shrinking the corpus to make it fast would defeat the point: the
// subject under test is the scope this repository actually lints.
const CORPUS_WALK_TIMEOUT_MS = 30_000;

// Compose the real lint path — load this repository's own config, resolve its corpus scope, walk it
// — so the assertions below see the same corpus a `lint` run does.
let selfLintCorpus: Promise<string[]> | undefined;

function loadSelfLintCorpus(): Promise<string[]> {
  selfLintCorpus ??= (async () => {
    const loaded = await loadConfiguration({ cwd: repoRoot });
    const scope = resolveCorpusScope(loaded.config);
    const documents = await loadDocuments(scope.include, {
      cwd: repoRoot,
      exclude: scope.exclude,
      respectGitignore: scope.respectGitignore,
    });
    return [...documents.values()].map((document) => document.path);
  })();
  return selfLintCorpus;
}

// This guards the one way the CI docs gate can rot without anyone noticing: a narrowed `include`.
// The gate is green when it analyzes nothing, so dropping half the corpus — a stray `exclude`, a
// pattern edited to `docs/mdlint_v2/**`, a `*.md` tail lost in a refactor — looks exactly like a
// clean run. Comparing against the tracked-file list in both directions is what makes the silence
// audible.
//
// Deliberately not tagged as one of the suite's process-boundary guards, even though its subject
// overlaps: that inventory is a paired set, and adding to it is a change to the guard categories
// themselves rather than to this file.
describe.skipIf(!hasGit)("repository self-lint scope", () => {
  it(
    "covers every tracked docs page and the README",
    async () => {
      const corpus = new Set(await loadSelfLintCorpus());
      const expected = trackedFiles().filter(isSelfLintTarget);

      // Guards against the config being read at all: an empty expectation would make this vacuous.
      expect(expected.length).toBeGreaterThan(100);
      expect(expected.filter((relPath) => !corpus.has(relPath))).toEqual([]);
    },
    CORPUS_WALK_TIMEOUT_MS,
  );

  it(
    "selects nothing outside the docs tree and the README",
    async () => {
      const corpus = await loadSelfLintCorpus();

      // Checked structurally rather than against git, so an untracked scratch file a contributor left
      // under `docs/` fails nobody's local run — the widening this direction exists to catch is a
      // pattern that reaches `packages/` or the repository's agent-instruction files, not a draft.
      expect(corpus.filter((relPath) => !isSelfLintTarget(relPath))).toEqual(
        [],
      );
    },
    CORPUS_WALK_TIMEOUT_MS,
  );

  it("points $schema at a local file that exists", async () => {
    const loaded = await loadConfiguration({ cwd: repoRoot });
    const schemaRef = loaded.config.$schema;

    expect(schemaRef).toBeTypeOf("string");
    // Schema resolution stays offline and version-matched; a URL here would validate this config
    // against whatever the network serves rather than the version installed in this checkout.
    expect(/^[a-z][a-z0-9+.-]*:/i.test(schemaRef!)).toBe(false);
    expect(existsSync(path.resolve(repoRoot, schemaRef!))).toBe(true);
  });
});
