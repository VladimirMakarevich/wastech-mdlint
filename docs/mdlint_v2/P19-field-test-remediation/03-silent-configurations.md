# P19.03 — Two configurations the product accepts and cannot honour

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.
>
> Closes [F-07](../field-test-2026-08-09-debates.md#f-07--ctx-003-is-silent-and-green-when-its-glossary-path-matches-no-file) and [F-09](../field-test-2026-08-09-debates.md#f-09--two-custom-rules-may-share-an-id-and-both-run-under-it).

## Goal

Refuse, or report, the two configurations that currently pass validation and then cannot do what they claim.

## Sequence

- **Previous:** — · **Next:** —.
- **Depends on:** — · **Blocks:** —.

## Problem

**F-07 — `CTX-003` is silent and green when its glossary path matches no file.** `{"glossary":"nope.md","termColumn":"Term"}` reports `No problems found.` and exits `0`. Nothing anywhere. Three misconfigurations collapse into the same pass in `packages/core/src/engine/rules/ctx.ts`: a `glossary` glob matching no document, a glossary whose tables carry no `termColumn`, and a missing `aliasColumn`. Each is a `continue`, and the check returns early on an empty alias map.

A user configures glossary enforcement, sees green, and ships, while the rule has been inert since the glossary file was renamed. Nothing in the output distinguishes "your corpus uses canonical terms" from "this rule never ran" — and it is easy to reach, because the option names a **path** and a **column** and either can drift while the config stays valid. This is the one zero in the whole field test that survived a negative control, which is what makes it a defect rather than a preference.

**F-09 — two custom rules may share an id, and both run under it.** Two entries with `id: "PROJ-DUP"` both load and both execute, producing findings that no consumer can attribute. `severity` may differ between them with no way to tell which applied, and an inline `wastech-mdlint-disable PROJ-DUP` silences both — including the one the author meant to keep. The product already rejects the other two ways to get an ambiguous id, with messages that name the constraint and an example; duplication is the third, and the only one that passes.

## Deliverables / steps

1. **Report an inert `CTX-003` at run time.** A load-time check cannot see the corpus, so this wants a runtime diagnostic: report when the `glossary` glob matched no document, and when it matched one whose tables carry no `termColumn`. Decide whether that is a finding or an operational error and say why — the two differ in exit code, and a rule that cannot run is arguably not a document defect.
2. **Consider the shape beyond this rule.** `CTX-003` is the instance the field test reached; any rule whose options name a file that must exist has the same hole. If the fix generalizes cheaply, generalize it; if not, say so, so the next instance is recognized rather than rediscovered.
3. **Reject duplicate custom ids** in the pass that already rejects a reserved prefix and a bad id shape, with a message in the same register — naming both entries' indices.
4. **Tests:** a glossary path that matches nothing; a glossary that exists with the wrong column; two custom entries sharing an id.

## Exit criteria

- [ ] A `CTX-003` whose `glossary` matches no document does not exit `0` silently.
- [ ] A `CTX-003` whose glossary carries no `termColumn` is reported, not skipped.
- [ ] Two custom entries with the same `id` are a config error naming both.
- [ ] Three tests, each failing without its fix.
- [ ] If the generalization in step 2 is declined, the reason is written where the next reader of `ctx.ts` will find it.
