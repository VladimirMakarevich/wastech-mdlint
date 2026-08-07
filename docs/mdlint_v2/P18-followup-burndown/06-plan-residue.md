# P18.06 — Plan-of-record residue P17 left behind

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.
>
> Four items in the plan tree. One mattered more than its severity: it had been deferred to a task that closed without it.

## What was wrong, and what was done

- [x] **FU-54 — a deferred item outlived the task that was supposed to fix it, and that task is now `Done`.** [P17.01](../P17-plan-of-record/01-dead-links.md)'s notes ended with "One nearby falsehood surfaced rather than fixed. `index.md:376` says the phase files mirror 'the v1 `docs/plan/` granularity' … Left for [P17.06](../P17-plan-of-record/06-register-and-roadmap.md)". P17.06 never named the site — its W-51 bullet covers only the command lists and the `schema.json` tree diagram — and closed `Done`. The statement was still in [the roadmap](../index.md)'s §10 and is now corrected in place: `docs/plan/` was never tracked in this repository (`git log --all -- docs/plan` is empty, as P17.01 itself verified for the `AGENTS.md` sentence one paragraph earlier), so there was no granularity to mirror. The item now states **what shipped** — one file per task inside the phase's own directory, `P<N>-<name>/NN-<task>.md` beside its `index.md`, which is also not the flat `docs/mdlint_v2/NN-*.md` the line predicted — and is ticked, since the expansion happened. P17.01's pointer is repointed here rather than dropped, with the reason it went out of reach: **a completed task's implementation notes are not a place the next implementer reads**, so deferring into them is not deferring, it is losing.
- [x] **FU-56 — an execution note asserted process history the tree does not record.** `P11-remediation/index.md`'s `## Execution note` had been rewritten past the two links it needed to drop, turning a standing instruction into a claim about orchestrator history that nothing in a clone can check, since `tasks/` is gitignored. The first two sentences stay — the gitignore rationale is what the rewrite was for — and the third is back as guidance: "Promote each remaining task per-task via the `worc-task` flow, keeping the orchestrator task and its phase file in sync." The header-status contradiction it also carried was already reconciled by [P17.04](../P17-plan-of-record/04-completion-surface.md).
- [x] **FU-61 — a test title asserted a mechanism the code under test does not implement.** `it("strips a `./` that a negation prefix hides")` in `packages/core/test/rule-utils.test.ts`, whose own comment immediately corrects it: picomatch strips the `./`, "with no help from `normalizeConfigGlob`". A reader scanning test names would look for stripping code in `globs.ts` and not find it. Renamed to the observed contract — "anchors a negated `./`-prefixed pattern to the root, like the same pattern without it" — with the why-comment kept, since the mechanism is worth knowing once you are inside the test.
- [x] **FU-62 — an inventory backing an exit criterion was incomplete, in three places rather than two.** [P17.01](../P17-plan-of-record/01-dead-links.md)'s "Reviewed and left: mentions are not links." paragraph listed seven line numbers for `audit-2026-07-25-post-p9.md`. The follow-up named two missing ones; re-deriving the list against the file **as P17.01 saw it** (`git show d429ad3^`) found ten mentions, not nine — `:3` was missing too, the frontmatter line naming the deleted report's path, which is exactly the class the paragraph enumerates. All three are added and the list now states that it is that file's every mention. It also states that the numbering is the file as reviewed: P17.01's own edit shifted everything below the top by two lines, so the recorded offsets no longer resolve in the current tree and a reader chasing them would find the neighbours.

## Notes

**FU-54 is the item this phase exists for.** It is `Low` severity and it survived a whole phase, because the only record of it was a finished task's notes. The [phase index](index.md) says the follow-up file's entries have no ids and no status; a deferral written into a `Done` file has the same property with none of the visibility, which is why the correction here is a pointer that leads forward rather than a deletion.

**FU-62 changed the shape of the fix, not its size.** The prescribed step was "add `:27` and `:49`". Doing exactly that would have produced a list that was still incomplete and whose numbers had drifted — the same defect one iteration on. Re-deriving it against the reviewed revision costs one command and is what makes the exit criterion true rather than closer to true.

**Documentation and one test title.** No product code, no interfaces, no dependencies; the renamed test's assertions are untouched.

## Exit criteria

- [x] No statement in [the roadmap](../index.md) describes a plan granularity this repository does not have.
- [x] Nothing in `P11-remediation/index.md` asserts orchestrator history a clone cannot verify.
- [x] No test title in `rule-utils.test.ts` names a mechanism its subject does not implement.
- [x] The mentions-are-not-links inventory names every occurrence in the file it enumerates, and says which revision its line numbers belong to.
- [x] `npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run lint:docs` and `npm test` all pass.
