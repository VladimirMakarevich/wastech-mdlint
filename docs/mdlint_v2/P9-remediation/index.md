# Phase P9 — Post-Audit Remediation (code, cross-platform, tooling)

> Roadmap: [v2 Index](../index.md) · Phase **P9** · Size **M** · Status **Not started** ·
> Depends on [P8](../P8-skills/index.md) (full product surface shipped).
>
> **Goal:** close the code-level **correctness**, **cross-platform**, and **tooling** gaps
> found in the [P0–P8 audit](../audit-2026-07-23-p0-p8.md) — before the product is packaged
> for release. Every task here maps to a MEDIUM (or a code-level LOW) finding from that report.

## Why this phase exists

The P0–P8 audit confirmed the architecture is sound and all 24 rules ship, but it surfaced a
small set of real behavioral defects and verification gaps that should not go out in a `v1`
release: wrong source positions for multi-line imports, a locale-dependent sort on the
determinism-critical loader path, a CI that never exercises Windows despite a cross-platform
contract, a tool description that misstates filesystem access, an over-promised custom-rule
target, and a red-but-unenforced format gate. This phase fixes the code and its verification;
[P10](../P10-consistency/index.md) handles the documentation/contract/test-depth findings.

## Tasks

| # | Task | Finding | Sev | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| [P9.01](01-import-positions.md) | Fix line/column for multi-line `@import` blocks | M-1 | MEDIUM | S | P8 |
| [P9.02](02-deterministic-sort.md) | Replace `localeCompare` with a deterministic sort | M-4 | MEDIUM | S | P8 |
| [P9.03](03-cross-os-ci.md) | Add Windows/macOS to the CI matrix | M-5 | MEDIUM | S | P8 |
| [P9.04](04-mcp-lint-description.md) | Make the MCP `lint` tool description honest | M-3 | MEDIUM | S | P8 |
| [P9.05](05-custom-heading-target.md) | Resolve the `custom` `target: "heading"` mismatch | M-2 | MEDIUM | S–M | P8 |
| [P9.06](06-format-gate.md) | Fix and enforce the Prettier format gate | M-6 | MEDIUM | S | P8 |
| [P9.07](07-init-ci-package-manager.md) | `init` CI workflow respects the detected package manager | L-7 | LOW | S | P8 |
| [P9.08](08-idref-prose-scan.md) | (Stretch) Scope the id-ref scan to prose, not code fences | L-6 | LOW | M | P1 parser |

## Sequence

```
(P8) ─► P9.01 ┐
       P9.02 ┤
       P9.03 ┤
       P9.04 ┼─► (P10 — consistency) ─► (P-release)
       P9.05 ┤
       P9.06 ┤
       P9.07 ┘
       P9.08  (stretch / backlog — gated on a P1 parser change)
```

> The seven core tasks are independent and can be done in parallel; none blocks another.
> P9.08 is a stretch item (accepted v2 limitation) and may be deferred to the backlog.

## Phase exit criteria

- [ ] Multi-line `@import` blocks report correct `line`/`column` per import, with a regression test.
- [ ] Document load order is deterministic across locales/environments (code-point or pinned-locale sort).
- [ ] CI runs the full gate on `windows-latest` (and ideally `macos-latest`), exercising POSIX-path normalization.
- [ ] Every shipped MCP tool description matches its real filesystem/config behavior (M2 honesty).
- [ ] `custom` `target` set is consistent across requirements, glossary, schema, and primitives.
- [ ] `npm run format` is green and enforced in CI (or the gate is explicitly retired in the rules).
- [ ] `init`-generated CI uses the detected package manager (or explicitly documents npm-universal by design).

## What P9 unblocks

- [P10 — Post-audit consistency](../P10-consistency/index.md) and, after it, [P-release](../P-release/index.md).
