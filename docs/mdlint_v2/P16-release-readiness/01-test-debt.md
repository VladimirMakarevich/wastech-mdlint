# P16.01 · Test debt: real scale, zero config, dot-directories, boundaries

> Phase: [P16 — Release readiness](index.md) · Roadmap: [v2 Index](../index.md) · Size **M–L** · Status **Not started**. Backlog: [W-57](../remediation-backlog-2026-08-05.md) (High), [W-58](../remediation-backlog-2026-08-05.md) (Medium), [W-56](../remediation-backlog-2026-08-05.md) (Low). Sources: the field test's own summary; the crosscheck's analysis of 16 missed defects; audit invariant 2; audit F14. Depends on [P13](../P13-correctness/index.md), [P14](../P14-host-boundary/index.md), [P15](../P15-output-contracts/index.md).

## Goal

Close the fixture gap that let three phases' worth of defects ship green. This is the phase's only preventive task: every other task fixes a defect, this one makes the class visible next time.

## Problem

**W-57 — no fixture is at real scale, on the zero-config path, or in a dot-directory.** The field test states it directly: the four findings that would change a user's first ten minutes "are all invisible to the in-repo suite for the same reason: no fixture has a nested `node_modules`, a dot-directory full of real documentation, a 96 KB document, or a hand-written glob."

The crosscheck generalizes it across the whole assessment. Of the 16 defects the deep audit missed entirely, **every one** falls into four buckets, and none is a random oversight:

| Cause | Why the in-repo method could not see it |
| --- | --- |
| **Fixture scale** | Fixtures were 3–6 files and compile output 1415 bytes. A 3.9 KB comma-joined line and a 110 KB `SKILL.md` that is 90% edge list are invisible below a few dozen documents |
| **Default quality, not doc conformance** | When code and documentation agree that an option is optional with no default, there is nothing to contradict — the defect exists only relative to what a user expects |
| **Zero-config and first-run paths** | Every reproduction supplied a config. The blocker and two majors live on `npx … lint .` and on `init` against a repository it did not design |
| **Process-boundary rendering and exit codes** | Nothing diffed human text against the structured payload, checked `init`'s refusal exit code, or sent an input the wire schema rejects |

**W-58 — nothing pins the ad-hoc MCP `lint` step order against `lintFiles`.** `handleLint` assembles, inside the host, the sequence `lintFiles` owns in core: parse, a synthetic one-document corpus, `runRules`, the inline-disable filter, the severity counts, core's text formatter. Every step composes a core export and every choice is justified in place — the audit judged it **within** the thin-adapter invariant, not a fork — but it is the one place the pipeline's order exists twice, and nothing pins the two together. The suppression step has its own test; there is no differential test. **A step added to `lintFiles` would silently not reach this tool.**

**W-56 — the documented build-before-test remedy does not always clear the spawn guard.** Both `installed-bin-spawn` guards compare modification times and tell the reader to run `npm run build` or `npm run typecheck`. Both are `tsc -b`, whose up-to-date decision is **content-aware** — so when a source file's timestamp moved but its content did not, `tsc -b` exits `0` without re-emitting, the comparison still fails, and the message names the command just run. Reachable via `git checkout --`, a stash pop, or a copy that resets timestamps. Reproduced independently in an isolated probe.

## Deliverables / steps

**Read this first: several of these guards are already required by the tasks that ship the fixes.** [P13.01](../P13-correctness/01-glob-semantics.md) carries the ordered-negation case, [P13.02](../P13-correctness/02-default-exclude.md) the `shared-exclude` no-config fixture, [P14.03](../P14-host-boundary/03-init-disclosure.md) the dot-directory `init` disclosure test, and [P15.01](../P15-output-contracts/01-renderers-at-scale.md) the large-corpus renderer bounds. This task's job is therefore **verify, then fill the gaps** — confirm each guard exists and actually fails before its fix (by reverting the fix locally), extend it where the earlier task's scope stopped short, and add what no fix-task owned: the corpus-versus-tracked-files comparison, the parity pattern in step 5, W-58 and W-56. Re-adding a guard that already exists is not the work; noticing a missing or toothless one is.

1. **A nested-`node_modules` fixture linted with no config.** `docs/a.md`, `mobile/node_modules/leftpad/README.md`, `node_modules/rightpad/README.md`. Covers [P13.02](../P13-correctness/02-default-exclude.md) and would have caught the blocker. Tag `@boundary-guard shared-exclude`.
2. **A dot-directory fixture run through `init` then `lint`**, with the corpus compared to a tracked-file list in **both** directions (nothing missing, nothing extra) — the `comm` comparison the field test used to account for its 63-file gap exactly. Covers [P14.03](../P14-host-boundary/03-init-disclosure.md).
3. **Large-corpus assertions for the two renderers:** a bound on the longest line of `graph --format human`, and a bound on the dependency section's share of a compiled skill. Covers [P15.01](../P15-output-contracts/01-renderers-at-scale.md) — which builds the generating fixture; adopt it here rather than writing a second one.
4. **Hand-written glob shapes**, including the four in the field test's anchoring table (`NOTE.md`, `*.md`, `./NOTE.md`, `node_modules/**`) and an **ordered negation**. Covers [P13.01](../P13-correctness/01-glob-semantics.md) and [P13.05](../P13-correctness/05-reference-resolution.md).
5. **A human-versus-structured diff, as a pattern rather than one test.** For each user-facing surface, assert the human rendering against the structured payload and each host's rendering against the other's. This is the crosscheck's second recommendation and the thing that would have caught the dropped `hint`, the `json` collision, and the missing `excluded` field in one pass.
6. **W-58:** add a differential test asserting `handleLint` and `lintFiles` agree on the same content, **or** hoist an "ad-hoc lint" entry point into core — which is where the audit says the seam would pay for itself. Prefer the second if the diff is more than a few lines, since a differential test over a hand-assembled sequence rots as the sequence grows.
7. **W-56:** compare build **state** rather than timestamps in `assertBuilt` (two sites: [`packages/cli/test/bin.e2e.test.ts`](../../../packages/cli/test/bin.e2e.test.ts), [`packages/mcp-server/test/bin-entrypoint.test.ts`](../../../packages/mcp-server/test/bin-entrypoint.test.ts)), **or** name `tsc -b --force` in the failure message **and** in [`.agents/rules/testing.md`](../../../.agents/rules/testing.md) `:68`. A message that names a command which does not fix the problem is worse than no message.
8. **Tag every new process-boundary guard** with its `@boundary-guard <category>` comment, and if a new category is needed, add it to **both** [`.agents/rules/testing.md`](../../../.agents/rules/testing.md)'s table and [`packages/core/test/boundary-guards.test.ts`](../../../packages/core/test/boundary-guards.test.ts)'s inventory — the testing rules state that the table half is discipline rather than enforcement, so the inventory is what actually holds.
9. **Remember the two gate facts** these tests live under: build before test (the spawn suites assert against `dist/`), and test files are never type-checked, so a coverage guard must be a runtime assertion, not a `satisfies` constraint.

## Out of scope

A second external-repository field test. The existing one exercised one macOS target; repeating it is not a fixture. Turning any of these into a CI-only job: they must run in the ordinary suite, or they will be the next thing nobody runs.

## Exit criteria

- [ ] Each of W-01, W-02, W-14, W-26, W-27 has a test that **fails before its fix** — verified by reverting each fix locally, not asserted. Where the fix's own task already landed that guard, this is a verification with a stated result, not a second guard.
- [ ] The no-config nested-`node_modules` fixture and the dot-directory `init` fixture both exist, the second comparing the corpus to a tracked-file list in both directions.
- [ ] The glob table's four shapes plus an ordered negation are covered.
- [ ] At least one surface has a human-versus-structured parity assertion, written as a reusable pattern.
- [ ] `handleLint` and `lintFiles` are pinned together, or the shared entry point is in core.
- [ ] The stale-build message names a command that actually clears the guard, in the test and in the testing rules.
- [ ] Every new boundary guard is tagged, and `boundary-guards.test.ts` passes with any new category added to its inventory.
- [ ] Gates green, with `npm run build` before `npm test`.
