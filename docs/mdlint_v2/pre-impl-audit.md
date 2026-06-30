# Pre-Implementation Audit — v2 Planning Gaps & Bottlenecks

> **Date:** 2026-06-25  
> **Scope:** All planning documents — `P0`–`P9`, `requirements/`, `decisions/`  
> **Purpose:** Identify gaps, ambiguities, and unresolved decisions that should be worked out *before* the corresponding implementation phase starts.

---

## Summary

| Category | Count | Phase impact |
|---|---|---|
| P0 blockers (cannot start without) | 3 | Gates everything |
| Architecture forks (rework risk) | 5 | P1–P4 |
| TBD in spec text | 5 | P3, P5 |
| Cross-phase dependency risks | 4 | P6–P8 |
| Underspecified algorithms | 5 | P4–P6 |

---

## Category 1 — P0 Blockers

These are unresolved decisions that prevent starting Phase 0.

### 1.1 Zod version not chosen

**File:** `docs/ctxlint_v2/P0-foundations/01-workspace-decisions.md`

The file explicitly says "decide v4 to match the MCP SDK examples → record the chosen version" but leaves the field blank. MVP uses Zod v3; MCP SDK examples use Zod v4. The APIs are incompatible (`.parse` vs `.safeParse` semantics differ; `.optional()` chaining changed; `.brand()` available in v4 only).

Choosing v3 means MCP server examples need porting. Choosing v4 means migrating MVP config schemas. Either way the decision must be made before `core/src` is created.

**Resolve before P0.01:** record chosen version in the workspace decisions file.

---

### 1.2 TypeScript build strategy not chosen

**File:** `docs/ctxlint_v2/P0-foundations/01-workspace-decisions.md`

The file says: "decide whether to use project references (recommended for incremental builds) or independent `tsc` per package." No decision recorded.

Project references change how `tsconfig.json` files are structured, how `cli` imports `core` (from compiled `dist/` or via path aliases), and how CI runs incremental builds. This must be settled before P0.02 creates the root scaffold.

**Resolve before P0.01.**

---

### 1.3 Decisions D4–D7 not formally confirmed

**File:** `docs/ctxlint_v2/index.md`, §5

D1–D3 are confirmed (monorepo, clean config replace, preserve LLM rules). D4–D7 stand at "recommended defaults unless changed" — no explicit sign-off.

| Decision | Default | Risk if changed |
|---|---|---|
| D4 — `scan` alias | keep one minor version | affects CLI help text and deprecation tests |
| D5 — `commander` + `@inquirer/prompts` | adopt | changes entire P6 init structure |
| D6 — LSP out of v2 scope | out of scope | if re-added, restructures P2 engine |
| D7 — docs site out of scope | out of scope | low risk |

D5 is highest risk — if the CLI framework changes after P6 starts, the whole interactive flow must be rewritten.

**Resolve before P0:** explicit confirmation of D4–D7.

---

## Category 2 — Architecture Forks (Rework Risk)

These are design questions where the wrong answer causes significant code to be discarded or rewritten.

### 2.1 Who extracts table/heading IDs — P1 or P4?

**Files:** `P1-parsed-document/03-references-extraction.md`, `requirements/03-context-graph.md`

P1 explicitly says it is out of scope to build "id-ref edges" — those are a graph concern. But P4 needs to build `id-ref` edges from table-cell/heading IDs. If `ParsedDocument` does not expose normalised IDs, P4 must re-parse the document content itself to find them.

Two options:
- **Option A:** `ParsedDocument` adds `ids: { text: string, column?: string, line: number }[]` — one parse pass covers both rules and graph.
- **Option B:** P4 re-scans raw table cells — parsing happens twice, ownership is blurred.

Option A is cheaper and aligns with the "one parse pass" design goal.

**Resolve before P1.01:** add/reject the `ids` field in the `ParsedDocument` contract.

---

### 2.2 GRP rules in P3 build a local adjacency that P4 replaces

**File:** `docs/ctxlint_v2/P3-rules/06-grp-rules.md`

P3.06 says GRP-001/002/003 "may build a local adjacency (reference behavior)" and that P4 replaces it with the shared `ContextGraph`. This means:

1. GRP rule code is written twice (once simplified in P3, once properly in P4).
2. P3 tests are written against the simplified version, then must change in P4.

This is explicitly labelled as "spec debt" in the document.

Two options:
- **Option A:** defer GRP rules entirely to P4 — P3 exit criteria exclude them.
- **Option B:** define the P3 GRP implementation as a thin adapter that P4 can swap without changing tests (inject `ContextGraph` via interface from the start).

Option B requires defining the `ContextGraph` interface in P2, not P4. That is architectural work but eliminates the rework.

**Resolve before P3 starts.**

---

### 2.3 Testing graph-dependent rules (GRP, REF-005) in P3 without P4's graph

**Files:** `P2-rule-engine/01-engine-core-types.md`, `P2-rule-engine/05-orchestration-lintfiles.md`

`RuleContext.graph` is typed as optional (`graph?`). P3 rules GRP-001 (cycles), GRP-002 (orphans), REF-005 (id traceability) require a real `ContextGraph`. P4 builds the graph. P3 ships before P4.

No guidance exists on whether:
- these rules are tested with injected mock graphs in P3, or
- their integration tests are deferred to P4, or
- a simplified in-memory graph is built as part of P3 utilities.

**Resolve before P3:** document the test isolation strategy for graph-dependent rules.

---

### 2.4 Inline-disable scope semantics

**File:** `P1-parsed-document/04-inline-disable-directives.md`

The spec says: "Capture position so `disable-next-line` can be scoped to the following line and block-level `disable` to its range." But "block" is not defined:

- Does `<!-- wastech-ctxlint-disable -->` apply to the next paragraph? Next section? Until EOF?
- How does the rule engine consume disable ranges? (Line range on `ParsedDocument`? A `Set<number>` of disabled lines per rule?)

This affects both the shape of `ParsedDocument` (P1) and the rule-runner filter logic (P2).

**Resolve before P1.04:** define block semantics and the data structure passed to P2.

---

### 2.5 Semantic edge type taxonomy

**File:** `requirements/03-context-graph.md`

v2 introduces edge types: `link | image | anchor | id-ref | import`. Not specified:

- Is a link to `file.md#section` one edge (type `link`) or two (type `link` + type `anchor`)?
- Is an `@import` also a `link` or exclusively `import`?
- Does `image` overlap with `link` (images wrapped in anchors)?

The answer changes how `topologicalSort`, `getContextSlice`, and `classifyImpact` filter edges.

**Resolve before P4.01:** write the formal taxonomy table with an example for each edge type.

---

## Category 3 — Explicit TBDs in Spec Text

These are literal `TBD`, `?`, or blanks in task files that block implementation.

### 3.1 CTX-001 default placeholder set

**File:** `docs/ctxlint_v2/P3-rules/05-chk-ctx-rules.md`

Quote: "`placeholders?` (default set **TBD/TODO/WIP/FIXME/N/A**, extensible...)"

The word "TBD" is used both as a placeholder word *and* to signal the decision is pending. The default list is not locked.

**Resolve before P3.05.**

---

### 3.2 LLM-001 per-type limits

**File:** `docs/ctxlint_v2/P3-rules/07-llm-rules.md`

"per-type limits?" — question mark left in the spec, no answer. Does LLM-001 support a single total budget per entrypoint, or per-category budgets (e.g., separate limits for `@import` of rule docs vs. reference docs)?

The configuration schema for LLM-001 options is incomplete.

**Resolve before P3.07.**

---

### 3.3 Node role thresholds for the compiler

**File:** `docs/ctxlint_v2/P5-compile/01-graph-analysis.md`

`classifyNodes` assigns roles `entry | hub | leaf | isolated | bridge`. No formal thresholds are given (e.g., "inDegree ≥ 3 && outDegree ≥ 1 → hub"). Without thresholds the implementation is arbitrary and the generated `SKILL.md` will vary across corpora unpredictably.

**Resolve before P5.01.**

---

### 3.4 Compile preset examples missing

**File:** `docs/ctxlint_v2/P5-compile/04-synthesize.md`

`compile --preset claude|generic|none` is specified but no example output is shown for any preset. "generic" and "none" are particularly vague. Without examples, the synthesise step cannot be validated against expected output.

**Resolve before P5.04.**

---

### 3.5 Custom rule ID namespace

**File:** `docs/ctxlint_v2/P3-rules/08-custom-rule.md`

"Enforce a **namespaced `id`** that cannot collide with built-in canonical IDs." The namespace prefix is not defined. Is it `CUSTOM-*`? A user-chosen prefix? A regex pattern? This affects both the Zod schema (P2.03/P3.08) and the generated `schema.json` (P2.06).

**Resolve before P3.08.**

---

## Category 4 — Cross-Phase Dependency Risks

These are places where a downstream phase's stability depends on an upstream phase's API being frozen.

### 4.1 P2.06 schema generator API → P6.04 local schema wiring

P6.04 generates a project-local `$schema` for projects with custom rules. It depends on the same generator as P2.06. If P2.06 changes its output format or API after P6.04 starts, the wiring breaks.

**Mitigation:** freeze the `generateSchema(rules[])` public API signature before P6.04 begins.

---

### 4.2 P3 `--fix` engine → P8.03 `-fix` skill

The `wastech-ctxlint-fix` skill delegates repairs to the core `--fix` engine. The skill's fix policy (per rule prefix) assumes stable CLI exit behaviour. If P3's `--fix` API changes after P8 starts, the skill's prompts and action sequences break.

**Mitigation:** document which rules support `--fix` and with what behaviour before starting P8.03.

---

### 4.3 P4 query layer stability → P7 MCP tools

`context-slice` and `impact-analysis` MCP tools (P7.03) are thin wrappers over P4's `query`, `getContextSlice`, and `classifyImpact`. Any breaking change to the P4 API after P7 starts requires changes to both the tool layer and its tests.

**Mitigation:** P4 public API (function signatures and return types) must be frozen before P7.01 starts.

---

### 4.4 P5 compiler → P7.04 `compile-context` + P8

`compile-context` MCP tool and skill generation both depend on P5's `synthesize()` and `CompileResult` type. These must be stable before P7 and P8 start.

---

## Category 5 — Underspecified Algorithms

These are implementation areas where no algorithm or data-structure decision is documented, creating implementation risk.

### 5.1 Heading slug collision handling

**File:** `P4-parsed-document/04-search-index-slice.md` (referenced), `P1/03`

GitHub-style slugger (`github-slugger`) deduplicates colliding headings with a `-1`, `-2` suffix. The spec says "exact anchor resolution" but does not state whether the implementation uses GitHub-style dedup or fails on collision. CJK headings and special characters are mentioned but not specced.

The MVP already has `github-slugger` — the question is whether its exact dedup behaviour is the canonical contract or just an implementation detail.

**Resolve before P4.04.**

---

### 5.2 Transitive impact has no depth bound

**File:** `docs/ctxlint_v2/P4-graph/05-impact-analysis.md`

`transitivelyAffected (with via)` traverses the reverse graph. No maximum depth or visited-set constraint is documented. In a graph with cycles (which GRP-001 reports but does not prevent), this is an infinite loop.

Even without cycles, a hub file touched by almost everything will produce huge impact sets.

**Resolve before P4.05:** require a `visited` set (standard for BFS/DFS) and document whether depth is capped.

---

### 5.3 Block-to-section ownership rule

**File:** `P1-parsed-document/02-block-structure.md`

"Track the 'current section' while walking so tables/checkItems can record their enclosing heading." Not defined:

- If a table follows an H3 that follows an H2, does the table belong to the H3 or H2 section?
- What is returned when no heading precedes the block?
- Does a new heading of *higher* level (e.g., H1 after H3) close intermediate sections?

**Resolve before P1.02:** write the rule explicitly (recommendation: "belongs to the most-recent heading above regardless of level; `null` if none").

---

### 5.4 Cluster detection scoring for `init`

**File:** `P6-init/01-repo-scan.md`

"Boost known layouts (`docs/`, `specs/`, `adr/`) without hardcoding `docs/`" — no scoring algorithm is specified. What constitutes "enough Markdown files" to call something a cluster? How does monorepo detection work (multiple `package.json` files at different depths)?

**Resolve before P6.01:** at minimum a pseudocode scoring heuristic.

---

### 5.5 ID-ref edge discovery strategy

**File:** `requirements/03-context-graph.md`, `P4-graph/01-context-graph-model.md`

"id-ref edges using config `idPattern`" — when a document links to a table-cell ID in another document, the graph must know which cells contain IDs. The spec does not say whether this is:

- **Column-based only:** only cells in columns declared as `definitions` in REF-005 config, or
- **Pattern-based:** any cell matching `idPattern` anywhere in the corpus.

Column-based is cheaper and explicit. Pattern-based enables discovery without config. The choice changes both P4.01 (graph model) and REF-005 (P3.04).

**Resolve before P4.01.**

---

## Additional Gaps by Phase

### P3 — Reference rules

**REF-005/006 ID traceability:** how are orphaned definitions detected if `idPattern` is present but no explicit `references` column? The spec lists "dangling refs (error) and orphan defs (warning)" without defining what counts as an orphan when the definition table is implicit.

**REF-001 site-router + translated paths:** when a source document is in a translated subdirectory (e.g., `/docs/es/...`) and `siteRouter.urlPrefix` is active, how are relative links resolved? Not addressed.

---

### P4 — Graph algorithms

**Component sort order:** `getComponents` returns "sorted" components but no sort key is defined. Sorted by size descending? By entry node path? This affects determinism tests on different file systems.

**Edge de-duplication (G7 backlog):** the spec explicitly defers deduplication — "edges are not deduplicated in P4." If file A links to file B three times, three edges exist. This is correct, but it should be stated explicitly for cycle detection: do multiple edges between the same pair of nodes count as one cycle or multiple?

---

### P6 — `init` config merge semantics

When `init` runs over a repo that already has a `wastech-ctxlint.config.json`, the spec says "overwrite / merge / skip" but does not define merge semantics. Does merge:
- preserve existing rules and append inferred rules (additive)?
- replace the `rules[]` array with the inferred set?
- prompt per-rule?

This affects both the P6.03 prompt flow and the P6.04 writer.

---

### P7 — MCP server error taxonomy

The spec defines `{ code, message, hint }` for error responses but does not enumerate the error codes. Without a code taxonomy, clients cannot handle errors programmatically and the "never leak stack traces" rule has no implementation guide.

---

### P9 — `engines.node` version constraint

`>=24.17.0 <25` excludes Node 25. The rationale is not stated. If this is a permanent constraint (not a temporary one for launch), Node 25 LTS users will be excluded. If it is a conservative first-release choice, the plan should say so and name the milestone at which it relaxes.

---

## Recommended Pre-Implementation Order

```
1. Confirm D4–D7                                   (before P0 kickoff)
2. Choose Zod version                              (before P0.01 closes)
3. Choose TS build strategy                        (before P0.02)
4. Define ParsedDocument.ids field (yes/no)        (before P1.01 contract)
5. Define block-to-section ownership rule          (before P1.02)
6. Define inline-disable scope semantics           (before P1.04)
7. Define GRP rule strategy: defer or adapter      (before P3 kickoff)
8. Define graph rule test isolation strategy       (before P3 kickoff)
9. Resolve CTX-001 placeholder defaults            (before P3.05)
10. Resolve LLM-001 per-type limits                (before P3.07)
11. Define custom rule ID namespace                (before P3.08)
12. Freeze P2.06 schema generator API              (before P6.04 starts)
13. Specify semantic edge type taxonomy            (before P4.01)
14. Define heading slug collision algorithm        (before P4.04)
15. Add visited-set / depth cap to impact BFS      (before P4.05)
16. Define ID-ref edge discovery strategy          (before P4.01)
17. Define node role thresholds                    (before P5.01)
18. Write compile preset examples                  (before P5.04)
19. Define cluster detection scoring               (before P6.01)
20. Define config merge semantics                  (before P6.03)
```
