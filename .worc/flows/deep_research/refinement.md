Refine the research question for the **wastech-mdlint** repository into a precise, answerable brief before any investigation begins.

## Project grounding

This repo is being re-platformed from a single-package CLI into the v2 workspace product
(`@wastech-mdlint/core`, `@wastech-mdlint/cli`, `@wastech-mdlint/mcp-server`). The authoritative
plan lives under `{repo}/docs/mdlint_v2/`:

- Roadmap: `docs/mdlint_v2/index.md` (phases `P0`…`P9`).
- Locked requirements: `docs/mdlint_v2/requirements/` (`01-configuration` … `06-installation`).
- Decisions: `docs/mdlint_v2/decisions/`.
- Per-phase task files: `docs/mdlint_v2/P0-foundations/` … `docs/mdlint_v2/P9-release/`, each with an
  `index.md` (dependency table, sequence diagram, phase exit criteria) plus numbered task files.
- Canonical vocabulary: `docs/mdlint_v2/glossary.md` — use its exact terms; do not coin synonyms.

Shipped code lives in `{repo}/packages/{core,cli,mcp-server}/`; legacy single-package code may still
sit in `{repo}/src/` and `{repo}/test/`. Actual per-task delivery evidence (what an implementation run
really produced) is under `{repo}/.worc/logs/<task-id>/` (`summary.md`, `validation_report.json`,
`plan.md`, `current.diff`).

**Precedence when documents disagree:** (1) the specific phase task file, (2) the locked requirement,
(3) the decision, (4) the roadmap index. Flag it explicitly in the brief if the question straddles a
known contradiction.

## Your job

State the scope, the concrete sub-questions to investigate, and what a complete answer must cover.
Anchor each sub-question to where its evidence lives (a phase task file, a requirement, a `packages/`
module, a test directory, a `.worc/logs/` run).

If the question is a **plan-vs-implementation audit** (e.g. "find weak or underdeveloped areas across
P0–P8"), decompose it along the roadmap. Per phase, the sub-questions become: does the shipped code in
`packages/` satisfy that phase's exit criteria and its cited requirements; is test coverage adequate
for that phase's coverage priorities; are the architecture invariants (core owns the pipeline; CLI/MCP
are thin adapters; single `ParsedDocument` parse; registry-driven rules; shared `ContextGraph`;
deterministic POSIX output; JSONC config with local `$schema`) actually upheld; and — the failure mode
worth special attention — **did any phase depend on work that only landed in a later phase, leaving a
gap that was never closed once the later phase shipped**. Name the specific dependency chains to check;
each phase `index.md` lists `Depends on` / `Blocks`.

Do not edit code or write files. Return the typed structured result required by the output schema.
Set `human_input` only when a material ambiguity cannot be resolved from repository evidence (e.g.
which phases are in scope, or which definition of "done" applies); if a `human_input` context file is
present, apply that answer and do not repeat the question.
