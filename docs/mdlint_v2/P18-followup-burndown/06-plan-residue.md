# P18.06 — Plan-of-record residue P17 left behind

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**.
>
> Four items in the plan tree. One matters more than its severity: it was deferred to a task that has since closed without it.

## Problem

**FU-54 — a deferred item outlived the task that was supposed to fix it, and that task is now `Done`.** [P17.01](../P17-plan-of-record/01-dead-links.md)'s implementation notes end with "**One nearby falsehood surfaced rather than fixed.** `index.md:376` says the phase files mirror \"the v1 `docs/plan/` granularity\" … Left for [P17.06](../P17-plan-of-record/06-register-and-roadmap.md), which owns roadmap accuracy." [P17.06](../P17-plan-of-record/06-register-and-roadmap.md) never mentioned `index.md:376` or `docs/plan/` — its W-51 bullet covers only the six-versus-seven command lists and the `schema.json` tree diagram — and it has since been marked `Done`. The statement is still in [the roadmap](../index.md) under §10, and a completed task's implementation notes are not a place anyone will look. This is exactly the latency the repository hygiene rule warns about, and it is why the item is listed here instead of being deferred a second time.

**FU-56 — an execution note asserts process history the tree does not record.** [P17.01](../P17-plan-of-record/01-dead-links.md) rewrote `docs/mdlint_v2/P11-remediation/index.md`'s `## Execution note` beyond the two links it needed to drop. The third sentence — "The remaining tasks were promoted per-task via the `worc-task` flow, keeping each orchestrator task and its phase file in sync" — converts a standing instruction into an assertion about orchestrator history that nothing in a clone can check, since `tasks/` is gitignored. It also sat contradicting that file's own header status, which [P17.04](../P17-plan-of-record/04-completion-surface.md) has since reconciled.

**FU-61 — a test title asserts a mechanism the code under test does not implement.** `it("strips a `./` that a negation prefix hides")` in `packages/core/test/rule-utils.test.ts`: the comment inside the test immediately corrects it — picomatch strips the `./`, "with no help from `normalizeConfigGlob`". A reader scanning test names will look for stripping code in `globs.ts` and not find it.

**FU-62 — an inventory backing an exit criterion is incomplete for the file it enumerates most precisely.** [P17.01](../P17-plan-of-record/01-dead-links.md)'s "**Reviewed and left: mentions are not links.**" paragraph lists `audit-2026-07-25-post-p9.md:1`, `:9`, `:31`, `:32`, `:131`, `:203`, `:210`. That file has two further bare `p9-09` mentions at `:27` and `:49`. Both are legitimate history and correctly left in place; the record backing exit criterion 4 simply does not name them.

## Deliverables / steps

- [ ] **FU-54:** fix the statement at [the roadmap](../index.md)'s §10 item 2 — the phase files do not mirror a `docs/plan/` granularity that is not in this repository. Correct it in place rather than deleting the item, and drop the now-misleading pointer in [P17.01](../P17-plan-of-record/01-dead-links.md)'s notes, or repoint it here.
- [ ] **FU-56:** keep the first two sentences of `P11-remediation/index.md`'s `## Execution note` — the gitignore rationale is what was needed — and either delete the third or restore it as guidance ("Promote each task per-task via the `worc-task` flow, keeping the orchestrator task and its phase file in sync").
- [ ] **FU-61:** rename the test to describe the observed contract rather than a mechanism — for example, "anchors a negated `./`-prefixed pattern to the root, like the same pattern without it" — keeping the existing why-comment.
- [ ] **FU-62:** add `:27` and `:49` to the `audit-2026-07-25-post-p9.md` line-number list in that paragraph.

## Exit criteria

- [ ] No statement in [the roadmap](../index.md) describes a plan granularity this repository does not have.
- [ ] Nothing in `P11-remediation/index.md` asserts orchestrator history a clone cannot verify.
- [ ] No test title in `rule-utils.test.ts` names a mechanism its subject does not implement.
- [ ] The mentions-are-not-links inventory names every occurrence in the file it enumerates.
