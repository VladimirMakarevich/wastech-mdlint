# P2.01 · Engine core types — `Rule` / `RuleContext` / `LintMessage` / `runRules`

> Phase: [P2 — Rule engine & new config model](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **M** · Status **Done** · Design/types task.

## Goal

Define the rule-engine contracts that every rule, primitive, and host depends on — improved
with structured findings, orchestrator-owned severity, and a fix hook.

## Sequence

- **Previous:** [P1.06 — Parser tests & fixtures](../P1-parsed-document/06-parser-tests-fixtures.md)
  delivered a frozen `ParsedDocument` + `loadDocuments()`.
- **Next:** [P2.02 — Assertion primitives](02-assertion-primitives.md) implement executors that
  emit these `LintMessage`s.
- **Depends on:** P1 complete · **Blocks:** all of P2.

## Inputs (from previous work)

- `ParsedDocument` (P1) and the [rules requirements](../requirements/02-rules-engine.md).
- Engine requirements [R1–R4](../requirements/02-rules-engine.md).

## Deliverables / steps

1. `Rule { id, description, category, defaultSeverity, scope?: "document"|"project",
   fixable?, docsUrl?, check(ctx), fix?(ctx) }` — severity is a **default**
   ([R1](../requirements/02-rules-engine.md)); optional `fix?` returning text edits
   ([R2](../requirements/02-rules-engine.md)).
2. `RuleContext { document, filePath, projectFiles?, documents?, settings, graph?, report() }`
   — `settings` carries inherited config (e.g. `siteRouter`, [C5](../requirements/01-configuration.md));
   `graph` is the shared `ContextGraph`, **injected by the orchestrator (P2.05) starting in P3**
   — the relocated legacy builder in P3, swapped to the semantic `buildContextGraph` in P4
   ([R5](../requirements/02-rules-engine.md)). It stays typed as `graph?` (document-scope rules
   ignore it), but graph rules consume it directly rather than building a local adjacency
   (audit 2.2). The minimal read shape GRP-001/002 depend on — the explicit cycle list
   ([G6](../requirements/03-context-graph.md)) and node `inDegree`/`outDegree` — is part of the
   `ContextGraph` type ([P4.01](../P4-graph/01-context-graph-model.md)) and does not change when
   the builder is swapped.
3. `LintMessage { ruleId, severity, message, line, column?, endLine?, filePath?, fixable?,
   data?, helpUri? }` — structured fields per [R3](../requirements/02-rules-engine.md);
   existing fields unchanged (superset).
4. `runRules(rules, document, filePath, ctxExtras)` — callback `report()` model; **throws**
   if a project rule is missing `documents` ([R4](../requirements/02-rules-engine.md)).

## Decisions applied

- [R1](../requirements/02-rules-engine.md) default severity · [R2](../requirements/02-rules-engine.md)
  fix hook · [R3](../requirements/02-rules-engine.md) structured findings ·
  [R4](../requirements/02-rules-engine.md) fail-fast · [C5](../requirements/01-configuration.md) settings.

## Exit criteria

- [ ] All engine types compile and are exported from core.
- [ ] `runRules` throws (not no-ops) on missing `documents` for project rules.
- [ ] `LintMessage` is a strict superset of the current `Finding` shape.

## Hand-off to next

P2.02 implements primitive executors that build these `LintMessage`s; P2.03 registers rules
that declare this metadata.
