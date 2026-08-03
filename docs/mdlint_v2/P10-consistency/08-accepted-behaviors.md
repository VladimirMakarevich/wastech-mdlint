# P10.08 · Document accepted behaviors & release-coupled checks

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Audit findings **L-15**, **L-11** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Turn two audit observations into explicit, tracked decisions rather than undocumented behavior: one accepted-as-is, one deferred to release.

## Problem (from the audit)

- **L-15 (accept & document):** dangling reference-style links `[text][missing]` (no matching definition) are parsed by remark as literal text, so they never enter `links` and are invisible to REF-001. This **matches GitHub's own rendering** (literal text, not a broken link), so it is arguably correct — but it is currently undocumented, so a reader might expect REF-001 to catch it.
- **L-11 (defer to release):** the three `SKILL.md` `compatibility` fields are prose ("Version-coupled to @wastech-mdlint/cli…"), not a machine-checkable version, and no test ties the field to the package version. Fine pre-release (`v0.0.0`), but the coupling I7 wants is a manual convention with no guard once P-release stamps a real version.

## Deliverables / steps

1. Document the dangling-reference-link behavior next to REF-001 (rule docs / README note): it mirrors GitHub rendering and is intentional, not a gap.
2. Add a short note (or a `known-limitations` entry) so the behavior is discoverable.
3. For **L-11**, add a tracked follow-up in [P-release](../P-release/index.md) (skill `compatibility` version check, coupled to I4/I7 single-tag release) so a machine check lands when versioning goes live — this task only records/links it; it does not implement the check.

## Exit criteria

- [x] The dangling-reference-link behavior is documented as intentional (GitHub-parity).
- [x] A skill-`compatibility` version-check follow-up is recorded against P-release.
- [x] No code change required (docs + backlog linkage only).

## Implementation notes

Documentation and backlog-linkage only; no product code touched.

- **L-15** — confirmed the parser behavior directly: `fromMarkdown('[text][missing]')` (no `[missing]: url` definition anywhere in the document) yields a plain `text` node, not a `linkReference` node, so `parse-document.ts`'s `linkReference` branch never runs for it and the target never reaches `ParsedDocument.links`. REF-001 has nothing to see. Documented this as intentional, GitHub-matching behavior in [`docs/guide/rules/REF-001.md`](../../guide/rules/REF-001.md#notes) (the per-rule doc's `## Notes` section) and as a top-level `README.md` `## Limitations` bullet, so both the rule-level and repo-level "what doesn't this catch" surfaces mention it.
- **L-11** — recorded the follow-up against [PR.02 — Single-tag release automation](../P-release/02-single-tag-release.md) (the task that first stamps a real `vX.Y.Z` and sets skill `compatibility`, per I4/I7): added a deliverable step and an exit-criterion checkbox there for a test that guards skill `compatibility` against the published CLI version. This task only links the follow-up; the check itself is unimplemented and un-testable pre-release (there is no real version yet at `v0.0.0`).
