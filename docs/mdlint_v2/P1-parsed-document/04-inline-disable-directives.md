# P1.04 · Inline-disable directive extraction

> Phase: [P1 — ParsedDocument & parser upgrade](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **S** · Status **Done**.

## Goal

Capture inline suppression directives written as HTML comments, with positions and target
rule IDs, so the rule engine ([P2](../index.md)) can suppress findings precisely. The parser
only *extracts* them; the engine *applies* them.

## Sequence

- **Previous:** [P1.03 — References extraction](03-references-extraction.md) completed the
  reference-like nodes in the same traversal.
- **Next:** [P1.05 — loadDocuments()](05-load-documents.md) packages fully-parsed documents
  into the deterministic loader.
- **Depends on:** P1.03 · **Blocks:** P1.05, and directive application in [P2](../index.md).

## Inputs (from previous work)

- The single-pass traversal and `content` from P1.02/P1.03.
- The directive design from [R8](../requirements/02-rules-engine.md).

## Deliverables / steps

1. Recognize HTML-comment directives in Markdown (markdownlint-style, decided 2026-07-02 —
   audit 2.4):
   - `<!-- wastech-mdlint-disable [RULE-ID, RULE-ID…] -->`
   - `<!-- wastech-mdlint-enable [RULE-ID, RULE-ID…] -->`
   - `<!-- wastech-mdlint-disable-next-line [RULE-ID, RULE-ID…] -->`

   A directive with **no rule IDs applies to all rules**.
2. Emit `directives: { kind: "disable" | "enable" | "disable-next-line", ruleIds, line }[]` on
   `ParsedDocument` (`ruleIds` empty ⇒ all rules).
3. Normalize rule IDs to canonical form ([C3](../requirements/01-configuration.md):
   `REF-001`, case-insensitive, dash-optional) so the engine matches reliably.
4. Capture `kind` + position so the engine can scope directives (range logic is engine-side,
   P2.05): `disable-next-line` → the following line only; `disable` → from its line until the
   matching `enable` for the same rule(s), or EOF if none; `enable` → re-enables from its line.
   The parser only records `{ kind, ruleIds, line }` — **no new `ParsedDocument` field**.

> The actual suppression (matching directive ranges against reported message lines) is engine
> logic in P2 — keep this task to extraction + normalization only.

## Decisions applied

- [R8](../requirements/02-rules-engine.md) inline-disable · [C3](../requirements/01-configuration.md)
  canonical rule IDs.

## Exit criteria

- [ ] `disable`, `enable`, and `disable-next-line` comments are extracted with kind + line + rule IDs.
- [ ] A directive with no rule IDs is recorded as "all rules" (empty `ruleIds`).
- [ ] Rule IDs normalized to canonical form.
- [ ] Malformed/unknown directives are tolerated (ignored, not fatal).

## Hand-off to next

P1.05 now has a fully-populated `ParsedDocument` (structure + references + directives) to
return from `loadDocuments()`; P2's orchestrator will read `directives` to filter findings.
