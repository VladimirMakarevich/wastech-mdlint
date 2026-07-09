# P6.02 · Rule inference / category → zero-config rule set

> Phase: [P6 — init](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Turn the scan into a proposed rule set: sample files, detect patterns, and map rule
categories to concrete canonical rule IDs with rationale.

## Sequence

- **Previous:** [P6.01 — Repo scan](01-repo-scan-detection.md) (clusters + samples).
- **Next:** [P6.03 — Interactive prompts](03-interactive-prompts.md).
- **Depends on:** P6.01 + rule metadata ([P2.03](../P2-rule-engine/03-registry-metadata.md)) ·
  **Blocks:** P6.03.

## Deliverables / steps

1. Read 3–5 sample files per cluster; detect patterns (cross-refs, tables, ADR triplets,
   checklists, placeholders, potential cycles).
2. Category → rule mapping (canonical IDs, [C3](../requirements/01-configuration.md)). **Do not
   hardcode IDs** — group `ruleRegistry.getAllMetadata()` on `metadata.category` so the mapping
   tracks the registry ([R6](../requirements/02-rules-engine.md); the registry comment states this
   metadata "drives … init categories (P6)"). The full built-in space is **8 categories / 24
   rules**: REF (REF-001..006), TBL (TBL-001..006), CTX (CTX-001..003), SEC (SEC-001..003), GRP
   (GRP-001..003), STR (STR-001), SIZE (SIZE-001), LLM (LLM-001) — there is no `CHK` category
   (checklist is `CTX-002`). Inference maps detected patterns to a subset of these.
3. Produce a draft rule set + per-rule rationale string for the prompt step.

## Decisions applied

- [I2](../requirements/06-installation.md) inference · [C3](../requirements/01-configuration.md)
  canonical IDs · [R6](../requirements/02-rules-engine.md) metadata-sourced mapping.

## Implementation notes

- Only 7 of the 24 built-in ids are gated on detectable sample evidence: `REF-001/002/003`,
  `TBL-002`, `CTX-001/002`, and `GRP-001` (presence-only gates — link/anchor/image/table/
  checklist/placeholder counts > 0, no magic thresholds). Every other built-in has a *required*
  option with no safe way to derive it from 3–5 sampled files (a pipeline `chain`, a `template`
  file, a `zonesDir`, an idColumn/idPattern split, a glossary table, an enumerated `values` set,
  etc.) and proposing one with a fabricated required option risks either a `ConfigError` or a
  misleading, made-up constraint — worse than not proposing it at all.
- `SEC-001` is the one rule proposed cluster-scoped (`options.files`/`options.sections`) rather
  than repo-wide: it is the only gated rule whose Zod schema both supports `files` scoping *and*
  has a derivable option (`sections`, from a shared ADR heading triplet). `REF-003`'s schema has
  no `files` key at all — passing one is a `.strict()` violation, not a no-op — and `GRP-001`
  declares `fileScopeShape` but its check body explicitly ignores `files`/`exclude` for now, so
  scoping it would be silently meaningless. The other five are naturally whole-corpus concerns
  (reference/table/checklist/placeholder integrity), so they are proposed once, globally.
- ADR-triplet detection is a two-part, deliberately asymmetric gate: a case-insensitive vocabulary
  match against `{status, context, decision}` (≥2 of 3, every sampled doc in the cluster) decides
  *whether* the cluster is ADR-like; a case-**sensitive** exact-string intersection of
  `doc.sections` across every sample in the cluster (filtered to the ADR vocabulary, now including
  `consequences`/`alternatives`) decides *what to require*. The split exists because
  `sectionPresent` (SEC-001's own primitive) matches section names case-sensitively — requiring a
  heading whose casing isn't guaranteed identical across every sample would risk a false SEC-001
  finding later, which is worse than the alternative (a missed proposal), a trade-off the exit
  criteria explicitly allow. That intersection preserves the *first* sampled doc's reading order
  rather than alphabetizing: `doc.sections` is a reading-order sequence, and SEC-001's fix
  scaffolds any missing section in the order `options.sections` lists them, so alphabetizing would
  silently reorder that scaffold away from how the sampled ADRs actually read.
- The category→rule mapping is never a parallel hardcoded table: it groups
  `registry.getAllMetadata()` by `metadata.category` and flattens that into an id-keyed lookup, so
  a renamed or removed rule silently drops its gate/SEC-001 proposal instead of crashing or
  emitting a dangling id (registry-drift safety, exercised with a trimmed registry in the tests).
- Gate counters must mirror exactly what each rule evaluates, not just detect a pattern's rough
  presence — otherwise a rule gets proposed from evidence it would never look at. `REF-001`/
  `GRP-001` skip a `local-file` link whose file part is empty (as `linkResolves` does); `REF-003`
  skips an empty or scheme-qualified image target such as `http:`/`data:` (as `imageResolves`
  does).
- The cross-cluster cycle heuristic that backs `GRP-001`'s rationale is an explicit approximation
  over sampled files only (a bounded DFS over the combined sample map) — it exists solely to make
  the rationale concrete; the authoritative cycle check still runs later over the full corpus via
  `buildContextGraph`. Its edge resolution applies the same "match what the real rule evaluates"
  discipline: it resolves targets through the shared `resolveTargetCandidates` helper (so a
  root-relative link isn't misresolved as source-relative) and only counts an anchored link as an
  edge when the target sample's heading slugs actually contain that anchor (as `REF-002` does) —
  otherwise the heuristic could report a cycle the real `ContextGraph` would never build. It
  returns the *entire* sampled cycle path, not just the DFS back-edge, for the same reason: for a
  3-node sampled cycle `a -> b -> c -> a` the back-edge alone is `(c, a)`, and wording that pair as
  "c and a reference each other" would be false — only `a -> b` and `c -> a` actually exist as
  sampled links.
- `SEC-001`'s inferred `files` scope is the cluster's own `includeGlob`, but that glob is not
  guaranteed to match the cluster's own sampled files: `scanRepository`'s global fallback cluster
  can sample `.mdx` files under the literal glob `**/*.md` (deliberately not `.mdx`-aware, since
  it mirrors the tool's real zero-config default rather than the scan's own discovery criteria).
  Before proposing `SEC-001`, every sampled file must match `includeGlob`, or the proposal is
  skipped — otherwise it would be valid config that checks none of the evidence that justified it.
- A sample path going stale between P6.01's scan and this call (deleted/renamed on disk) is
  skipped, not thrown — the read+parse pairing mirrors `load-documents.ts`'s existing
  read-then-parse step, wrapped in a per-file try/catch.

## Exit criteria

- [x] Sampling produces a justified draft rule set per cluster.
- [x] Category→rule mapping derives from rule metadata (no hardcoded drift).

## Hand-off to next

P6.03 presents this draft (with rationale) for confirmation, or accepts it as-is under `--yes`.
