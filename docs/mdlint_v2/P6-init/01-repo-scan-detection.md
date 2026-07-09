# P6.01 · Repo scan — doc clusters + package-manager detection

> Phase: [P6 — init](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Give `init` the situational awareness to propose good defaults: where the docs are and which
package manager the repo uses.

## Sequence

- **Previous:** [P3.09 — Rule tests & cutover](../P3-rules/09-rule-tests-and-cutover.md)
  (the rule set `init` will choose from).
- **Next:** [P6.02 — Rule inference](02-rule-inference.md).
- **Depends on:** P3 done (rules/categories exist) · **Blocks:** P6.02.

## Deliverables / steps

1. Scan for doc clusters using the scoring heuristic below; boost known layouts (as a *bonus*,
   not a filter), handle monorepos — **don't** hardcode `docs/` ([I2](../requirements/06-installation.md)).
2. Detect the package manager from lockfiles (bun > pnpm > yarn > npm).
3. Return a structured scan result (clusters + sample file candidates + detected manager).

## Cluster scoring heuristic (decided 2026-07-02, audit 5.4)

Deterministic; constants are defaults (tunable). `init` is interactive, so this only *proposes*
`include` globs — the user confirms in [P6.03](03-interactive-prompts.md).

```
KNOWN = { docs, documentation, doc, specs, spec, adr, rfc, rfcs, references, reference, guides }
NOISE = { node_modules, .git, dist, build, out, coverage, vendor, .next, .cache, target }
N_MIN = 3   // "enough Markdown files" to count as a cluster

1. Collect all *.md / *.mdx under the repo, skipping NOISE dirs.
2. For each directory that (directly or transitively) contains Markdown, compute:
     subtreeCount = # Markdown files in this dir's subtree
     score = subtreeCount
           + (basename(dir) in KNOWN ? N_MIN : 0)      // bonus, so a known dir qualifies at >=1 file
3. A directory QUALIFIES as a cluster if: subtreeCount >= N_MIN
     OR (basename(dir) in KNOWN and subtreeCount >= 1).
4. Roll up nested qualifiers: keep the highest ancestor that still scopes docs tightly; drop a
   child cluster whose files are already covered by a kept ancestor (avoid proposing both
   `docs/` and `docs/api/`).
5. Sort clusters by score desc, then path asc (deterministic tie-break). Scattered root-level
   files (README, CONTRIBUTING) surface as a low-priority root candidate; `**/*.md` stays the
   fallback.
```

**Monorepo handling:** detect workspaces via a `package.json` `workspaces` field,
`pnpm-workspace.yaml`, or multiple `package.json` under sibling `packages/*` / `apps/*`. When
detected, run steps 1–5 **per workspace package** (so `packages/foo/docs` groups with `foo`) and
at the repo root; tag each returned cluster with its owning package (if any).

## Decisions applied

- [I2](../requirements/06-installation.md) smart scanning (no hardcoded layout).

## Implementation notes

- A workspace package's scope excludes any file already claimed by a deeper nested workspace
  package (e.g. a detected `packages/foo/examples/bar`), so each Markdown file is owned by
  exactly one — the deepest matching — scope. Without this a nested package's files would be
  scanned twice: once under the ancestor's cluster and again under its own.
- Workspace glob declarations (`package.json#workspaces`, `pnpm-workspace.yaml`) must be matched
  as a whole list (`micromatch(list, patterns)`), not per-directory `isMatch()` — the latter
  checks each candidate independently against the pattern array, so an ordered exclusion like
  `["packages/*", "!packages/private"]` can never actually exclude anything. This required
  extending the repo's local `micromatch.d.ts` type shim with the list-form call signature,
  since no `@types/micromatch` package exists to declare it.
- The pnpm-workspace.yaml line parser accepts both indented and unindented `- glob` list items,
  quoted or bare, each optionally followed by a trailing `# comment` — real-world files commonly
  write entries this way, and a parser that rejects them would silently under-detect the
  monorepo. It is still deliberately narrow, not a general YAML parser: flow sequences
  (`packages: [a, b]`) and anchors remain unsupported (see the trade-off already called out
  above the parser in code).
- `detectWorkspacePackages(cwd)` keeps the single-argument signature this task's contract calls
  for and is the only barrel-exported surface from `@wastech-mdlint/core`. `scanRepository` needs
  a caller-overridden `noiseDirNames` to prune workspace-package discovery the same way it prunes
  the Markdown walk, but threading that knob onto the standalone function would leak a
  scanner-internal tuning parameter into the public API — so it lives on a second,
  non-barrel-exported `detectWorkspacePackagesWithNoise(cwd, noiseDirNames)` instead.
- Generated `includeGlob` values escape glob metacharacters in the literal directory path
  (`docs[x]`, `apps(web)`) using single-character bracket classes (`[x]`), not a backslash —
  `normalizeConfigGlob` (the shared glob-normalization helper) converts every `\` to `/` when
  normalizing Windows-style separators, so a backslash-escaped pattern would be silently
  unescaped before it ever reached the matcher.
- The `"fallback"` entry's `includeGlob` stays the literal `**/*.md`, deliberately not
  `.mdx`-aware like the rest of the scanner: it mirrors the tool's actual zero-config default
  (`lintFiles`/`fix`/`loadContext` all default `include` to `["**/*.md"]`), not the scan's own
  broader `.md`+`.mdx` discovery criteria. In a repo whose only Markdown is `.mdx`, this means the
  fallback's `sampleFiles` can include paths its own proposed glob won't match — an accepted,
  documented trade-off of proposing the tool's real default rather than a scan-specific one.
- `detectPackageManager`'s lockfile check uses `stat().isFile()`, not `access()` — `access()`
  only proves a path is reachable, so a directory (or a symlink to one) named `bun.lock` etc.
  would otherwise be misreported as that package manager.

## Exit criteria

- [x] Clusters detected across common + custom layouts; monorepo-aware.
- [x] Package manager detected from lockfiles.

## Hand-off to next

P6.02 samples files from the detected clusters and infers which rule categories fit.
