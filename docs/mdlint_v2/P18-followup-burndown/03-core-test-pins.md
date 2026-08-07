# P18.03 — Core behavior nothing currently proves

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Depends on [P18.02](02-code-fixes.md) (two of these pins describe behavior that task changes).
>
> Four gaps where a shipped behavior is carried only by a comment or by a single matcher-level test. Two of the six items originally grouped here are already closed: FU-21 asked for a fixture exercising a state the scan's registered dot-directory prune makes unreachable, and FU-23 was done in [P18.02](02-code-fixes.md) because it lives in the same file as FU-12 — see [the phase index](index.md).

## Problem

**FU-18 — `selectBranch`'s non-discriminated fallback has no test.** The fewest-issues fallback in `packages/core/src/config/config-issues.ts` (`branches.reduce((best, branch) => branch.length < best.length ? branch : best)`) is unreachable through `loadConfiguration` today: the only other union in the root schema is `assertionSchema`, a discriminated union whose no-match issue carries `errors: []` and is short-circuited by the `issue.errors.length > 0` guard in `collect`. [P13.06](../P13-correctness/06-config-diagnostics.md)'s notes state this; nothing pins it, so a future change can break the branch silently.

**FU-19 — the highest-impact half of the default exclude is pinned only at the matcher layer.** `**/.*/**` covers 31% of the field-test target's tracked corpus and this repository has the same shape, yet it is asserted only in `corpus-scope.test.ts`'s "prunes a noise directory at any depth, not only at the root". No test proves it prunes end-to-end through a corpus entry point, so a regression in the wiring would be caught for `node_modules` alone. This matters because [P14.03](../P14-host-boundary/03-init-disclosure.md) was chartered to revisit this glob: a pin is what makes such a change visible rather than silent.

**FU-20 — two call sites gained the resolved default scope with no test.** `applyFixes` (`packages/core/src/engine/fix.ts`) and `loadContext` (`packages/core/src/graph/load-context.ts`) both resolve the default scope now. So `--fix` no longer rewrites a document under a default-excluded tree, and `graph`/`slice`/`impact` answer over a narrower tree — two user-visible changes carried only by the comment "Same resolved scope as `lintFiles` (P13.02)". `lintFiles` is covered at two layers; these two at none.

**FU-22 — the count-mode walk is not compared against the corpus walk.** `repo-scan.ts` grew a `"count"` branch to size pruned hidden directories. Its own output is asserted, but nothing checks it against a real corpus walk over the same tree, so it can silently diverge from that walk's noise, gitignore and extension handling — the two would then disagree about how much Markdown a directory holds while both look green.

## Deliverables / steps

- [ ] **FU-18:** call `flattenConfigIssues` directly with a synthetic `invalid_union` issue whose path is not `["rules", n]`, asserting the fewest-issues branch is chosen; while there, assert an `errors: []` issue passes through with its own message.
- [ ] **FU-19:** add `".github/PR.md": "# PR\n"` to the fixture in `it("prunes the default noise trees when the config names no exclude")` in `packages/core/test/lint-files.test.ts`, keeping the assertion at `expect(result.files).toEqual(["docs/a.md"])`.
- [ ] **FU-20:** add a zero-config fixture in `packages/core/test/load-context.test.ts` with `docs/a.md` plus `node_modules/pkg/README.md`, asserting the returned `documents` keys hold only `docs/a.md`; and a `--fix` case alongside the existing `applyFixes` usage asserting a fixable document under `node_modules/` is left byte-unchanged.
- [ ] **FU-22:** add a regression test comparing count-mode output against a real corpus walk over the same fixture tree, including a gitignored subtree and a non-Markdown file so all three handling rules are in the comparison.

## Exit criteria

- [ ] Deleting the `selectBranch` fallback fails a test.
- [ ] Deleting `**/.*/**` from the default exclude fails a test at a corpus entry point, not only at the matcher.
- [ ] `--fix` and `loadContext` each have one test asserting the default scope applies to them.
- [ ] Count mode and the corpus walk are compared over one tree in one test.
