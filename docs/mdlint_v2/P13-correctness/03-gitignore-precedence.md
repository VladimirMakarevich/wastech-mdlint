# P13.03 · `.gitignore` layer precedence is root-first-wins

> Phase: [P13 — Correctness](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Not started**. Backlog: [W-11](../remediation-backlog-2026-08-05.md) (Medium). Sources: audit F9 (MEDIUM; reproduced against real `git` in the audit and again in its QA pass). Depends on [P12](../P12-consistency/index.md).

## Goal

Make `respectGitignore: true` mean what its name says: the corpus matches what `git` actually tracks, including when a nested `.gitignore` re-includes a file a root pattern excluded.

## Problem

[`packages/core/src/discovery/gitignore-layers.ts`](../../../packages/core/src/discovery/gitignore-layers.ts) around `:42` iterates layers from the repository root downward and returns `true` at the first layer that ignores. Git's rule is the opposite: the **deeper** `.gitignore` takes precedence, so a nested `!keep.md` cannot re-include a file a root pattern ignored.

The failure direction is **under-reporting** — the linter silently drops a file real `git` keeps. Reproduced against real `git`: with root `*.md` and `docs/.gitignore` holding `!keep.md`, `git check-ignore -q docs/keep.md` exits `1` (not ignored) and `git status --ignored` lists only `docs/other.md`, while the linter's corpus was empty. Moving the negation into the root file made both agree.

**One implementation, two consumers, consistently wrong together.** The shared matcher is stated as such at `gitignore-layers.ts:6`, and `isGitIgnored` has exactly two call sites — the corpus walk and `init`'s pre-config scan. That is the good news: there is one place to fix. The within-file half of git's semantics **is** correct, which is exactly what [`glossary.md`](../glossary.md) carefully claims and no more.

**The field test is not counter-evidence.** It reported `respectGitignore` as honoring nested `.gitignore` files perfectly — but its target's five nested negations were all `.vscode/*.json` and `/build/.npmkeep`, no Markdown, so the re-inclusion case was never presented. A clean bill on a case the corpus does not contain is not a passing test.

## Deliverables / steps

1. **Evaluate layers deepest-first and stop at the first layer with an opinion.** This needs the `ignore` package's three-state `test()` (which distinguishes "ignored", "unignored", and "no opinion") rather than the boolean `ignores()` currently used — so it is deliberately **not** a one-line change, and the task is sized accordingly.
2. **Keep the single-matcher property.** Both call sites must continue to share one implementation; do not fix the corpus walk and leave `init`'s scan on the old semantics, or `init` will write a config that disagrees with the linter that reads it.
3. **Fixture, in both directions.** A nested Markdown re-inclusion must agree with `git check-ignore`, and so must the case where a nested pattern _adds_ an ignore the root did not have. Assert against real `git` output rather than against a hand-written expectation, so the fixture stays honest if `git`'s behavior is ever misremembered.
4. **Documentation.** `docs/guide/configuration.md:48` currently sells `respectGitignore` with no caveat. Either this fix removes the need for one, or the residual caveat lands there — not in a task file.
5. **Glossary.** The `respectGitignore` entry describes the loader default and `init`'s behavior; extend it with the layer-precedence rule now that it is a stated contract rather than an accident.

## Out of scope

Making `respectGitignore` default to `true` — that decision belongs to [P13.02](02-default-exclude.md), which owns the defaults. Supporting `.git/info/exclude` or a global core.excludesFile: neither is claimed anywhere, and adding them would widen the contract this task exists to make honest.

## Exit criteria

- [ ] A fixture with a nested Markdown re-inclusion agrees with `git check-ignore` in both directions.
- [ ] A nested pattern that adds an ignore still works — the fix must not invert into over-inclusion.
- [ ] Both call sites (corpus walk, `init` scan) go through the same matcher, asserted rather than assumed.
- [ ] `docs/guide/configuration.md` either needs no caveat or states the one that remains.
- [ ] The glossary's `respectGitignore` entry states the precedence rule.
- [ ] Gates green.
