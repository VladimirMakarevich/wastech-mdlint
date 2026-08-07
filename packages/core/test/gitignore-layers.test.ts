import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ignore from "ignore";
import { afterEach, describe, expect, it } from "vitest";

import { compareStrings } from "../src/deterministic-sort.js";
import {
  isGitIgnored,
  type IgnoreLayer,
} from "../src/discovery/gitignore-layers.js";
import { scanRepository } from "../src/discovery/repo-scan.js";
import { loadDocuments } from "../src/markdown/load-documents.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { recursive: true, force: true })),
  );
});

async function createFixtureTree(
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wastech-mdlint-gitign-"));
  tempDirs.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }

  return root;
}

function layer(baseRel: string, patterns: string): IgnoreLayer {
  return { baseRel, ig: ignore().add(patterns) };
}

describe("isGitIgnored · layer precedence (W-11)", () => {
  it("lets the deepest layer's negation re-include a file a root pattern ignored", () => {
    // The W-11 bug itself: the old root-first loop returned at `docs/*.md` and never reached the
    // nested negation, so the corpus dropped a file `git check-ignore` reports as kept.
    const layers = [layer("", "docs/*.md\n"), layer("docs", "!keep.md\n")];

    expect(isGitIgnored("docs/keep.md", false, layers)).toBe(false);
    expect(isGitIgnored("docs/other.md", false, layers)).toBe(true);
  });

  it("lets the deepest layer's positive rule win over an ancestor negation", () => {
    const layers = [
      layer("", "*.md\n!secret.md\n"),
      layer("notes", "secret.md\n"),
    ];

    expect(isGitIgnored("notes/secret.md", false, layers)).toBe(true);
  });

  it("ignores a file a nested layer adds a rule for and the root never mentioned", () => {
    // The over-inclusion direction: reversing the walk must not turn "the root said nothing" into
    // "nothing is ignored".
    const layers = [layer("", "*.tmp\n"), layer("notes", "secret.md\n")];

    expect(isGitIgnored("notes/secret.md", false, layers)).toBe(true);
    expect(isGitIgnored("notes/public.md", false, layers)).toBe(false);
  });

  it("falls through to the parent when the deepest layer has rules but no opinion", () => {
    // "First layer with an *opinion*", not "first layer": `*.tmp` matches nothing here, so the
    // root's verdict still stands. This is the case the boolean `ignores()` could not express.
    const layers = [layer("", "*.md\n"), layer("docs", "*.tmp\n")];

    expect(isGitIgnored("docs/a.md", false, layers)).toBe(true);
  });

  it("resolves three levels of layers deepest-first", () => {
    const layers = [
      layer("", "top.md\n"),
      layer("guides", "*.md\n"),
      layer("guides/deep", "!*.md\n"),
    ];

    expect(isGitIgnored("guides/a.md", false, layers)).toBe(true);
    expect(isGitIgnored("guides/deep/b.md", false, layers)).toBe(false);
  });

  it("keeps a file whose excluded ancestor directory a deeper layer re-included", () => {
    // The subtree form of the same bug, and the one a single layer's `test()` cannot get right: the
    // root excludes the *directory* `artifacts/docs` (`artifacts/*` does not cross `/`, so it never
    // matches the file), and `artifacts/.gitignore` re-includes it. Real `git` keeps the file — it
    // resolves the ancestor across all three lists, while `Ignore.test()` re-applied the root
    // layer's own directory exclusion to a parent the deeper layer had already un-ignored.
    const layers = [layer("", "artifacts/*\n"), layer("artifacts", "!docs/\n")];

    expect(isGitIgnored("artifacts/docs", true, layers)).toBe(false);
    expect(isGitIgnored("artifacts/docs/one.md", false, layers)).toBe(false);
    expect(isGitIgnored("artifacts/other.md", false, layers)).toBe(true);
  });

  it("still refuses to re-include under an ancestor no deeper layer rescued", () => {
    // Git's "cannot re-include under an excluded parent" rule, now decided here rather than left to
    // the walks pruning before descent: the per-path verdict has to hold on its own, or the function
    // answers one way for the directory and the other way for the files inside it.
    const layers = [layer("", "generated/\n"), layer("generated", "!*.md\n")];

    expect(isGitIgnored("generated", true, layers)).toBe(true);
    expect(isGitIgnored("generated/x.md", false, layers)).toBe(true);
    expect(isGitIgnored("generated/deep/x.md", false, layers)).toBe(true);
  });

  it("resolves an ancestor whose name reads as a glob as its literal self", () => {
    // Suppressing a layer's inherited ancestor verdict is expressed by *depth*, never by splicing a
    // directory's name into pattern text. A name-based negation for `a[b]/` would be read as a
    // character class and match `ab/` instead, silently restoring the drop this fixture pins.
    const layers = [layer("", "a\\[b\\]/*\n"), layer("a[b]", "!docs/\n")];

    expect(isGitIgnored("a[b]/other.md", false, layers)).toBe(true);
    expect(isGitIgnored("a[b]/docs/one.md", false, layers)).toBe(false);
  });

  it("treats the array order as the precedence contract: outermost first", () => {
    // Pins the reversal rather than leaving it incidental. The same two rule sets in the opposite
    // array order must produce the opposite verdict — which is why `IgnoreLayer` documents the order
    // its producers must build, and why neither walk may sort or dedupe on the way in.
    const outermostFirst = [
      layer("", "docs/*.md\n"),
      layer("docs", "!keep.md\n"),
    ];
    const reversed = [...outermostFirst].reverse();

    expect(isGitIgnored("docs/keep.md", false, outermostFirst)).toBe(false);
    expect(isGitIgnored("docs/keep.md", false, reversed)).toBe(true);
  });

  it("queries directories with a trailing slash so directory-only patterns match", () => {
    const layers = [layer("", "node_modules/\n")];

    expect(isGitIgnored("node_modules", true, layers)).toBe(true);
    // A *file* literally named `node_modules` is not what `node_modules/` matches.
    expect(isGitIgnored("node_modules", false, layers)).toBe(false);
  });

  it("skips a layer that governs a different subtree", () => {
    const layers = [layer("", "*.md\n"), layer("other", "!a.md\n")];

    expect(isGitIgnored("docs/a.md", false, layers)).toBe(true);
  });

  it("skips a layer whose own directory is the path being tested", () => {
    // `ignore`'s `test()` throws on an empty path, so "nothing left to test" has to be filtered out
    // before the matcher sees it rather than handed over as "".
    expect(() => isGitIgnored("", true, [layer("", "*\n")])).not.toThrow();
    expect(isGitIgnored("", true, [layer("", "*\n")])).toBe(false);
    expect(isGitIgnored("docs", true, [layer("docs", "*\n")])).toBe(false);
  });
});

// Explicit argv lists and no shell, per `.agents/rules/security.md` (Command Execution). `git`
// resolves through PATH (+PATHEXT on Windows) without one.
function runGit(
  root: string,
  args: string[],
  input?: string,
): { status: number | null; stdout: string } {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: gitEnv(root),
    ...(input === undefined ? {} : { input }),
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout };
}

// Neutralize every ignore source outside the fixture's own `.gitignore` files, so the oracle answers
// the same question the matcher does. A developer's global `core.excludesFile` — or an inherited
// GIT_DIR from a wrapper — would otherwise make the two disagree for reasons the fixture cannot see.
// GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM pointed at absent paths read as empty (git >= 2.32). The
// absent paths live beside the fixture, not inside it, so they can never appear in a walk.
function gitEnv(root: string): NodeJS.ProcessEnv {
  const absent = `${root}-absent`;
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return {
    ...env,
    GIT_CONFIG_GLOBAL: `${absent}-global`,
    GIT_CONFIG_SYSTEM: `${absent}-system`,
    GIT_CONFIG_NOSYSTEM: "1",
    XDG_CONFIG_HOME: `${absent}-xdg`,
  };
}

// Presence *and* a version floor. The oracle block has two implicit ones: `gitEnv` relies on
// GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM pointed at absent paths reading as empty (git >= 2.32), and
// `gitPatternIgnored` relies on `check-ignore` naming an ancestor directory's pattern. On an older
// `git` a contributor should get a skip, not an assertion diff caused by their own global
// `core.excludesFile` leaking into the fixture.
const MIN_GIT = [2, 32] as const;

const hasGit = (() => {
  const probe = spawnSync("git", ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.error || probe.status !== 0) {
    return false;
  }
  // `git version 2.51.0` on every platform; Apple's build appends ` (Apple Git-154)`, which the
  // leading-numbers match ignores.
  const version = /(\d+)\.(\d+)/.exec(probe.stdout);
  if (version === null) {
    return false;
  }
  const [major, minor] = [Number(version[1]), Number(version[2])];
  return major > MIN_GIT[0] || (major === MIN_GIT[0] && minor >= MIN_GIT[1]);
})();

async function initGitRepo(root: string): Promise<void> {
  const init = runGit(root, ["init", "-q"]);
  if (init.status !== 0) {
    throw new Error(`git init failed with status ${String(init.status)}`);
  }
  // `--exclude-standard` reads `.git/info/exclude`, which `git init` seeds from the template with a
  // comment-only file — truncating it removes even the possibility of a template-dependent verdict.
  const infoDir = path.join(root, ".git", "info");
  await mkdir(infoDir, { recursive: true });
  await writeFile(path.join(infoDir, "exclude"), "", "utf8");
}

// Splits git's `-z` output. `-z` avoids git's path quoting for non-ASCII/space-bearing names, and
// git always emits `/` separators, so no separator normalization is needed on Windows.
function splitNulSeparated(stdout: string): string[] {
  return stdout.split("\0").filter((entry) => entry.length > 0);
}

/**
 * The corpus oracle: which Markdown files does `git` itself keep. Nothing in the fixtures is ever
 * `git add`ed, so every kept file is an "other" and this is the complete kept set.
 */
function gitKeptMarkdown(root: string): string[] {
  const result = runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  if (result.status !== 0) {
    throw new Error(`git ls-files failed with status ${String(result.status)}`);
  }
  return splitNulSeparated(result.stdout)
    .filter((file) => file.endsWith(".md"))
    .sort(compareStrings);
}

/**
 * The per-path pattern oracle the phase file names. One spawn for the whole candidate list via
 * `--stdin`; the output names only the paths git considers ignored.
 */
function gitPatternIgnored(root: string, candidates: string[]): string[] {
  const result = runGit(
    root,
    ["check-ignore", "--no-index", "--stdin", "-z"],
    candidates.join("\0"),
  );
  // 0 = at least one path is ignored, 1 = none are, 128 = a real error. Treating anything else as
  // "not ignored" is how a broken invocation would silently pass, so it throws instead.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `git check-ignore failed with status ${String(result.status)}`,
    );
  }
  return splitNulSeparated(result.stdout).sort(compareStrings);
}

// Every fixture directory name avoids DEFAULT_NOISE_DIR_NAMES and the dot-prefix prune
// (discovery/repo-scan-constants.ts), so `scanRepository` sees the same tree `loadDocuments` does.
const FIXTURE_A = {
  ".gitignore": "docs/*.md\n",
  "top.md": "# Top\n",
  "docs/.gitignore": "!keep.md\n",
  "docs/keep.md": "# Keep\n",
  "docs/other.md": "# Other\n",
  "docs/deep/.gitignore": "*.tmp\n",
  "docs/deep/nested.md": "# Nested\n",
  "notes/.gitignore": "secret.md\n",
  "notes/secret.md": "# Secret\n",
  "notes/public.md": "# Public\n",
  "guides/.gitignore": "*.md\n",
  "guides/a.md": "# A\n",
  "guides/deep/.gitignore": "!*.md\n",
  "guides/deep/b.md": "# B\n",
};

// A root pattern that excludes a *directory* two different ways, each re-included by a nested
// `.gitignore`, plus one Markdown file the root exclusion does reach directly.
const FIXTURE_SUBTREE = {
  ".gitignore": "artifacts/*\ndocs/generated/\n",
  "artifacts/.gitignore": "!docs/\n",
  "artifacts/docs/one.md": "# One\n",
  "artifacts/other.md": "# Other\n",
  "docs/.gitignore": "!generated/\n",
  "docs/generated/two.md": "# Two\n",
  "docs/generated/sub/three.md": "# Three\n",
  "docs/ok.md": "# OK\n",
  "top.md": "# Top\n",
};

function markdownCandidates(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((file) => file.endsWith(".md"))
    .sort(compareStrings);
}

const FIXTURE_A_CANDIDATES = markdownCandidates(FIXTURE_A);
const FIXTURE_SUBTREE_CANDIDATES = markdownCandidates(FIXTURE_SUBTREE);

async function loadedMarkdown(root: string): Promise<string[]> {
  const documents = await loadDocuments(["**/*.md"], {
    cwd: root,
    respectGitignore: true,
    // `git` never lists `.git`'s own contents either; excluding it keeps the comparison honest
    // rather than relying on that directory happening to hold no Markdown.
    exclude: ["**/.git/**"],
  });
  return [...documents.values()].map((document) => document.path);
}

// Asserted against real `git` rather than a hand-written expectation (phase task deliverable 3), so
// the fixture stays honest if git's precedence is ever misremembered. Skipped without `git` on PATH;
// CI has it on all three legs via `actions/checkout`, and the unit block above covers the rule.
describe.skipIf(!hasGit)(
  "gitignore layers agree with real git (requires git on PATH)",
  () => {
    it("matches git on every direction of layer precedence", async () => {
      const root = await createFixtureTree(FIXTURE_A);
      await initGitRepo(root);

      const loaded = await loadedMarkdown(root);

      expect(loaded).toEqual(gitKeptMarkdown(root));
      expect(
        FIXTURE_A_CANDIDATES.filter((file) => !loaded.includes(file)),
      ).toEqual(gitPatternIgnored(root, FIXTURE_A_CANDIDATES));

      // Anti-vacuity: a fixture that failed to write would leave both sides empty and pass. Naming
      // the re-included file pins the actual W-11 case rather than mere agreement.
      expect(loaded).toContain("docs/keep.md");
      expect(loaded).toContain("guides/deep/b.md");
      expect(loaded).not.toContain("docs/other.md");
      expect(loaded).not.toContain("notes/secret.md");
      expect(loaded.length).toBe(5);
    });

    it("matches git when a nested negation sits under an excluded parent", async () => {
      // Git cannot re-include a file whose parent directory is excluded, and no *deeper* layer
      // rescues `generated/` here, so the exclusion stands and the nested `!*.md` cannot bring the
      // file back. Verified against both oracles — `git check-ignore` does report the ancestor
      // `generated/` as the deciding pattern for `generated/x.md`, so it is a valid oracle here too,
      // not only `ls-files`.
      const root = await createFixtureTree({
        ".gitignore": "generated/\n",
        "generated/.gitignore": "!*.md\n",
        "generated/x.md": "# X\n",
        "docs/ok.md": "# OK\n",
      });
      await initGitRepo(root);

      const candidates = ["docs/ok.md", "generated/x.md"];
      const loaded = await loadedMarkdown(root);

      expect(loaded).toEqual(["docs/ok.md"]);
      expect(loaded).toEqual(gitKeptMarkdown(root));
      expect(candidates.filter((file) => !loaded.includes(file))).toEqual(
        gitPatternIgnored(root, candidates),
      );
    });

    it("matches git when a deeper layer re-includes an excluded parent directory", async () => {
      // The subtree half of precedence, which is where the ancestor question stops being a walk
      // detail and becomes the matcher's: the root excludes a *directory* and a nested `.gitignore`
      // re-includes it, so git keeps the files inside — no pattern matches them directly, since
      // `artifacts/*` does not cross `/` and `!docs/` is directory-only. Both spellings of the root
      // exclusion are here (the wildcard form and the anchored `dir/` form) because they reach the
      // file through different patterns, and `docs/generated/sub/` pins that it holds at any depth.
      const root = await createFixtureTree(FIXTURE_SUBTREE);
      await initGitRepo(root);

      const loaded = await loadedMarkdown(root);

      expect(loaded).toEqual(gitKeptMarkdown(root));
      expect(
        FIXTURE_SUBTREE_CANDIDATES.filter((file) => !loaded.includes(file)),
      ).toEqual(gitPatternIgnored(root, FIXTURE_SUBTREE_CANDIDATES));

      // Anti-vacuity, as above: name the re-included files rather than trusting agreement alone.
      expect(loaded).toContain("artifacts/docs/one.md");
      expect(loaded).toContain("docs/generated/two.md");
      expect(loaded).toContain("docs/generated/sub/three.md");
      expect(loaded).not.toContain("artifacts/other.md");
      expect(loaded.length).toBe(5);
    });

    it("gives the pre-config scan the same corpus git keeps", async () => {
      // The behavioral half of the single-matcher criterion: `init`'s scan must not disagree with
      // the loader. `minClusterSize: 1` makes every directory qualify, so the union of the clusters'
      // samples covers the whole kept set (rollup keeps ancestors, so no path is counted twice).
      const root = await createFixtureTree(FIXTURE_A);
      await initGitRepo(root);

      const result = await scanRepository({
        cwd: root,
        minClusterSize: 1,
        sampleSize: 50,
      });
      const sampled = [
        ...new Set(result.clusters.flatMap((cluster) => cluster.sampleFiles)),
      ].sort(compareStrings);

      expect(sampled).toEqual(gitKeptMarkdown(root));
    });
  },
);

/**
 * Every workspace package's `src`, read from the workspace itself so the scan below grows with it. A
 * package without a `src` (a fixture or docs-only member) is skipped rather than crashing the walk.
 *
 * The `workspaces` declaration is asserted rather than expanded as globs: pinning it means a member
 * rooted anywhere but `packages/*` fails this test loudly, instead of leaving a package silently
 * unscanned — which is exactly the failure mode a hardcoded package list already had.
 */
async function workspaceSourceDirs(): Promise<string[]> {
  const rootManifest = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  ) as { workspaces?: string[] };
  expect(rootManifest.workspaces).toEqual(["packages/*"]);

  const packagesDir = path.join(repoRoot, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name, "src"))
    .filter((srcDir) => existsSync(srcDir))
    .sort(compareStrings);
}

// Repo-relative POSIX paths so a failure message reads the same on every host.
async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(absolutePath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path.relative(repoRoot, absolutePath).replaceAll("\\", "/"));
    }
  }

  return files.sort(compareStrings);
}

describe("gitignore matching has exactly one implementation", () => {
  // The structural half of the same criterion, asserted rather than assumed (phase task deliverable
  // 2): a second matcher in either walk would let `init` propose an `include` for a tree the config
  // it writes then refuses to lint. Substring checks so reformatting the multi-line import — which
  // Prettier does on its own — cannot fail this.
  const callSites = [
    "packages/core/src/markdown/load-documents.ts",
    "packages/core/src/discovery/repo-scan.ts",
  ];

  for (const callSite of callSites) {
    it(`routes ${callSite} through the shared matcher`, () => {
      const source = readFileSync(path.join(repoRoot, callSite), "utf8");

      expect(source).toContain("gitignore-layers.js");
      expect(source).toContain("isGitIgnored(");
      expect(source).not.toContain('from "ignore"');
    });
  }

  it("has no third call site anywhere in the workspace's product code", async () => {
    // Pins the *set*, not just its members: the loop above only checks what it lists, so a third
    // consumer could otherwise appear untested. Scanning every workspace package's `src` — derived
    // from the workspace, not listed here — is what makes "exactly two call sites"
    // (gitignore-layers.ts's own stated premise) a claim that stays checked as packages are added.
    const consumers: string[] = [];

    for (const srcDir of await workspaceSourceDirs()) {
      for (const file of await collectSourceFiles(srcDir)) {
        const source = await readFile(path.join(repoRoot, file), "utf8");
        if (source.includes("isGitIgnored(")) {
          consumers.push(file);
        }
      }
    }

    expect(consumers.sort(compareStrings)).toEqual(
      // The matcher's own module declares it; the two walks call it.
      [...callSites, "packages/core/src/discovery/gitignore-layers.ts"].sort(
        compareStrings,
      ),
    );
  });
});
