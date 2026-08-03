# P12.01 · End-to-end `exclude` coverage across the rule families

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**. Audit finding **L-4** (root cause of M-2, [post-P9 audit](../audit-2026-07-25-post-p9.md)). Depends on [P11.05](../P11-remediation/05-table-primitive-scope.md), [P11.08](../P11-remediation/08-init-exclude-anchoring.md).

## Goal

The shared `exclude` option must have end-to-end coverage on every rule family that accepts it. Its **zero** e2e coverage is exactly why M-2 (`columnUnique` ignoring `exclude`) shipped — this task is the cheapest prevention of that whole class.

## Problem (from the audit)

`grep -c exclude` across `rules-tbl`, `rules-sec`, `rules-ctx`, `rules-ref`, `rules-grp`, `rules-str`, `rules-custom`, and `primitives.test.ts` returns **0 in all eight**. The only unit test of the helper (`rule-utils.test.ts:12-19`) checks `exclude` **together with** `files` — the working combination — so the broken `exclude`-only path was never exercised. `exclude` is part of the shared file-scope shape used across the rule families, so a gap in one path (M-2) implies untested siblings.

## Deliverables / steps

1. Add a focused fixture + test per rule family that honors the shared file-scope shape, asserting that a matching `exclude` (with **and** without `files`) removes the excluded document from that rule's findings. Cover at least: `TBL-006`/`columnUnique`, the `SEC`/`STR` project rules, the `REF` project rules, `GRP-002`, `CTX-003`, and a declarative `custom` rule using each affected primitive.
2. Include the `exclude`-only case explicitly (no `files`) — that is the M-2 shape and must now pass given [P11.05](../P11-remediation/05-table-primitive-scope.md).
3. Keep fixtures small and per-behavior (repo testing rules) so a failure points at one rule's scope handling, not a repo snapshot.

## Out of scope

Fixing scope bugs themselves — those are P11 tasks; this task assumes they landed and locks the behavior in. New `exclude` semantics beyond what the shared shape already defines.

## Exit criteria

- [x] Every rule family that accepts the file-scope shape has an `exclude` e2e test, including the `exclude`-only (no `files`) case.
- [x] The tests fail against the pre-P11.05 behavior and pass against the fix.
- [x] `npm run typecheck && npm test` green.

## Implementation notes

- **Three contradictions with the task text, resolved rather than guessed.**
  - **STR-001 has no file scope.** Its options schema is `{ files }`, `.strict()`, with no `exclude`: `files` is the _required-file set_ ([P11.12](../P11-remediation/12-str001-reach.md)), not a filter. So "the `SEC`/`STR` project rules" maps to **SEC-003** only, and STR-001 is covered by a negative test (`exclude` ⇒ `INVALID_OPTIONS`) so "every family" stays honest about the family that has no such option.
  - **REF-001/REF-003's `exclude` is a different option with the same name.** It filters the link/image _target_ about to be probed (`primitives/reference.ts`), not the source document. Both meanings are pinned — including a test that `options.exclude` and `assert.exclude` compose independently on a `custom` `linkResolves` rule — and the two rules are kept out of the file-scope matrix. Of the REF family only **REF-002** mixes in the shared shape; the other five reject `files` outright, which is what makes the pairing unambiguous.
  - **Coverage was no longer zero** when this task ran — the audit's `grep` predates [P11.05](../P11-remediation/05-table-primitive-scope.md) and [P11.13](../P11-remediation/13-grp-size-hygiene.md), which had already added the TBL-006, `columnUnique`, and GRP-002 exclude-only cases. Those were extended, not duplicated.
- **A new finding, fixed in-task with approval: `TBL-002` + `exclude` + `--fix` wrote into excluded files.** `applyFixes` (`engine/fix.ts`) applies no file scope of its own — it walks every loaded document and calls each hook — and a resolved rule's options are closed over by `resolveRule` before the runner sees them, so the runner _cannot_ gate on a hook's behalf. The guard therefore has to live in the hook, which is where `SEC-001` already had it; `TBL-002`'s `emptyCellEdits` read only `columns`/`section` and so rewrote `drafts/**` on disk while `check` skipped it. Fixed with a one-line `matchesFileScope` guard on the hook (the only product-code change in this task); TBL-002 and SEC-001 are the only two `fixable: true` rules, so this closes the family. Both directions are now tested: TBL-002's as a regression, SEC-001's as the passing counterpart that documents the pattern.
- **Which criteria are actually sensitive to P11.05, verified rather than assumed.** Temporarily restoring the pre-P11.05 precondition (`options.files !== undefined &&`) in `columnUnique` turns exactly three tests red: the existing `primitives.test.ts` and `rules-tbl.test.ts` exclude-only cases, plus this task's new `custom` `columnUnique` case. Everything else stays green, because the document-scope rules were never broken by M-2 — their matrices are **prevention**, not regression reproduction, and the TBL-002 `--fix` test is a regression test for a _new_ finding (it fails against `main`, independent of P11.05). The temporary edit was reverted; `table.ts` is unchanged by this task.
- **Drift guard.** `registry-inventory.test.ts` grew a `file-scope option inventory (L-4)` block that reads each rule's declared option keys the same way `generateConfigSchema` does (`z.toJSONSchema(...).properties`) and pins three sets: the 14 rules mixing in `fileScopeShape`, the two link-target `exclude` rules, and STR-001 as the only `files`-without-`exclude` rule. A new rule that opts into the shared shape fails there until its family test file gains an `exclude` case.
- **Known gap: the `custom` matrix has no equivalent CI guard.** Its case table is written `satisfies Record<Assertion["kind"], …>` with the intent that a 14th assert kind would fail typechecking, but that guard does **not** run: `npm run typecheck` is `tsc -b`, and each package's tsconfig `include` covers `src/**` only, so no test file is ever type-checked (Vitest transpiles without checking). A new assert kind would therefore ship with no `exclude` coverage and nothing would go red — the same L-4 shape this task exists to prevent. Converting the annotation into a runtime key-set assertion against `ASSERTION_TARGETS` (and dropping the `as const`, which makes the nested literals `readonly` and so would not satisfy `Assertion`'s mutable arrays if the file ever were checked) is the honest fix, left as follow-up because it is a test change beyond this task's own matrix.
- **No public surface moved**, as expected: no export, rule-metadata, or options-schema change, so `packages/cli/schema.json` and the generated README tables are byte-identical and the `docs-sync` / `schema-generation` tests did not move.
