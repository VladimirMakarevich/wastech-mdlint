# P13.04 · Rule options that disable or misfire

> Phase: [P13 — Correctness](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-04](../remediation-backlog-2026-08-05.md) (High), [W-05](../remediation-backlog-2026-08-05.md) (Medium), [W-06](../remediation-backlog-2026-08-05.md) (Medium), [W-07](../remediation-backlog-2026-08-05.md) (Medium). Sources: field F-13, F-16, F-17; audit F12, F27. Depends on [P13.01](01-glob-semantics.md).

## Goal

Ensure that enabling a rule makes it do something, that a rule's default does not flag the repository's own entry points, and that an unrecorded default has exactly one source of truth. Four rules, one class: an option whose absence produces a wrong result rather than a diagnostic.

## Problem

**W-04 — `SIZE-001` can be enabled into inertness.** In [`packages/core/src/engine/rules/size.ts`](../../../packages/core/src/engine/rules/size.ts) `:32-39`, `bytes`, `lines`, and `tokens` are each `.optional()` with no default, and the check `continue`s when a metric is undefined (`:84`). So `{"rule":"SIZE-001"}` is a no-op **by construction** — the comment at `:8` documents the design ("omitting it disables that check"), which is what makes the rule self-consistent and inert at the same time.

What makes this a defect rather than a documented choice is that **`SIZE-001` is the only rule that permits it.** Read from the shipped `schema.json`: `LLM-001` — its nearest sibling, the other context-budget rule — requires `entrypoints` and `maxTokensPerEntrypoint`; `SEC-001` requires `sections`; `SEC-002` requires `order`; `SIZE-001` requires nothing. Measured: a user enabled "File stays within byte / line / token budgets", got **0 errors, 0 warnings** over a corpus containing a 96 778 B and an 85 891 B document, and was told nothing. Verified against a genuine zero for contrast — `CTX-001` also reported 0 on the same target, but a three-section fixture proves it fires, so that zero is a true negative and this one is not. With explicit thresholds the rule is correct: byte counts matched `stat` exactly on all 10 flagged files.

**W-05 — `GRP-002` has no default `entryPoints`.** [`grp.ts`](../../../packages/core/src/engine/rules/grp.ts) `:66` declares `entryPoints: z.array(z.string()).optional()`, and `:82-87` skips the exemption entirely when it is undefined. Measured: **111 orphan warnings on 202 files (55%)**, including `CLAUDE.md`, `backend/AGENTS.md`, `mobile/CLAUDE.md` and both `README.md` files — the repository's canonical entry points — plus 50 harness-loaded files never linked from Markdown by design. Loud rather than silent, hence Medium; but 55% noise is how a rule gets disabled.

**W-06 — `TBL-003.caseSensitive` has no schema default, and three consumers read it.** The primitive falls back to `true` at [`primitives/table.ts`](../../../packages/core/src/engine/primitives/table.ts) `:98`; the Zod schema carries no `.default()`, so nothing records it and `packages/cli/schema.json` emits a bare boolean. Of the three consumers, two are wrong: `docs/guide/config-reference.md:80` documents `// default false` (inverted), and [`compile/describe-rules.ts`](../../../packages/core/src/compile/describe-rules.ts) `:118` annotates only an explicit `true`, so the committed `SKILL.md` renders a case-sensitive custom rule identically to a case-insensitive one. `docs/guide/rules/custom.md:47` lists the option with no default at all. `docs/guide/rules/TBL-003.md` is right twice.

**W-07 — `GRP-001` calls a two-node back-link a cycle, at `error`.** Observed on real data: 8 cycles, all genuine mutual references, all accurately reported with the full cycle path. Four are one deliberate, recognizable pattern — a README indexing its siblings while a sibling links back. The problem is severity, not accuracy: at `error` a normal documentation shape fails the build, and the likely response is to disable `GRP-001`, which forfeits the genuine 3- and 4-node cycles it also found.

## Deliverables / steps

1. **`SIZE-001`:** mark at least one metric required, matching `LLM-001`, **or** ship defaults. Regenerate `schema.json` and the README rule table in the same change.
2. **`GRP-002`:** default `entryPoints` to `["README.md", "CLAUDE.md", "AGENTS.md", "index.md"]`. Under [P13.01](01-glob-semantics.md)'s anchoring rule those are already any-depth patterns, which is what is wanted here — verify that, do not assume it. Consider naming the `entryPoints` option in the finding message, which today states the fix but not the option that performs it.
3. **`TBL-003.caseSensitive`:** put the default in the Zod schema so the generated schema, the skill renderer, and every guide page read one source. Then correct `config-reference.md:80`, fill in `custom.md:47`, and let `describe-rules.ts` render from the resolved value rather than from an explicit `true`. Note the audit's reproduction: built-in `TBL-003` entries render only their registry description, so the skill-renderer half is **custom-rule-only**.
4. **`GRP-001` — decide, do not just implement.** Options: a minimum-cycle-length option; a default severity of `warning`; or keep the behavior and record it in [`accepted-behaviors.md`](../accepted-behaviors.md) with a guide home that states it. All three are legitimate; an undecided `error` is not.
5. **Glossary.** The `SIZE`, `GRP`, and file-scope entries describe these options; update whichever this task changes, in this change.

## Out of scope

Widening what `init` can infer, so that a user reaches `SIZE-001` from that direction too — that is [P16.05](../P16-release-readiness/05-low-severity-cleanups.md) (W-39). The two are paired in the backlog for a reason: today **neither** path lands a user on a working size budget, and this task fixes only the config-authoring one.

## Exit criteria

- [ ] `{"rule":"SIZE-001"}` with no options either errors with a diagnostic naming the missing metric, or fires against a default budget.
- [ ] `{"rule":"GRP-002"}` on a repository with a root `README.md` does not flag it.
- [ ] `schema.json` records the `caseSensitive` default; `config-reference.md` matches it; a compiled skill distinguishes a default-cased custom rule from an explicit `false`.
- [ ] A two-document mutual link and a four-hop chain are distinguishable by configuration, **or** the choice is stated in [`accepted-behaviors.md`](../accepted-behaviors.md) with a guide home.
- [ ] Each of the four behaviors has a test that fails before its fix.
- [ ] Generated `schema.json` and README tables regenerated, byte-sync tests green.
- [ ] Gates green.
