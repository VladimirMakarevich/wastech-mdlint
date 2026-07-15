# P8.04 · `wastech-mdlint-impact` skill

> Phase: [P8 — Static skills](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**.

## Goal

Author the blast-radius skill that wraps the impact engine (CLI or MCP) and presents
actionable findings.

## Sequence

- **Previous:** [P8.01 — Frontmatter schema](01-frontmatter-schema-model.md) and the impact
  surface (CLI [P4.07](../P4-graph/07-cli-graph-slice-impact.md) / MCP [P7.03](../P7-mcp-server/03-graph-tools.md)).
- **Next:** [P8.05 — Skills validation](05-skills-validation.md).
- **Depends on:** P8.01, P4, P7 · **Parallel with:** P8.02, P8.03.

## Deliverables / steps

1. `skills/wastech-mdlint-impact/SKILL.md` with valid frontmatter.
2. Workflow: verify setup (recommend REF-001/GRP-001 enabled) → resolve target (file or ID →
   containing file) → run `impact <file> --format json` **or** prefer the MCP
   `impact-analysis` tool when available → group `directlyAffected` / `transitivelyAffected` and
   surface the `readingOrder` plus the cycle-`excluded` nodes (the actual JSON fields; there is no
   `hubs` field — hub context needs a separate `graph` call) → recommend follow-ups (often `-fix`).
3. Host-neutral; placeholders replaced ([S7](../requirements/04-skills-compile.md)).

## Decisions applied

- [S7](../requirements/04-skills-compile.md) host-neutral · prefers MCP tool when present
  ([M2](../requirements/05-mcp-server.md) honest semantics).

## Exit criteria

- [x] Skill resolves a target and reports direct/transitive impact with follow-ups.
- [x] Uses CLI or MCP; frontmatter valid; host-neutral.

## Hand-off to next

P8.05 validates all three skills together and checks host-neutrality.

## Implementation notes

`skills/wastech-mdlint-impact/SKILL.md` is the sole deliverable — a hand-authored,
host-neutral skill, no product code. Frontmatter mirrors P8.02/P8.03 and uses only the keys
P8.01's `.strict()` schema permits, so it passes P8.05's standing validation sweep.

Non-obvious decisions the prose encodes, and why:

- **Field-shape honesty across the two hosts.** The impact engine is reachable two ways and
  the payloads are _not_ identical, so the skill documents the delta rather than papering over
  it: the CLI JSON names the changed file `changedFile` and adds a `lint` field (findings on
  the affected subgraph); the MCP `impact-analysis` tool names it `file` and has **no** `lint`.
  Both share `directlyAffected` (`{path, references}`), `transitivelyAffected`
  (`{path, depth, via}`), `readingOrder`, and `excluded`. The skill also states plainly that
  there is **no `hubs` field** on either surface — hub context is a separate `graph` /
  `context-graph` query — so an agent never invents one.
- **Reading order is topological, and its direction is spelled out.** Graph edges run
  `referrer → referenced`, so `readingOrder` (a Kahn sort over the affected subgraph) emits
  referrers/dependents _before_ the file they depend on — the changed file typically comes
  **last**. The skill says this explicitly and forbids re-sorting or a "dependencies first"
  reading, because getting the direction backwards silently inverts the guidance an agent gives.
- **Target resolution reads `starts`, not `files`, and mirrors the MCP-preferred choice.**
  `impact` takes a repository-relative POSIX file path, not an ID; an ID/anchor/heading is
  resolved first via `slice` / the MCP `context-slice` tool, reading the resolved target from
  `starts` (the query's own match) rather than `files` (the whole depth-bounded slice, which
  would drive `impact` on a neighbor). Multiple `starts` is treated as ambiguous — ask, don't
  guess. Resolution prefers MCP `context-slice` when the host exposes it and falls back to CLI
  `slice`, keeping the skill host-neutral on the MCP-only path too.
- **REF/GRP rules recommended, never required.** The ContextGraph is built unconditionally, so
  impact does not depend on any rule being enabled; the skill recommends REF-001/002 (keep
  edges matching author intent) and GRP-001 (explains `excluded` cycle drops) "for meaningful
  results" without the false claim that impact requires them. ID-reference edges — and ID query
  resolution — are noted as conditional on `settings.idRef`.

Prefers the MCP tool when present ([M2](../requirements/05-mcp-server.md) honest semantics) and
stays host-neutral with placeholders resolved to `VladimirMakarevich/wastech-mdlint`
([S7](../requirements/04-skills-compile.md)). No glossary change: `static skill`, `SKILL.md`,
the `impact-analysis` / `context-slice` / `context-graph` MCP tools, and the referenced rule IDs
are already defined; this is an instance of them, not a new term.
