# P9.08 · (Stretch) Scope the id-ref scan to prose, not code fences

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** ·
> Status **Not started / backlog** · **Stretch** — gated on a P1 parser change.
> Audit finding **L-6** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Stop id-ref graph edges from materializing for IDs that appear only inside fenced code blocks,
inline code, or frontmatter — which inflates `impact`/`slice` blast radius and GRP-002 in-degree.

## Problem (from the audit)

`buildIdRefEdges` (`packages/core/src/graph/build-context-graph.ts:49,85`) scans the raw
`document.content`, so an ID token inside a ```code fence``` still creates a real `id-ref` edge.
This is a **documented, accepted** v2 limitation (finding A, pinned by an existing test), not a
plan violation — it is captured here so the trade-off is tracked, not lost.

## Why this is a stretch item

Fixing it correctly requires the P1 parser to expose prose-only spans (content with code/inline
code/frontmatter excluded) so the scan can run against prose rather than raw text. That is a
parser-contract change, so this task is a backlog candidate rather than release-blocking.

## Deliverables / steps (if picked up)

1. Extend `ParsedDocument` to expose prose-only text spans (or a code-block mask) from the single
   parse pass.
2. Point `buildIdRefEdges` at prose spans instead of `document.content`.
3. Update the test that currently pins the code-fence-inflation behavior to assert the corrected
   behavior; add a fixture with an ID that appears only inside a code fence.

## Exit criteria

- [ ] IDs appearing only in code/inline-code/frontmatter no longer create `id-ref` edges.
- [ ] `impact`/`slice`/GRP-002 no longer count code-fenced IDs.
- [ ] Or: explicitly deferred to the backlog with a dated note (acceptable outcome for a stretch item).
