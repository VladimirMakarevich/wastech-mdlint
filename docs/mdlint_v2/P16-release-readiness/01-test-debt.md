# P16.01 · Test debt: real scale, zero config, dot-directories, boundaries

> Phase: [P16 — Release readiness](index.md) · Roadmap: [v2 Index](../index.md) · Size **M–L** · Status **Done**. Backlog: [W-57](../remediation-backlog-2026-08-05.md) (High), [W-58](../remediation-backlog-2026-08-05.md) (Medium), [W-56](../remediation-backlog-2026-08-05.md) (Low). Sources: the field test's own summary; the crosscheck's analysis of 16 missed defects; audit invariant 2; audit F14. Depends on [P13](../P13-correctness/index.md), [P14](../P14-host-boundary/index.md), [P15](../P15-output-contracts/index.md).

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

- [x] Each of W-01, W-02, W-14, W-26, W-27 has a test that **fails before its fix** — verified by reverting each fix locally, not asserted. Where the fix's own task already landed that guard, this is a verification with a stated result, not a second guard.
- [x] The no-config nested-`node_modules` fixture and the dot-directory `init` fixture both exist, the second comparing the corpus to a tracked-file list in both directions.
- [x] The glob table's four shapes plus an ordered negation are covered.
- [x] At least one surface has a human-versus-structured parity assertion, written as a reusable pattern.
- [x] `handleLint` and `lintFiles` are pinned together, or the shared entry point is in core.
- [x] The stale-build message names a command that actually clears the guard, in the test and in the testing rules.
- [x] Every new boundary guard is tagged, and `boundary-guards.test.ts` passes with any new category added to its inventory.
- [x] Gates green, with `npm run build` before `npm test`.

## Implementation notes

### Four of the five guards already existed; the work was verifying them and filling the gaps

The deliverables above say to verify before adding, and that changed the shape of the task substantially. What the tree already held:

| Item | Existing guard | Outcome |
| --- | --- | --- |
| W-01, ordered negation | `packages/core/test/rule-utils.test.ts` (matcher), `load-documents.test.ts` (loader), `packages/cli/test/lint.e2e.test.ts` (exit code) | Covered. Added the **corpus-level** anchoring table the matcher-level pins could not stand in for (below) |
| W-02, nested `node_modules` with no config | `packages/cli/test/lint.e2e.test.ts`, already tagged `@boundary-guard shared-exclude` | Deliverable 1 was **already fully met**. No second fixture added |
| W-03, the four anchoring shapes | `rule-utils.test.ts` | Covered at the matcher only |
| W-14, dot-directory `init` | `packages/cli/test/init.e2e.test.ts`, exporting `DOT_DIRECTORY_FIXTURE` / `DOT_DIRECTORY_TRACKED_MARKDOWN` for exactly this task | Count arithmetic only — the both-directions set diff was missing |
| W-26 / W-27, renderer bounds | `graph-render.test.ts`, `graph.e2e.test.ts`, `context-graph.test.ts`, `compile-context.test.ts` (longest line **and** the dependency section's share) | Deliverable 3 was **already fully met**, on P15.01's generating fixture. Adopted, not duplicated |

So the new fixture work is narrower than the deliverable list reads: a corpus-level glob table, the both-directions corpus comparison, the parity pattern, W-58 and W-56.

**Why the glob table needed a second home.** `rule-utils.test.ts` answers the anchoring question where the rule lives, and that is the right place for it — but one layer up the four shapes stop being equivalent. `exclude` prunes whole directories through `shouldPruneDirectory`'s synthetic-child probe **before** any file reaches the file-level filter, so a root-anchored `node_modules/**` does not merely fail to match a nested copy: the walk descends into it and parses every file inside. That is the blocker the field test measured, and a matcher-level `false` is not evidence about it. `load-documents.test.ts` now runs the table over a real three-file tree.

### The revert verification, with results

Each fix was reverted **with the editor, not git** (the source files were copied aside and restored byte-for-byte afterwards; `git status` confirmed a clean product tree). Every revert was rebuilt before running, and the tree was rebuilt with `npx tsc -b --force` afterwards.

| Item | Reverted to | Result |
| --- | --- | --- |
| W-01 | `matchesConfigGlob` → `micromatch.isMatch(path, patterns)`, and `normalizeConfigGlob` prefixing the whole pattern instead of the body | **Red.** 8 failures in `rule-utils.test.ts`, 3 in `load-documents.test.ts` (2 pre-existing + the new ordered-negation row), 1 in `cli/test/lint.e2e.test.ts` |
| W-02 | `resolveCorpusScope` → `exclude: [...(config.exclude ?? [])]` | **Red.** Both zero-config corpus tests in `cli/test/lint.e2e.test.ts` — the `shared-exclude`-tagged nested-`node_modules` guard and its dot-directory counterpart — plus 3 in `corpus-scope.test.ts` |
| W-14 | `formatDraftSummary` no longer calling `formatScanExclusions` | **Red.** 6 failures in `cli/test/init.e2e.test.ts`, including the new both-directions test |
| W-26 | Comma-joining `pushPathList` in `graph-render.ts` **and** `entry points` in `graph-algorithms.ts` | **Red.** 8 in `graph-render.test.ts`, 3 in `cli/test/graph.e2e.test.ts`, 3 in `mcp-server/test/context-graph.test.ts`, 1 in the new `host-parity.test.ts` |
| W-27 | `REFERENCE_FANOUT_LIMIT` / `REFERENCE_DOCUMENT_LIMIT` → unbounded | **Red.** Both corpus-scale assertions in `compile-context.test.ts` |

No guard was toothless, and none of the five needed a replacement.

### W-58: a shared entry point in core, not a differential test

The deliverable prefers hoisting "if the diff is more than a few lines". It was ~50: `handleLint` re-assembled `parseDocument` → corpus-of-one → `runRules` → `createSuppressionChecker` → counts → `formatLintResultText`. So the step order moved into core as [`engine/lint-corpus.ts`](../../../packages/core/src/engine/lint-corpus.ts) (`lintCorpus`, synchronous, over a corpus already in memory), with [`lintFiles`](../../../packages/core/src/engine/lint-files.ts) keeping the discovery half — corpus scope, `loadDocuments`, the re-key, severity resolution, the shared graph — and [`engine/lint-content.ts`](../../../packages/core/src/engine/lint-content.ts) adding the ad-hoc entry point on top. `LintResult` moved to `lint-corpus.ts` and is re-exported from `lint-files.ts`, so no importer changed. `lintContent` is synchronous because the handler it serves is.

**Only one of the two new functions reaches the barrel.** `lintContent` is exported because it is the MCP `lint` tool's whole body; `lintCorpus` is not, because both of its callers are inside core and a host cannot hold its inputs (a parsed corpus, resolved rules) without re-assembling the discovery half the split exists to keep in one place. Exporting it "for a caller that already holds a parsed corpus" would be an extension point for a hypothetical need — which the coding rules forbid — and would quietly add a fifth entry to the uncalled-export question [P16.05](05-low-severity-cleanups.md) owns.

**The one behavior this changes.** Under `lintCorpus`, project-scope rules run with no `context.document` / `context.filePath`, where `handleLint` used to supply both to every rule regardless of scope. Verified against the tree before writing it: all ten shipped project rules self-attribute `filePath` (`sec.ts`, `grp.ts`, `llm.ts`, `ref.ts`, `ctx.ts`, and `TBL-006` through `primitives/table.ts`), as does `columnUnique`, the only project-scope custom assert. So no attributed path moves — pinned directly by a test in `lint-content.test.ts`, and by the untouched `SEC-003`/`STR-001` cases in `mcp-server/test/lint.test.ts`.

Rule **resolution** deliberately stayed in the host: it owns translating a `RuleResolutionError` into the M6 `{ code, message, hint }` contract, which core cannot do for it. The tool's structured output is unchanged (`{ messages, errorCount, warningCount }`), and `lint.test.ts` gained a source-shape guard — the handler no longer names `parseDocument`, `runRules` or `createSuppressionChecker` — because every behavioral test passes either way, which is why the duplication survived two review passes.

**A glossary claim corrected in the same change.** The `lintFiles` entry described it as "intentionally **synchronous** (`globSync` + `readFileSync`)" and told readers not to add an async variant. The function is `async` and `loadDocuments` reads through `fs/promises`; neither `globSync` nor `readFileSync` appears anywhere in that path. Nothing depended on the claim, so it is corrected rather than surfaced as a blocking contradiction, and the real invariant it was reaching for — one step order, not a third assembled in a host — now sits on the `lintCorpus` entry.

**And a divergence that outlives it, stated rather than left latent.** The identical sentence survived in the enforced ADR the glossary entry cited as its authority: [`decisions/core-hosts-the-pipeline.md`](../decisions/core-hosts-the-pipeline.md), which read "`lintFiles` is intentionally **synchronous** (`globSync` + `readFileSync`). Do not introduce an async variant — that would split the pipeline." Correcting an `Accepted (enforced)` decision — and settling the two further glossary sites that restate its framing — is W-41, owned by [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md), which is ranked first in its phase for exactly this reason and whose exit criteria state that the `lintFiles` entry must be fixed in the same change as the ADR. That half is deliberately **not** done here: this task's scope is test debt, and a tier-3 precedence document is not a rider on it. So until P17.03 landed, the glossary entry diverged from that ADR, the entry was the side that matched the shipped code, and both the entry and the [residuals register](../accepted-behaviors.md#recorded-residuals) said so — [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md) corrected the ADR and removed the residual row, so neither says so anymore. What P17.03 found pre-done when it arrived was the glossary half of its step 3; the ADR, the **LSP server** entry and the **Async rules** entry were all still its work.

### W-56: the message option, and why the check stays a timestamp comparison

Both `assertBuilt` copies were deduplicated into [`packages/core/test/support/assert-built.ts`](../../../packages/core/test/support/assert-built.ts), so the remedy exists once. Reproduced in this tree first: a forward `utimes` on `packages/cli/src/index.ts` left `npm run build` a no-op (`tsc -b` decides up-to-dateness from content) with the guard still red, and `npx tsc -b --force` re-emitted and cleared it. That command is now named in the failure message and in [`.agents/rules/testing.md`](../../../.agents/rules/testing.md)'s "Build before test" bullet.

**And it is called by every suite that spawns a built entrypoint, not only the two the deliverable names.** `stdio-integration.test.ts` is the third `installed-bin-spawn` guard and had carried the precondition as prose — "`npm run typecheck` is `tsc -b`, which emits before `npm test`" — which is exactly the claim W-56 exists because it is not always true: on the mtime-only-change checkout it gives a behavioral failure whose only remedy pointer is a command that just exited `0`. `host-parity.test.ts` spawns both hosts and asserts each. The defect W-56 names is the message, so it is the same defect wherever a spawn suite lacks one.

Comparing real build state would mean re-deriving `tsc -b`'s own `.tsbuildinfo` bookkeeping inside a test helper — a second implementation of the thing under verification, wrong silently where a timestamp is wrong loudly. The retained heuristic is registered in [`accepted-behaviors.md`](../accepted-behaviors.md).

### A fifth boundary-guard category: `host-parity`

Human-versus-structured and host-versus-host divergence is the crosscheck's fourth bucket and the class that hid three defects at once. It is added to **both** halves the constraint names: `packages/core/test/boundary-guards.test.ts`'s inventory (the enforcing half) and the table in `.agents/rules/testing.md` (the discipline half). Its guards are `cli/test/lint.e2e.test.ts`, `mcp-server/test/{lint,lint-files,context-graph,host-parity}.test.ts`.

The reusable part is [`packages/core/test/support/output-parity.ts`](../../../packages/core/test/support/output-parity.ts) — `readHumanSections`, `readLintFindingLines`, `readLintSummaryLine`, `lintMessagesAsRows` — imported by all three packages, and free of `src` imports for the reason `large-corpus.ts` states. **The pattern's load-bearing rule is that the two sides must be different formulations:** the human text is parsed _back_ into rows rather than recomputed, and `lintMessagesAsRows` restates the `-` / `line` / `line:column` rule instead of importing `formatLocation`. Recomputing with the renderer's own helper would make the assertion agree with itself, which is how the original defects passed inspection.

**The corpus is shared too, not just the readers.** `PARITY_LINT_FIXTURE` — the two documents, the three-rule config, and the expected location set — lives in the same module and is written out by the CLI suite, the MCP `lint-files` suite and the cross-host guard (which extends the map with three linked documents for its graph leg rather than restating it). The readers are only non-vacuous because that corpus produces all three location shapes at once, so a fixture restated per suite meant a change to the location vocabulary had to be chased through three files, with nothing failing if one of them drifted.

Adopting it also widened three existing assertions from one section to all three (`entry points`, `reading order`, `excluded from reading order`) — `excluded` had been missing from the JSON for three phases while its two siblings were never compared at all, so checking one of three is how the next omission stays invisible. The graph format has a **fourth** path-bearing section, and it is nested: `files outside corpus` sits inside the coverage block, header at two spaces and items at four, so `readHumanSections` takes a header-indent argument and reads one nesting level per call. It is diffed on the CLI's committed fixture corpus rather than on the large one, because only there is a file actually outside the corpus — on the large corpus both sides are empty and would agree vacuously, which is how the section P15.01 made line-oriented last would have stayed the one nothing compared. The renderer-level twin in `graph-render.test.ts` supplies no coverage at all, so three really is its whole overlap; its comment now says so instead of claiming every section.

`host-parity.test.ts` is the cross-host leg and crosses a real process boundary in both directions: the CLI bin spawned, the MCP server over `StdioClientTransport`. It pins byte-identical human text between `lint` and `lint-files`, identical messages/files/counts across the two machine payloads, the documented key-set divergence as a decision, and the graph relationship as a **prefix** (the CLI's `renderContextGraphText` begins with the `formatContextGraphSummary` block the MCP tool returns), which is the strongest true statement rather than an equality that would be false.

### Notes

- Every new test runs in the ordinary `vitest run` suite; nothing is CI-only.
- The `json`/`mermaid`/`dot` digests in `graph-render.test.ts` did not move, which is the standing check that no product change leaked in.
- Gates: `npx tsc -b --force` → `npm test` (75 files, 1087 passed, 7 skipped) → `npm run typecheck` → `npm run lint` → `npm run format`.
