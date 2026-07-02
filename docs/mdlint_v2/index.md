# wastech-mdlint v2 — Production Roadmap

> **Status:** Draft for review · **Owner:** TBD · **Created:** 2026-06-21
>
> This document is the top-level roadmap for turning the current single-package implementation into the
> production-ready target product. It defines the gap, the target architecture, the
> phased plan, and the decisions we confirmed before deep work. Each phase has its own
> detailed folder under `docs/mdlint_v2/` (meta `index.md` + numbered task files), the same way
> [docs/plan/](../plan/00-meta-plan.md) broke v1 into 16 tasks.

---

## 1. TL;DR

The current implementation ([PLAN.md](../PLAN.md)) shipped a **single-package CLI** with two commands
(`scan`, `graph`) and five hardcoded checks (size, broken links, orphan docs,
eager imports, context budget). It is clean and well-factored, but its config
model and rule model are **fundamentally different** from the target product.

The target is a substantially larger product (**`wastech-mdlint`**):

- a **`@wastech-mdlint/core`** engine with a **registry of 22 built-in
  schema-validated rules** across 7 categories (`TBL`, `SEC`, `STR`, `REF`, `CHK`, `CTX`,
  `GRP`), plus `SIZE-001`, `LLM-001`, and the declarative `custom` rule;
- a richer **`ParsedDocument`** (tables, sections, checklists, images) and a
  **`ContextGraph`** with `slice` / `impact` / `topological-sort` / `components`;
- a **`@wastech-mdlint/cli`** with `lint` (default) · `init` · `graph` · `slice`
  · `impact` · `compile`;
- a **`@wastech-mdlint/mcp-server`** exposing 6 deterministic tools over stdio;
- a **context compiler** that generates a project-specific `SKILL.md`;
- **3 hand-authored Agent Skills** (`-init`, `-fix`, `-impact`) distributed via
  agentskills.io;
- npm + skill + MCP **distribution channels** under one version tag.

**v2 is therefore a re-platforming, not an extension.** We keep and reuse the
current implementation's strong primitives (remark parsing, graph building, discovery, token
heuristic, deterministic sorting) but rebuild the config model, rule model, CLI
framework, and packaging to match the target. The plan below sequences that work
so each phase ships something runnable.

---

## 2. Current state — what we keep

Single package `wastech-mdlint`, Node 24.17 LTS, ESM, TypeScript NodeNext.

| Module | Status | Reuse in v2 |
| --- | --- | --- |
| `src/markdown/parse.ts` (remark + gfm + slugger) | Solid | **High** — extend into `ParsedDocument` (add tables, checkItems, sections) |
| `src/graph/build.ts` (dependency graph) | Solid | **High** — extend into `ContextGraph` (in/out degree, edge type+line) |
| `src/discovery/` (micromatch globbing) | Solid | **High** — becomes `loadDocuments()` |
| `src/llm/budget.ts` (`estimateTokens = ceil(len/4)`) | Solid | **High** — keep isolated as the token estimator |
| `src/rules/{local-links,size,structure}.ts` | Works | **Medium** — logic reusable, but re-expressed as registry rules |
| `src/config/` (Zod v3, sectioned config) | Works | **Low** — config model is replaced (see §4) |
| `src/cli.ts` (hand-rolled arg parser) | Works | **Low** — replaced by `commander` |
| `src/reporting/render.ts` | Works | **Medium** — superseded by `format.ts` |
| Test fixtures (`test/fixtures/*`) | Good pattern | **High** — keep the fixture-per-scenario approach |

Key takeaway from the audit: **every analysis primitive is cleanly separated and
reusable; the coupling is only in CLI orchestration and the config shape.** That
is exactly the part the target architecture also wants centralized in `core`.

---

## 3. Target state — what we build

Each capability area has a locked requirements doc under [requirements/](requirements/index.md):

| Area | What it defines | New in v2? |
| --- | --- | --- |
| [Context graph & search](requirements/03-context-graph.md) | `ContextGraph`, `slice`, `impact`, topo-sort, components | Extends the current graph implementation |
| [Rules & rule engine](requirements/02-rules-engine.md) | `Rule`/`RuleContext`/`runRules`, registry, 22 built-in rules | **New engine** |
| [Configuration](requirements/01-configuration.md) | `{ include, rules[], compile }`, `findConfig`, JSON schema | **New model** |
| [MCP server](requirements/05-mcp-server.md) | 6 stdio tools over core | **New package** |
| [Skills & compile](requirements/04-skills-compile.md) | static skills + generated `SKILL.md` (compile) | **New** |
| [Installation](requirements/06-installation.md) | `gh skill install`, `npx` MCP, npm + `init` flows | **New** |

### 3.1 Rule inventory (the bulk of the work)

22 built-in rules, registered statically, each with a Zod options schema, `document` or
`project` scope, and a fixed severity (`error` | `warning`):

- **TBL (tables, 6)** — `TBL-001` required columns · `TBL-002` non-empty
  cells · `TBL-003` allowed values · `TBL-004` cell regex · `TBL-005`
  cross-column conditional · `TBL-006` unique IDs across files *(project)*.
- **SEC (sections, 3)** — `SEC-001` required sections · `SEC-002` section order · `SEC-003` template conformance *(project)*.
- **STR (structure, 1)** — `STR-001` required files exist *(project)*.
- **REF (references, 6)** — `REF-001` relative links resolve · `REF-002`
  anchor/heading slugs · `REF-003` images resolve · `REF-004` cross-zone link
  declaration · `REF-005` ID traceability *(project)* · `REF-006` stability
  consistency *(project)*.
- **CTX (content quality, 3)** — `CTX-001` no placeholder/empty sections ·
  `CTX-002` all checklist items checked · `CTX-003` glossary alias usage *(project)*.
- **GRP (graph integrity, 3)** — `GRP-001` no cycles *(project)* ·
  `GRP-002` no orphan docs *(project)* · `GRP-003` ID chain across stages *(project)*.

Note: the current `links/broken-links` behavior maps roughly to
`REF-001` + `REF-002` + `REF-003`; current `graph/dependencies` cycle checks map to
`GRP-001`; current orphan-doc handling maps to `GRP-002`. The current
size / eager-import / context-budget behavior has **no direct equivalent** in the
22 built-in rule taxonomy — see Decision D3 in §5.

---

## 4. Target architecture

Adopt the **core-hosts-the-pipeline** model
([core-hosts-the-pipeline](decisions/core-hosts-the-pipeline.md)):
all linting, parsing, graph, and compile logic lives in `core`; every host (CLI,
MCP, future LSP) is a thin adapter that imports core and never re-implements the
pipeline.

```
@wastech-mdlint/core        ← parser, ParsedDocument, ContextGraph, rule engine,
                                 registry (22 built-in rules + LLM/custom), config,
                                 compiler, formatters
        ├── @wastech-mdlint/cli         ← commander: lint|init|graph|slice|impact|compile
        ├── @wastech-mdlint/mcp-server  ← stdio: 6 tools
        └── (optional) @wastech-mdlint/lsp-server   ← stretch / out of v2 scope
skills/                       ← wastech-mdlint-{init,fix,impact}/SKILL.md (agentskills.io)
schema.json                   ← JSON Schema mirror of the config (editor + CI sync test)
```

This requires moving from a single package to a **workspace/monorepo** (npm
workspaces). See Decision D1. Naming throughout: bins `wastech-mdlint` and
`wastech-mdlint-mcp`, config `wastech-mdlint.config.json`, org/repo
`VladimirMakarevich/wastech-mdlint` (replace any leftover `contextlint` or
placeholder-org strings from early drafts).

---

## 5. Decisions

Pivotal forks that shape the roadmap. **D1–D3 and the milestone order were
confirmed by the owner on 2026-06-21** (all on the recommended option).
**D4–D7 were confirmed by the owner on 2026-07-02** (all on the recommended
option).

| # | Decision | Resolution |
| --- | --- | --- |
| **D1** ✅ | **Monorepo vs single package.** | **Monorepo (npm workspaces)** — `packages/core` + `cli` + `mcp-server`. Required to ship MCP + CLI separately and to honor the core-hosts-the-pipeline decision. |
| **D2** ✅ | **Config model migration.** | **Clean replace**, no compatibility layer (still `v0.0.0`, no real users). New `{ include, rules[], compile }`; **JSON-only** (drop `.cjs/.mjs`). One-time migration note in the README. |
| **D3** ✅ | **Fate of current LLM features** (size, eager `@import` budget, per-entrypoint token budget) — absent from the 22 built-in rule set. | **Preserve as first-class rules** in the new engine (`SIZE-001` checks bytes/lines/tokens each with independent per-metric `warn`/`error` thresholds; `LLM-001` eager-import budget). Keeps the original PLAN.md mission (LLM context hygiene) on top of doc-integrity. |
| **Order** ✅ | **What ships first after the foundation.** | **Lint parity first** — P3 (all 22 built-in rules + the LLM rules) before graph/agents. M1→M2 is the priority path. |
| **D4** ✅ | **`scan` command.** The current CLI uses `scan`; target uses `lint` (default). | **Default to `lint`, keep `scan` as a hidden alias** for one minor version, then deprecate. |
| **D5** ✅ | **CLI framework.** | **Adopt `commander` + `@inquirer/prompts`** (matches reference, needed for `init`'s interactive flow). |
| **D6** ✅ | **LSP server** (`lsp-server/config-loader.ts` in the spec). | **Out of v2 scope** (stretch). Keep `core` LSP-friendly (sync, no `process.exit` in library code). |
| **D7** ✅ | **Docs site** (reference ships Astro/Starlight). | **Out of v2 core scope**; README + schema + skills suffice for launch. |

---

## 5b. Refined requirements

A point-by-point requirements pass (2026-06-21) locked the v2 improvements. These live in
**[docs/mdlint_v2/requirements/](requirements/index.md)** and are authoritative wherever the plan
is otherwise ambiguous. Headlines that reshape the phases
below: **declarative custom rules** (no rebuild/publish), a **`--fix` engine**, **semantic
graph edges** (ID/anchor/import), **local-only `$schema`**, **structured MCP output**, a
**smart CLI `init`**, and **host-neutral generated skills**. The project is **greenfield**
(no migration needed). See the [requirements index](requirements/index.md) for the full
decision log and backlog.

## 6. Roadmap — phases

Each phase is an epic detailed in its own folder (meta `index.md` + numbered task files, each
with an explicit prev/next/depends/blocks chain). Effort is a rough T-shirt size
(S < 2d, M ≈ 2–5d, L > 5d). "Reuse" = how much current implementation code carries over.

**Detailed task plans:**
[P0 Foundations](P0-foundations/index.md) ·
[P1 ParsedDocument](P1-parsed-document/index.md) ·
[P2 Rule engine](P2-rule-engine/index.md) ·
[P3 Rules](P3-rules/index.md) ·
[P4 Graph](P4-graph/index.md) ·
[P5 Compile](P5-compile/index.md) ·
[P6 init](P6-init/index.md) ·
[P7 MCP server](P7-mcp-server/index.md) ·
[P8 Skills](P8-skills/index.md) ·
[P9 Release](P9-release/index.md)

### Phase 0 — Workspace & foundations · `M` · depends on: D1, D5
**Goal:** establish the monorepo and shared tooling so subsequent phases land in the
right package.
- Convert to npm workspaces: `packages/core`, `packages/cli`, `packages/mcp-server`.
- Move the current `src/*` tree into `packages/core/src` (parser, graph, discovery, token est.).
- Shared `tsconfig` base, ESLint/Prettier, Vitest, CI matrix (Node 24).
- Decide Zod version (align on the version `core` + `mcp-server` share).
- Bin/package names, `engines.node`, `publishConfig` per package.
- **Exit:** `npm run typecheck && npm test && npm run build` green across the workspace; CLI still runs current behavior.

### Phase 1 — `ParsedDocument` & parser upgrade · `M` · reuse: High
**Goal:** one parse pass produces everything every rule needs.
- Extend the remark parser to emit `ParsedDocument`: `tables` (header + keyed
  rows + line), `headings`, `sections`, `links`, `images`, `checkItems`, `content`.
- Keep GitHub-style slug generation (already present via `github-slugger`).
- Port `loadDocuments()` (glob → `Map<absPath, ParsedDocument>`), deterministic.
- **Maps to:** [context-graph requirements](requirements/03-context-graph.md) (parser is the data source).
- **Exit:** parser unit tests cover tables/checklists/sections; CJK fixtures pass.

### Phase 2 — Rule engine & new config model · `L` · depends on: D2, D3 · reuse: Medium
**Goal:** the central computational layer + the config that drives it.
- `Rule` / `RuleContext` / `runRules` / `LintMessage` (callback-report model).
- `registry.ts` with `defineRule(schema, factory)` + `resolveRule(name, options)`.
- New config: `{ $schema?, include?, rules: [{rule, options?}], compile? }`, Zod
  root schema + `findConfig()` walk-up; two-stage validation (root, then per-rule).
- `lintFiles()` orchestration: split `document` vs `project` scope; project rules
  run once over the `documents` map with file-attributed messages.
- `schema.json` + sync test (every registered rule has a schema entry and vice-versa).
- Migrate the 3 existing checks + D3 size/LLM rules into the engine as the first rules.
- **Maps to:** [rules](requirements/02-rules-engine.md) + [config](requirements/01-configuration.md) requirements.
- **Exit:** engine runs an empty + a small ruleset end-to-end; config errors are clear.

### Phase 3 — Implement the 22 built-in rules + shared utils · `L` · reuse: Medium
**Goal:** full rule coverage. Sub-sequence by category; each rule ships with its
own `*.test.ts` and a fixture.
- Utils first: `glob-match` (picomatch `{dot:true}`), `find-line-number`,
  `extract-section-body`, `regex-string` (Zod), `site-router` (Starlight preset).
- **3a TBL** (001–006) · **3b SEC** (001–002) · **3c STR** (001) ·
  **3d REF** (001–006, reuses current link logic) · **3e CHK** (001) ·
  **3f CTX** (001–002) · **3g GRP** (001–003, reuses current cycle/orphan logic).
- **Maps to:** [rules requirements](requirements/02-rules-engine.md); rule inventory in §3.1 above.
- **Exit:** all 22 built-in rules pass unit + fixture tests; documented in README + schema.

### Phase 4 — `ContextGraph` + `graph`/`slice`/`impact` · `M` · reuse: High
**Goal:** the graph as a first-class primitive and its three CLI surfaces.
- `ContextGraph` (`GraphNode{inDegree,outDegree}`, `GraphEdge{type,line}`),
  `buildContextGraph`, `topologicalSort` (Kahn), `getComponents`,
  `getContextSlice` (BFS + table-ID start), `getImpactSet`/`classifyImpact`
  (reverse BFS, direct/transitive + `via`), `formatContextGraphSummary`.
- CLI: `graph` (human/json, clusters, hubs, reading order), `slice <query> --depth`,
  `impact <file>` (+ lint of affected subgraph).
- Note the known spec debt: `slice` "keyword search" is really exact path / table-cell
  match — keep behavior honest in `--help` and docs.
- **Maps to:** [context-graph requirements](requirements/03-context-graph.md).
- **Exit:** graph/slice/impact match reference contracts on a fixture repo.

### Phase 5 — Context compiler & `compile` · `M` · depends on: P4 · reuse: Low
**Goal:** generate a project-specific `SKILL.md`.
- `classifyNodes` (entry/hub/leaf/isolated/bridge), `analyzeGraph`,
  `extractDocProfile` (outline, table schemas, ID-pattern detection, refs in/out),
  `describeRules`, `synthesize` → `CompileResult{ skillContent, metadata }`.
- Config `compile` section (skill name/description, section flags); CLI `compile`
  with `--outdir` / `--dry-run`, default `.claude/skills/wastech-mdlint/`.
- **Maps to:** [skills & compile requirements](requirements/04-skills-compile.md) (generated skill).
- **Exit:** compile produces deterministic `SKILL.md`; `--dry-run` + custom outdir tested.

### Phase 6 — `init` command · `M` · depends on: D5 · reuse: Low
**Goal:** zero-to-config bootstrap.
- Interactive (`@inquirer/prompts`): language, include patterns, rule categories →
  writes `wastech-mdlint.config.json` with a sensible zero-config rule set.
- Package-manager detection from lockfiles; local `$schema` wiring (no remote URL).
- Reconcile/remove the current `postinstall` default-config script (init replaces it).
- **Maps to:** [installation requirements](requirements/06-installation.md).
- **Exit:** `init` produces a valid config that lints cleanly on a fresh repo.

### Phase 7 — MCP server package · `M` · depends on: P2, P4, P5 · reuse: n/a
**Goal:** agent access to the same deterministic operations.
- `@wastech-mdlint/mcp-server`: stdio transport, 6 tools — `lint`, `lint-files`,
  `context-graph`, `context-slice`, `impact-analysis`, `compile-context` — each a
  thin wrapper over core; Zod input schemas; text/JSON-in-text responses; `isError`.
- README + host config snippet (`npx @wastech-mdlint/mcp-server`).
- **Maps to:** [MCP requirements](requirements/05-mcp-server.md) + [installation](requirements/06-installation.md).
- **Exit:** tool-layer tests over core green; manual stdio smoke test in one host.

### Phase 8 — Static skills · `S–M` · depends on: P6, P7 · reuse: n/a
**Goal:** ship the 3 hand-authored Agent Skills.
- `skills/wastech-mdlint-{init,fix,impact}/SKILL.md` with frontmatter
  (`name`, `description`, `license`, `compatibility`, `metadata.{homepage,source}`).
- Encode the workflows (init bootstrap; fix-by-rule-prefix policy; impact blast-radius).
- Keep host-neutral per [vendor-neutral skill distribution](decisions/vendor-neutral-skill-distribution.md); replace upstream placeholders.
- **Maps to:** [skills & compile](requirements/04-skills-compile.md) + [installation](requirements/06-installation.md) requirements.
- **Exit:** skills install via `gh skill install` and reference real command/MCP surface.

### Phase 9 — Distribution, CI & release · `M` · depends on: all · reuse: Medium
**Goal:** production packaging.
- Per-package `package.json` (bins, exports, `files`, `engines`, `publishConfig`).
- Single-tag release that publishes npm packages + tags skills together.
- CI: typecheck/test/build/lint across workspace; pack dry-run; schema-sync test.
- README rewrite (install paths: CLI / MCP / skills), CHANGELOG, migration note.
- **Maps to:** all three installation specs.
- **Exit:** `npm pack --dry-run` clean per package; release workflow validated.

---

## 7. Sequencing & dependencies

```
P0 ─► P1 ─► P2 ─► P3
            │     
            └► P4 ─► P5 ─┐
            └► P6        ├─► P7 ─► P8 ─► P9
                         
Critical path: P0 → P1 → P2 → P3 (rules) and P0 → P1 → P4 → P5 (graph/compile)
run largely in parallel after P2. P7 (MCP) needs P2+P4+P5. P8 (skills) needs the
CLI/MCP surface stable. P9 closes out.
```

Recommended milestones:
- **M1 "Engine":** P0–P2 — workspace + new config + rule engine + first rules runnable.
- **M2 "Lint parity+":** P3 — all 22 built-in rules + current LLM rules; this is a usable linter.
- **M3 "Graph & agents":** P4–P5 + P7 — slice/impact/compile + MCP.
- **M4 "Launch":** P6, P8, P9 — init, skills, packaging, release.

---

## 8. Cross-cutting concerns

- **Determinism:** sort all output arrays before rendering (already an repository habit; keep it).
- **Paths:** repo-relative POSIX paths in public data/reports; normalize `\`→`/`.
- **Testing layers:** unit (per rule / per algorithm) → core pipeline integration →
  CLI/MCP e2e on fixture repos. Keep fixtures focused, not the real repo docs.
- **Severity model:** two levels (`error`/`warning`); exit codes `0` pass / `1` lint
  findings / `2` operational error. (current implementation's `info` severity drops or maps to warning.)
- **i18n:** skill triggers and `init` prompts are multilingual; the
  generated/skill English scaffold stays English, data is passed through.
- **Token estimation:** keep isolated behind one function so a real tokenizer can
  replace `ceil(len/4)` later.
- **Honesty in docs:** state genuine limitations plainly (graph rebuilt-not-incremental
  [G8 backlog], code-plugins deferred [R9 Tier 2]) rather than hiding them.

---

## 9. Out of scope for v2

- LSP server (D6), docs/marketing site (D7).
- External HTTP link checking / cache.
- Plugin API for third-party **code** rules (declarative custom rules ARE in; code-plugins deferred — R9 Tier 2).
- Incremental/cached graph rebuilds.
- Runtime TypeScript config files.

---

## 10. Next steps

1. ✅ **Decisions D1–D3 + milestone order confirmed** (§5). D4–D7 default-resolved.
2. **Expand the critical-path phases into `docs/mdlint_v2/NN-*.md` task files** (mirroring
   the v1 `docs/plan/` granularity), in this order:
   - **P0** — workspace/monorepo bootstrap (gates everything);
   - **P2** — rule engine + new config model (the engine core);
   - **P3** — the 22 built-in rules + the two preserved LLM rules (the lint-parity milestone, M2).
   P1/P4 can be detailed in parallel once P0 is drafted.
3. Update [AGENTS.md](../../AGENTS.md) "Sources Of Truth" to point at this roadmap.

---

### Appendix A — Requirement area → phase traceability

| Requirement area | Primary phase(s) |
| --- | --- |
| Configuration | P2 (model), P6 (init writes it) |
| Rules & rule engine | P2 (engine), P3 (22 built-in rules) |
| Context graph & search | P1 (parse), P4 (graph/slice/impact) |
| Skills (generated) | P5 (compile) |
| MCP server | P7 |
| Skills (static) + skill installation | P8 |
| MCP server installation | P7, P9 |
| Linter installation | P6, P9 |
