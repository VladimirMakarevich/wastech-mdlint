# P9.08 · (Stretch) Scope the id-ref scan to prose, not code fences

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** ·
> Status **Deferred to backlog (2026-07-25)** · **Stretch** — gated on a P1 parser change.
> Audit finding **L-6** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Stop id-ref graph edges from materializing for IDs that appear only inside fenced code blocks,
inline code, or frontmatter — which inflates `impact`/`slice` blast radius and GRP-002 in-degree.

## Problem (from the audit)

`buildIdRefEdges` (`packages/core/src/graph/build-context-graph.ts:49,85`) scans the raw
`document.content`, so an ID token inside a `code fence` still creates a real `id-ref` edge.
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
- [x] Or: explicitly deferred to the backlog with a dated note (acceptable outcome for a stretch item).

## Deferral note (2026-07-25)

Deferred to the backlog rather than implemented. This is the accepted outcome per this task's own
framing (stretch, gated on a P1 parser change, excluded from the [P9 phase exit
criteria](index.md)) and per the audit's characterization of finding L-6 as a documented, accepted
v2 limitation, not a plan violation.

Confirmed still gated, not just historically gated:

- `ParsedDocument` (`packages/core/src/markdown/document-types.ts`) still has no per-node text
  spans or code-block mask; `content` is still the only text field, so `buildIdRefEdges` has
  nothing to scan except raw text.
- Frontmatter is not part of the prose/code distinction the parser can currently make: the shared
  `remark`/`remark-gfm` processor in `parse-document.ts` has no frontmatter plugin (no
  `remark-frontmatter` dependency), so a YAML frontmatter block is not even a distinct AST node
  today. Excluding it correctly would mean either adding a new dependency (blocked by this repo's
  "no dependency without explicit approval" rule) or hand-rolling frontmatter-fence detection
  as a second, parallel bit of Markdown scanning — both are out of scope for a stretch item.
- The current false-positive behavior is intentional, not accidental: it is already called out with
  a `KNOWN LIMITATION` comment at `build-context-graph.ts:46-51` and pinned by
  `packages/core/test/build-context-graph.test.ts`'s "still builds an id-ref edge for an ID that
  appears only inside a fenced code block (known limitation, finding A)" test. No product code or
  test in this area was changed by this pass.

Revisit if a future phase adds prose-only spans to `ParsedDocument` for another reason (at which
point `buildIdRefEdges` should switch to them per the deliverables above), or if code-block noise
in `impact`/`slice`/GRP-002 is reported as materially costly in practice.
