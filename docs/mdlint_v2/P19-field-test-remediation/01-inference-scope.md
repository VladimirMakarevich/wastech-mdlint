# P19.01 — Inference measures what the config will run over

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.
>
> Closes [F-03](../field-test-2026-08-09-debates.md#f-03--the-rule-set-init-proposes-makes-the-first-lint-report-459-findings), [F-04](../field-test-2026-08-09-debates.md#f-04--init-writes-mincyclelength-2-reinstating-the-class-the-default-excludes) and [F-10](../field-test-2026-08-09-debates.md#f-10--a-merge-appends-a-rule-justified-by-files-the-config-does-not-lint).

## Goal

Make `init` propose a rule set whose first run a maintainer would keep, by closing the gap between what inference samples and what the config it writes runs over.

## Sequence

- **Previous:** — · **Next:** [P19.02 — The scan disclosure](02-scan-disclosure.md).
- **Depends on:** — · **Blocks:** [P19.02](02-scan-disclosure.md), whose disclosure describes the scope this task settles.

## Problem

Inference reads three to five sampled files per cluster and writes a config that runs against the whole corpus. Three separate defects come out of that one gap.

**F-03 — the proposed set makes the first run 459 findings, 94% from one rule.** On the field-test target, `init --yes` then `lint` reported 24 errors and 435 warnings over 151 files. `CTX-002` alone produced 433, on the strength of a rationale reading `Sampled files contain 29 checklist item(s)` — a number that reads as small and is fifteen times off the corpus. Eighteen of the 459 were worth acting on.

This repository already holds the opposite position, states it in its own config, and applies it by hand: a rule joins the gate only once a full run over the corpus already reports zero for it, because a gate that reports hundreds of findings on the day it lands gets ignored and then disabled. `init` is the surface where that policy should be automatic and is the one place it is not.

**F-04 — `init` writes `minCycleLength: 2`.** `rule-inference.ts` lowers the floor when the sampled cycle is shorter than the default, so the cited cycle is one the proposed config would report. The comment explains the reasoning, and it is honest reasoning. But the [register](../accepted-behaviors.md) raised that default to 3 for exactly the outcome this produces: on the target it turned 2 findings into 8, six of them ordinary index-and-member back-links, at `error`, in a run that also offers a CI workflow.

**F-10 — a merge appends a rule justified by files outside the config's `include`.** Inference samples the repository scan; a merge preserves the existing `include` exactly, as documented. So on a merge they disagree by construction: `REF-003` was appended with `Sampled files contain 1 image reference(s)` to a config whose corpus has none. The rationale is written into the file as a permanent justification for a measurement that is false of the run.

## Deliverables / steps

1. **Decide what `init` should propose, and state the decision in the task notes.** The options, cheapest first: propose volume-sensitive rules at `severity: "warning"`; count the corpus for the two or three rules where volume decides usefulness instead of sampling; or write them in as `severity: "off"` with the rationale, so the user opts in. This is a first-run-experience call, not only a code change — pick one and record why, rather than letting the implementation imply it.
2. **Stop lowering the `GRP-001` floor.** Keep the disclosure-fidelity goal by citing the sampled cycle **and** saying the proposed config will not report it below the floor — the shape the Not-proposed-by-init block already uses for `SIZE-001` and `LLM-001`.
3. **Make a merge infer only from files the existing `include` selects**, or state in the rationale that the evidence came from outside the configured scope. Either closes F-10; the first is the one that keeps the comment true without a caveat.
4. **Tests, written from the field test's reproductions** rather than restated: a corpus whose checklist volume dwarfs its sample; two documents that link each other; and a config whose `include` is narrower than the repository's Markdown.

## Notes — what was decided, and why

**Deliverable 1: zero-gate every rule, measured over the corpus.** Of the three options the step lists, the first is a no-op and the third is unmeasured, so the decision was the second, with the third as its disposition:

- **`severity: "warning"` cannot fix F-03.** `CTX-002` already defaults to `warning`; the 433 findings the field test counted _were_ warnings. Proposing volume-sensitive rules at `warning` changes nothing about the run it was offered to fix.
- **Always writing them `"off"`** would state a policy the tool never measured — a rule disabled on a corpus that satisfies it is as wrong as one enabled on a corpus that does not, just quieter.
- **What shipped:** `init` asks two separate questions. _Relevance_ — does the corpus contain the construct the rule inspects (presence-only, no thresholds, unchanged in spirit)? Then _satisfaction_ — it runs every relevant rule over that same corpus once, writes a rule reporting nothing at its registry default, and writes a rule reporting anything as `severity: "off"` with its real count in the rationale.

Two things decided that, beyond the volume itself. F-03 counts the offered CI workflow being red on the first push as part of the defect, and only a policy that measures can make it green. And the repository already holds this position in writing, in [its own config](../../../wastech-mdlint.config.json), and applies it by hand — "a rule joins only once a full run over this corpus already reports zero for it". `init` was the one surface not doing automatically what the project does deliberately.

The scope is every gated rule, not the two or three the step scoped it to. Once the corpus is being lint-run anyway, restricting the policy to `CTX-001`/`CTX-002` would mean asserting that `REF-001`'s sixteen broken links are a fine first-run experience and forty unchecked boxes are not — a judgement the tool has no basis for. The general rule is also the one a user can state back: nothing is enabled that fails.

**Deliverable 2 came out cheaper than expected.** Because the corpus is loaded anyway, the cited cycle now comes from the real shared `ContextGraph` rather than a sampled DFS heuristic, which deleted `findSampleCycle` — eighty lines whose whole job was mirroring `resolveTargetCandidates` and REF-002's anchor semantics closely enough not to fabricate an edge. The rationale cites the shortest cycle in the corpus and, when it spans fewer documents than `GRP-001`'s floor, says the proposed config will not report it and why.

**Deliverable 3 took the first option**, so no caveat is needed: a merge's `InferenceScope` is the existing config's own `include`/`exclude`/`respectGitignore`/`settings`, read off `loadConfiguration` rather than re-derived, so evidence from outside it does not exist rather than being filtered out afterwards.

**Not changed, deliberately:** `DocCluster.sampleFiles` still exists and is still produced by the scan. Nothing reads it now, but it is the scan's own description of a cluster on a public type, its sampling behavior is pinned by `repo-scan.test.ts`, and removing it is a public-API change belonging to whichever task decides the scan no longer needs it.

## Exit criteria

- [x] A repository with forty unchecked checklist items in one document does not receive a first run that reports all forty at whatever the chosen policy is — and the policy is written down.
- [x] `init` on two documents that link each other proposes `GRP-001` **without** `minCycleLength`, and the draft says why the cited cycle will not be reported.
- [x] A merge over a config whose `include` covers one directory appends no rule whose only evidence is in another.
- [x] Three tests, each failing without its fix.
- [x] The register carries a row for whatever this task decides to accept rather than change.
