# P10.08 · Document accepted behaviors & release-coupled checks

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit findings **L-15**, **L-11** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Turn two audit observations into explicit, tracked decisions rather than undocumented behavior:
one accepted-as-is, one deferred to release.

## Problem (from the audit)

- **L-15 (accept & document):** dangling reference-style links `[text][missing]` (no matching
  definition) are parsed by remark as literal text, so they never enter `links` and are invisible
  to REF-001. This **matches GitHub's own rendering** (literal text, not a broken link), so it is
  arguably correct — but it is currently undocumented, so a reader might expect REF-001 to catch it.
- **L-11 (defer to release):** the three `SKILL.md` `compatibility` fields are prose
  ("Version-coupled to @wastech-mdlint/cli…"), not a machine-checkable version, and no test ties
  the field to the package version. Fine pre-release (`v0.0.0`), but the coupling I7 wants is a
  manual convention with no guard once P-release stamps a real version.

## Deliverables / steps

1. Document the dangling-reference-link behavior next to REF-001 (rule docs / README note): it
   mirrors GitHub rendering and is intentional, not a gap.
2. Add a short note (or a `known-limitations` entry) so the behavior is discoverable.
3. For **L-11**, add a tracked follow-up in [P-release](../P-release/index.md) (skill
   `compatibility` version check, coupled to I4/I7 single-tag release) so a machine check lands
   when versioning goes live — this task only records/links it; it does not implement the check.

## Exit criteria

- [ ] The dangling-reference-link behavior is documented as intentional (GitHub-parity).
- [ ] A skill-`compatibility` version-check follow-up is recorded against P-release.
- [ ] No code change required (docs + backlog linkage only).
