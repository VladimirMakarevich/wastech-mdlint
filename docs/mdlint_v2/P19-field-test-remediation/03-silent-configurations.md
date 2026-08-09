# P19.03 — Two configurations the product accepts and cannot honour

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.
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

## Notes — what was decided, and why

**Step 1 reports a finding, not an operational error.** Exit `2` means the command could not run, and here it ran — the corpus was walked, every other rule reported, and one rule's inputs were absent. Throwing would abort a whole lint over one misconfigured entry, which is a worse outcome than the silence it replaces, and `run-rules.ts` reserves a throw out of `check()` for programming errors specifically. The product had already answered this exact shape twice as a finding, in `SEC-003`'s missing `template` and `STR-001`'s unverifiable required file: `line: 0`, `filePath` set to the raw config value, report once and return. Following them also inherits a property worth having — a message naming a path with no document behind it is never inline-suppressible, so `wastech-mdlint-disable CTX-003` cannot put the silence back.

**It is emitted at `error` even though CTX-003 defaults to `warning`.** The default `--fail-on` is `error`, so a warning-severity diagnostic would print and still exit `0` — the same green run, one line of output later, which does not close the finding. An entry-level `"severity"` still wins over a per-finding hint and is [recorded as accepted](../accepted-behaviors.md) rather than exempted: the alternative is a second severity channel no other finding has, so that a rule a user has declared advisory could still fail their build.

**All four inert modes are reported, not the two the exit criteria name.** F-07 lists three; the corpus walk has a fourth the finding did not reach — an `aliasColumn` naming a header no table has, which is not a `continue` at all but an empty string that survives every guard. All four drain into the same empty alias map, so reporting at that funnel rather than at each skip covers the mode a load-time check could never see, and costs one report site instead of four. What the counters buy is the message: the report names which stage came up empty, ordered outermost-first, so it says which of the three things to go and fix. The `aliasColumn`-omitted case is answered before the corpus walk, because it is decidable from the options alone and because fixing the glossary path would not help a config missing it.

**Making `aliasColumn` required was the alternative and was rejected.** It is the honest shape — the option has no meaning without it — and unlike a Zod refinement it would survive into `schema.json` where an editor could show it. But it cannot see the misspelled-header case at all, so the runtime funnel is needed either way, and requiring it would reject configs at load with exit `2` where the runtime path reports them at exit `1` with the actual reason. One mechanism covering four causes beat two mechanisms covering three.

**Step 2 generalizes the mechanism and declines the sweep.** `reportInertConfiguration` owns the reporting shape and its rationale, so the next rule that needs it does not re-derive `line: 0` / config-attributed `filePath` / `error`. What does not generalize is the decision to call it: `LLM-001`'s `entrypoints`, `REF-005`/`REF-007`'s `definitions` and `references`, `REF-006`'s `zonesDir` and `GRP-003`'s `chain[].files` have the same hole, but for them an empty match can be a legitimate corpus — a traceability set with nothing declared yet — whereas a glossary rule with no glossary cannot be. Converting one is a per-rule judgment with its own tests and guide page; doing five as a sweep would turn green configurations red on a call nobody made deliberately. The reason sits next to the funnel in `ctx.ts` and the five rules are named in the [residuals table](../accepted-behaviors.md), so the next instance is recognized rather than refiled.

**Step 3 lands in `resolveRules`, not in `resolveCustomRule`.** The two id checks it joins are per-entry and stateless, and uniqueness is the one constraint that needs the sibling list — `resolveRules` is where the entries and their indices are both in hand. The diagnostic is anchored at the offending entry and names the first claimant in its message, which is how both indices are stated while keeping the rendered path a real config path. It is emitted only for an entry that otherwise resolves, so a malformed id is reported as malformed rather than as malformed _and_ duplicated. Comparison is canonical, so `proj-dup` and `PROJ-DUP` collide — the same normalization the reserved-prefix check already applies.

**The MCP `lint` tool got the same check.** It resolves rules from the request rather than from a config, in its own loop, so a check placed only in the loader would have left one host accepting what the other refuses — and on that host the consumer of an unattributable finding is a model. Core owns the detection and the message; each host renders the sibling path in its own rooting (`config.rules[1]` vs `rules[1]`).

**Not changed, deliberately:** `SEC-003` and `STR-001` were not retrofitted onto the new helper. Their messages are pinned by tests, their `error` default already makes them loud, and rewriting two working diagnostics to route through a helper extracted from them buys nothing a reader can see. Duplicate **built-in** entries also stay legal: two `CTX-002` entries scoped to different directories is a supported configuration, and a test pins it so the new check cannot quietly widen.

## Exit criteria

- [x] A `CTX-003` whose `glossary` matches no document does not exit `0` silently.
- [x] A `CTX-003` whose glossary carries no `termColumn` is reported, not skipped.
- [x] Two custom entries with the same `id` are a config error naming both.
- [x] Three tests, each failing without its fix.
- [x] If the generalization in step 2 is declined, the reason is written where the next reader of `ctx.ts` will find it.
