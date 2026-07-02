# P6.01 · Repo scan — doc clusters + package-manager detection

> Phase: [P6 — init](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.

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

## Exit criteria

- [ ] Clusters detected across common + custom layouts; monorepo-aware.
- [ ] Package manager detected from lockfiles.

## Hand-off to next

P6.02 samples files from the detected clusters and infers which rule categories fit.
