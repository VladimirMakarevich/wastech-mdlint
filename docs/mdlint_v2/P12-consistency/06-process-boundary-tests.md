# P12.06 · Process-boundary test guards + format-gate publish process

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Sources: post-P9 audit [§4](../audit-2026-07-25-post-p9.md) (systemic
> cause) and [§1](../audit-2026-07-25-post-p9.md) (red format gate). Depends on
> [P11.01](../P11-remediation/01-cli-bin-noop.md).

## Goal

Turn the audit's systemic cause — **no tests at the process boundary** — into a standing checklist and
a few generalizing guards, and close the process gap that let a red format gate ship in an audit
deliverable. This is the "prevent the class" task for the whole post-P9 audit.

## Problem (from the audit)

The audit's [§4](../audit-2026-07-25-post-p9.md) names one root cause behind the missed HIGH findings:
nothing tested the process boundary. `src/index.ts` had 0% coverage (H-1); the shared `exclude` option
had zero e2e coverage (L-4); no `init` test exercised a write failure (M-5); nothing spawned the
binary. Separately, [§1](../audit-2026-07-25-post-p9.md) found `npm run format` **red on the branch**
— and half the offending files were added by the `p9-09` audit deliverable itself (`242a518`) and by
the P10.04/P10.05 commits — because none of those three runs executed the format gate that P9.06 had
specifically added to CI. (On `main` today the gate is green, so this is a **process** fix, not a
byte fix.)

## Deliverables / steps

1. **Boundary-test checklist.** Add a short, durable checklist (in the testing rules or the P-release
   verification) enumerating the process-boundary guards the product must keep: spawn the installed
   bin (from [P11.01](../P11-remediation/01-cli-bin-noop.md)); an `init` write-failure test (from
   [P11.09](../P11-remediation/09-atomic-writes.md)); `exclude` e2e (from
   [P12.01](01-exclude-coverage.md)); a determinism/regex-state guard (from
   [P11.05](../P11-remediation/05-table-primitive-scope.md)). The point is that these are named
   categories, so a future subsystem without one is visibly missing it.
2. **Generalize the bin-spawn guard.** Ensure the P11.01 spawn test covers the surfaces most likely to
   silently no-op — `--version`, a `lint` with a known finding count, and a nonzero-exit path — on all
   three CI hosts.
3. **Format-gate publish process.** Make `npm run format` (or `prettier --check`) run before any docs
   deliverable is committed — e.g. document it in the repo-hygiene/testing rules and confirm CI's
   format job covers `docs/**` and `tasks/**` so a red gate cannot merge. Verify `.gitattributes`
   keeps the check stable cross-platform (per the P9.06 note).
4. **Accepted behaviors.** Record any behavior P11 chose to _document rather than fix_ (e.g. a
   corpus-only `STR-001` if [P11.12](../P11-remediation/12-str001-reach.md) took direction B; the
   `SIZE-001` override interaction if [P11.13](../P11-remediation/13-grp-size-hygiene.md) documented
   it) in one "accepted behaviors" note, so they are stated, not latent.

## Out of scope

Writing the individual P11/P12 fixes' tests — those ship with their tasks. This task assembles them
into a named boundary checklist and closes the publish-process gap; it does not duplicate the tests.

## Exit criteria

- [ ] A durable "tests at the process boundary" checklist exists (bin spawn, write-failure, exclude, determinism).
- [ ] The bin-spawn guard covers `--version`, a known-count `lint`, and a nonzero-exit path on all three hosts.
- [ ] The format gate runs before docs/tasks deliverables merge; CI covers `docs/**` and `tasks/**`.
- [ ] Behaviors P11 accepted-rather-than-fixed are recorded in one place.
- [ ] `npm run typecheck && npm test && npm run format` green.
