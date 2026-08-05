# Phase P16 — Release readiness, tooling & test debt

> Roadmap: [v2 Index](../index.md) · Phase **P16** · Size **M** · Status **Not started** · Depends on [P15](../P15-output-contracts/index.md) (output contracts landed).
>
> **Goal:** close the test debt that let the P13–P15 defects ship, then make the published artifact something a stranger can install, read, and trust. Sourced from the [consolidated remediation backlog](../remediation-backlog-2026-08-05.md), batches **B10**, **B14**, **B15**, plus the low-severity residue of **B11**.

## Why this phase exists

Two halves, and the order between them is deliberate.

**The test debt comes first** because it is the phase's only preventive work. The field test's four highest-impact findings "are all invisible to the in-repo suite for the same reason: no fixture has a nested `node_modules`, a dot-directory full of real documentation, a 96 KB document, or a hand-written glob." The crosscheck generalizes it: of the 16 defects the audit missed, every one falls into fixture scale, default quality, the zero-config path, or process-boundary rendering. Landing [P16.01](01-test-debt.md) after the P13–P15 fixes means each fix gets the guard that would have caught it, while the reproduction is still fresh.

**The release half is where a published package meets a stranger.** Every tarball today contains only `package.json` + `dist/` — no README, no LICENSE text for the MIT license all three declare, no `repository` link — so publishing produces three blank npm pages. Alongside that: 204 source maps pointing at a `../src` no tarball ships, a `release:check` that validates none of the three `files` allowlists while the glossary says it validates all of them, and an `engines` floor nothing enforces.

**Relationship to [P-release](../P-release/index.md).** These are not a second packaging phase. `PR.01` owns publish metadata and supply chain; the tasks here are the specific defects found against it, and each names the `PR` criterion it feeds. P-release remains terminal.

## Tasks

| # | Task | Backlog | Sev | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| [P16.01](01-test-debt.md) | Test debt: real scale, zero config, dot-directories, boundaries | W-57, W-58, W-56 | High | M–L | P13, P14, P15 |
| [P16.02](02-package-metadata.md) | Package publish metadata: README, LICENSE, `repository` | W-29 | High | S–M | P15 |
| [P16.03](03-published-payload.md) | The published payload: maps, `release:check`, engines | W-30, W-31, W-32, W-33 | Medium | M | P16.02 |
| [P16.04](04-dev-tooling-safety.md) | Dev tooling: argv interpolation and a regex replacement string | W-54, W-55 | Medium | S | P15 |
| [P16.05](05-low-severity-cleanups.md) | Low-severity code and decision cleanups | W-37, W-38, W-39, W-40 | Low | S–M | P15 |

> **Backlog key.** `W-NN` are the work items in the [consolidated remediation backlog](../remediation-backlog-2026-08-05.md), which names each item's source finding IDs so the original evidence stays reachable.

## Sequence

```
(P13,P14,P15) ─► P16.01  (guards for every fix that landed above)
(P15) ─► P16.02 ─► P16.03  (metadata before the allowlist that ships it)
        P16.04  P16.05    (independent)
                                   └─► (P17) ─► (P-release)
```

> **P16.01 depends on all three preceding phases**, because its job is to add the guard that fails before each of their fixes — which cannot be written until the fix exists to guard. **P16.02 before P16.03**: there is no point validating a `files` allowlist before the files it must carry exist.

## Decisions this phase must reach

- **What to do about the 204 source maps** ([P16.03](03-published-payload.md)): ship `src`, inline sources, or stop emitting maps for published output. Three one-line options, one release-shape decision.
- **Whether the `engines` pin is advisory** ([P16.03](03-published-payload.md)): `engine-strict`, a runtime guard, or lower the pin to what is actually tested. The whole field test ran on `v24.8.0` against a `>=24.17.0` floor, so the floor is untested in practice.
- **Whether four uncalled barrel exports are library surface or dead code** ([P16.05](05-low-severity-cleanups.md)).
- **Whether `init` should infer more than 8 of the 24 built-in rules** ([P16.05](05-low-severity-cleanups.md)).

## Phase exit criteria

- [ ] Each of W-01, W-02, W-14, W-26, W-27 has a test that fails before its fix — verified by reverting the fix, and by extending the guard the fix's own task landed rather than adding a second one (W-57).
- [ ] A differential test pins the ad-hoc MCP `lint` step order against `lintFiles`, or an ad-hoc lint entry point is hoisted into core (W-58).
- [ ] The build-before-test remedy clears the spawn guard on an mtime-only change, or `tsc -b --force` is named in the failure message **and** in [`.agents/rules/testing.md`](../../../.agents/rules/testing.md) (W-56).
- [ ] Every tarball carries a README and a license, and every manifest declares `repository` with `directory` — asserted by a test or release check (W-29).
- [ ] Every shipped source map resolves, or no maps ship (W-31).
- [ ] `release:check` and the CI pack step check the same thing, and the glossary describes what the script does (W-30).
- [ ] The `engines` question is decided in one place, jointly with the WSL wrapper's `--engine-strict=false` (W-32, W-54).
- [ ] The dev-chain advisory evidence is recorded at the release-verification step (W-33).
- [ ] Both dev-tooling defects are closed with explicit argv and a replacer function (W-54, W-55).
- [ ] The four low-severity items are fixed or their decisions recorded (W-37, W-38, W-39, W-40).
- [ ] Gates green.

## What P16 unblocks

- [P17](../P17-plan-of-record/index.md), then [P-release](../P-release/index.md). With the product correct, its output usable, its tests guarding the boundaries, and its payload publishable, only the plan of record is left out of date.
