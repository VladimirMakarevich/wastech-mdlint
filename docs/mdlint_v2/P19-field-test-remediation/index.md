# Phase P19 — Field-test remediation

> Roadmap: [v2 Index](../index.md) · Phase **P19** · Size **M** · Status **In progress** · Depends on [P18](../P18-followup-burndown/index.md) (the follow-up queue is empty, so this phase starts from a clean backlog).
>
> **Goal:** close the fourteen findings from the [2026-08-09 field test](../field-test-2026-08-09-debates.md) — the first run in which the packed artifacts were installed **into** an external repository rather than beside it.

## Where these items come from

One source, and it is the definition site for the ids: [`field-test-2026-08-09-debates.md`](../field-test-2026-08-09-debates.md), which records `F-01` … `F-14` with the measurement behind each. Nothing else defines them, which is why that document is frozen rather than rewritten as the work lands.

The run was the [playbook](../field-test-playbook.md) end to end against a 202-document Angular/.NET monorepo. Two properties of it decide how much weight a finding here carries:

- **The tool was installed into the target**, so the release-facing findings describe what a consumer receives rather than what our own checkout shows. F-01 reverses on that difference: our lockfile carries five production-tree advisories and the range we publish resolves clean.
- **Every zero was backed by a negative control** — twenty rule configurations that reported nothing were re-run deliberately broken, and each fired. That is how F-07 was caught: it is the one zero that survived the test.

**No blockers.** Four majors, seven minors, three polish. Twelve of the fourteen reproduce on throwaway trees; the run leaves a script that builds them.

## The seams, not the list

Eleven of the fourteen fall into three groups, and the tasks below are cut along them rather than along the finding numbers.

| Seam | Findings | Why it is one piece of work |
| --- | --- | --- |
| Inference is sampled, and the config it writes is not | F-03, F-04, F-10 | All three are `discovery/rule-inference.ts` deciding from three-to-five sampled files what a config running over the whole corpus should enforce |
| A surface states what a reader can disprove in one command | F-02, F-06, F-08, F-12, F-14 | Five messages and labels, each individually small, together the class that costs trust fastest |
| Silence where the product is otherwise loud | F-07, F-09 | Two configurations accepted without a word that cannot do what they claim, in a product built on the opposite instinct |

The other three — F-11 (output rendering), F-13 (compile bounds), F-01 (release hygiene) — are independent.

## Tasks

| # | Task | Findings | Sev | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| [P19.01](01-inference-scope.md) | Inference measures what the config will run over | F-03, F-04, F-10 | High | M | — |
| [P19.02](02-scan-disclosure.md) | The scan disclosure describes the written config's boundary | F-05, F-06 | Medium | S | P19.01 |
| [P19.03](03-silent-configurations.md) | Two configurations the product accepts and cannot honour | F-07, F-09 | High | M | — |
| [P19.04](04-text-report-grammar.md) | The text report's line grammar survives any message | F-11 | High | S | — |
| [P19.05](05-message-scope.md) | Two messages that state more than they mean | F-02, F-08 | Medium | S | — |
| [P19.06](06-reporting-surfaces.md) | Hub ranking, and the skill sections that scale | F-12, F-13 | Medium | M | — |
| [P19.07](07-host-and-release.md) | One host contract key, and the lockfile | F-14, F-01 | Medium | S | — |

**Sequence.** [P19.01](01-inference-scope.md) before [P19.02](02-scan-disclosure.md): the disclosure describes what inference decided, so correcting the scope first means the disclosure is written once. Everything else is independent and can run in any order. [P19.04](04-text-report-grammar.md) is the cheapest of the four majors and the one whose absence corrupts the default output, so it is worth doing first regardless of the order the rest take.

**What this phase does not do.** F-03's fix is a policy decision about what `init` should propose, not only a code change, and the task states the options rather than picking one — that call belongs to whoever owns the first-run experience. Likewise F-13 offers a cap or a disclosure and does not assume which.

## Progress

| Task                                  | Status      | Findings closed  |
| ------------------------------------- | ----------- | ---------------- |
| [P19.01](01-inference-scope.md)       | Done        | F-03, F-04, F-10 |
| [P19.02](02-scan-disclosure.md)       | Done        | F-05, F-06       |
| [P19.03](03-silent-configurations.md) | Done        | F-07, F-09       |
| [P19.04](04-text-report-grammar.md)   | Not started | —                |
| [P19.05](05-message-scope.md)         | Not started | —                |
| [P19.06](06-reporting-surfaces.md)    | Not started | —                |
| [P19.07](07-host-and-release.md)      | Not started | —                |

## Exit criteria

- [ ] All fourteen findings are closed, or carry a stated decision to accept them in the [accepted-behaviors register](../accepted-behaviors.md).
- [ ] Each closed finding has a test that fails without the fix, written from the field test's own reproduction rather than restated from the task file.
- [ ] The gaps the run could not reach — a second platform, `init`'s interactive branches, a real MCP host, `settings.siteRouter` and `settings.idRef` — are still recorded as gaps and not mistaken for coverage.
- [ ] A re-run of the [playbook](../field-test-playbook.md) against a target reports none of `F-01` … `F-14`.
