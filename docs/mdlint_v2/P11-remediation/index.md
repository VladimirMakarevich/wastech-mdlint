# Phase P11 — Post-P9 Audit Remediation (code)

> Roadmap: [v2 Index](../index.md) · Phase **P11** · Size **M–L** · Status **Done** · Depends on [P10](../P10-consistency/index.md) (first-audit consistency landed).
>
> **Goal:** close the code-level **release-blocking**, **security**, **correctness**, and **data-loss** defects surfaced by the [post-P9 audit](../audit-2026-07-25-post-p9.md) and the confirmed rule defects from the `p9-09` deep audit — before the product is packaged for release. Every task here maps to a HIGH/MEDIUM (or a code-level LOW) finding from those two reports. [P12](../P12-consistency/index.md) handles the coverage/docs/accepted-behavior findings.

## Why this phase exists

The `p9-09` deep audit returned a verdict of **"no HIGH / release-blocking defect"** — but it had only read 18% of the files in its own scope. The [post-P9 re-audit](../audit-2026-07-25-post-p9.md) walked the unread surface and found **22 findings including 4 HIGH, two release-blocking**: the published `bin` is a silent no-op through the npm symlink (so `npx`/global install and every `init`-generated CI job pass green having done nothing), `SEC-003` reads arbitrary files outside the analyzed root (a host-read primitive under MCP prompt-injection), and `init` can overwrite an unrelated ancestor's config or an existing `schema.json` with no guard. Below those sit a class of rule-engine defects (unescaped regex substitution, `exclude` ignored on one code path, stateful `g`/`y` regex, duplicate findings) and CLI-contract gaps (operational failures exit `1` not `2`; unknown subcommands exit `0`). This phase fixes the **code and its behavior**; the coverage and consistency gaps that let these ship go to [P12](../P12-consistency/index.md).

The audit's [§4](../audit-2026-07-25-post-p9.md) reframes several findings as **classes, not incidents** (a regex bug in one rule implies the same bug in its siblings). Tasks are grouped by that class where the audit did so, so a fix closes the family rather than one site.

## Tasks

| # | Task | Finding(s) | Sev | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| [P11.01](01-cli-bin-noop.md) | Fix the CLI `bin` no-op through the npm symlink | H-1 | **HIGH** | S–M | P10 |
| [P11.02](02-sec003-path-escape.md) | Stop `SEC-003` reading files outside the analyzed root | H-2 | **HIGH** | S–M | P10 |
| [P11.03](03-init-schema-clobber.md) | Guard an existing `schema.json` in `init` | H-4 | **HIGH** | S | P10 |
| [P11.04](04-findconfig-boundary.md) | Bound `findConfig` walk-up + honest prompt path | H-3 | **HIGH** | S–M | P10 |
| [P11.05](05-table-primitive-scope.md) | Table primitives: honor `exclude`, stateless `g`/`y` regex | M-2, TP-1 | MEDIUM | S–M | P10 |
| [P11.06](06-regex-substitution-safety.md) | Escape regex substitution in `REF-004`/`CTX-003` | M-1, L-1 | MEDIUM | S | P10 |
| [P11.07](07-custom-missing-id.md) | `custom` without `id` → structured C7 diagnostic, not a crash | M-3 | MEDIUM | S | P10 |
| [P11.08](08-init-exclude-anchoring.md) | `init` `exclude` prunes noise at every depth | M-4 | MEDIUM | S | P10 |
| [P11.09](09-atomic-writes.md) | Atomic, newline-safe writes for `init` and `--fix` | M-5, L-6 | MEDIUM | S–M | P11.03 |
| [P11.10](10-cli-exit-contract.md) | CLI exit-code contract + command routing | M-6, M-7 | MEDIUM | S–M | P10 |
| [P11.11](11-llm-dedup.md) | `LLM-001` deduplicates cross-entrypoint findings | L-3 | LOW | S | P10 |
| [P11.12](12-str001-reach.md) | `STR-001` filesystem reach vs corpus-only (+ guide) | BL-1 | MEDIUM | S–M | P10 |
| [P11.13](13-grp-size-hygiene.md) | Retire dead `GRP` options; collapse duplicate `SIZE-001` | SC-1, SC-2 | LOW | S | P10 |
| [P11.14](14-init-cli-lows.md) | `init`-scan honesty + CLI-plumbing micro-fixes | L-7…L-11 | LOW | S–M | P11.08 |

> **Finding key.** `H-*`/`M-*`/`L-*` are from the [post-P9 audit](../audit-2026-07-25-post-p9.md); `BL-*`/`TP-*`/`SC-*` are the confirmed defects from the `p9-09` report, which was removed from the tree in `d96b64c` — each task file restates the finding it closes, so the evidence stays reachable without it. `OG-1` and `SC-3` from `p9-09` are decisions/documentation and live in [P12](../P12-consistency/index.md).

## Sequence

```
(P10) ─► P11.01  (H-1, release-blocking — do first)
        P11.02  (H-2, release-blocking + security — do first)
        P11.03 ─► P11.09          (schema-clobber guard, then shared atomic-write helper)
        P11.04                     (findConfig boundary)
        P11.05  P11.06  P11.07  P11.08 ─► P11.14
        P11.10  P11.11  P11.12  P11.13
                                   └─► (P12 — coverage & consistency) ─► (P-release)
```

> **Priority order (audit [§6](../audit-2026-07-25-post-p9.md)).** The two release-blockers (P11.01, P11.02) come first — until they land, `npx`/global install is dead and the linter is a host-read primitive. The `init` data-loss pair (P11.03, P11.04) is next. The MEDIUM rule/CLI tasks follow; false-`error` findings (P11.05) and the run-crash (P11.06) lead that group. LOW tasks are grouped with the MEDIUM task in the same subsystem. **P11.09** shares the atomic-write helper introduced alongside **P11.03**; **P11.14** touches the same `init`/config-writer surface as **P11.08**, so land those pairs in order to avoid conflicting edits.

## Execution note

The two release-blockers were staged as runnable orchestrator tasks — `tasks/pending/p11-01-cli-bin-noop.md` (P11.01) and `tasks/pending/p11-02-sec003-path-escape.md` (P11.02) — and both have landed. `tasks/` is gitignored, so those files are not part of a clone and cannot be linked to from here. Promote each remaining task per-task via the `worc-task` flow, keeping the orchestrator task and its phase file in sync.

## Phase exit criteria

- [x] `./node_modules/.bin/wastech-mdlint` and `npx wastech-mdlint` run and set correct exit codes; a process-level test spawns the installed bin (H-1).
- [x] `SEC-003` (and every other rule/primitive that reaches the filesystem) cannot read outside the analyzed root; the MCP `lint` description matches (H-2).
- [x] `init` never overwrites an out-of-target config or an existing `schema.json` without a guard and an explicit summary line (H-3, H-4).
- [x] No rule crashes the run on a legal directory name or config; no rule emits false `error` findings from an ignored `exclude` or a stateful regex (M-1, M-2, TP-1, M-3).
- [x] Operational/usage failures exit `2`, print repo-relative paths, and an unknown subcommand or a missing path never exits `0 "No problems found."` (M-6, M-7).
- [x] `init`/`--fix` writes are atomic and newline-preserving; a mid-write failure leaves no half-written config (M-5, L-6).
- [x] `STR-001` reach and its guide agree; duplicate/no-op behaviors (L-3, SC-1, SC-2) are fixed or explicitly retired.

## What P11 unblocks

- [P12 — Post-P9 consistency & coverage](../P12-consistency/index.md), and after it, [P-release](../P-release/index.md). The two release-blockers (P11.01, P11.02) gate the release directly — `P-release` cannot ship until they close.
