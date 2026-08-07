# wastech-mdlint v2 — Production Roadmap

> **Status:** Draft for review · **Owner:** TBD · **Created:** 2026-06-21
>
> This document is the top-level roadmap for turning the current single-package implementation into the production-ready target product. It defines the gap, the target architecture, the phased plan, and the decisions we confirmed before deep work. Each phase has its own detailed folder under `docs/mdlint_v2/` (meta `index.md` + numbered task files).

---

## 1. TL;DR

The current implementation — v1, described by a root `PLAN.md` that was deleted in `957a1ca` and is recoverable from git history — shipped a **single-package CLI** with two commands (`scan`, `graph`) and five hardcoded checks (size, broken links, orphan docs, eager imports, context budget). It is clean and well-factored, but its config model and rule model are **fundamentally different** from the target product.

The target is a substantially larger product (**`wastech-mdlint`**):

- a **`@wastech-mdlint/core`** engine with a **registry of 22 built-in schema-validated doc-integrity rules** across 6 categories (`TBL`, `SEC`, `STR`, `REF`, `CTX`, `GRP`), plus `SIZE-001` and `LLM-001` (their own categories) and the declarative `custom` rule — **24 registered built-ins across 8 categories** in total (there is no `CHK` category; checklist completeness is `CTX-002`);
- a richer **`ParsedDocument`** (tables, sections, checklists, images) and a **`ContextGraph`** with `slice` / `impact` / `topological-sort` / `components`;
- a **`@wastech-mdlint/cli`** with `lint` (default) · `init` · `graph` · `slice` · `impact` · `compile`;
- a **`@wastech-mdlint/mcp-server`** exposing 6 deterministic tools over stdio;
- a **context compiler** that generates a project-specific `SKILL.md`;
- **3 hand-authored Agent Skills** (`-init`, `-fix`, `-impact`) distributed via agentskills.io;
- npm + skill + MCP **distribution channels** under one version tag.

**v2 is therefore a re-platforming, not an extension.** We keep and reuse the current implementation's strong primitives (remark parsing, graph building, discovery, token heuristic, deterministic sorting) but rebuild the config model, rule model, CLI framework, and packaging to match the target. The plan below sequences that work so each phase ships something runnable.

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

Key takeaway from the audit: **every analysis primitive is cleanly separated and reusable; the coupling is only in CLI orchestration and the config shape.** That is exactly the part the target architecture also wants centralized in `core`.

---

## 3. Target state — what we build

Each capability area has a locked requirements doc under [requirements/](requirements/index.md):

| Area | What it defines | New in v2? |
| --- | --- | --- |
| [Context graph & search](requirements/03-context-graph.md) | `ContextGraph`, `slice`, `impact`, topo-sort, components | Extends the current graph implementation |
| [Rules & rule engine](requirements/02-rules-engine.md) | `Rule`/`RuleContext`/`runRules`, registry, 22 built-in rules (+ `SIZE-001`/`LLM-001`, D3) | **New engine** |
| [Configuration](requirements/01-configuration.md) | `{ include, rules[], compile }`, `findConfig`, JSON schema | **New model** |
| [MCP server](requirements/05-mcp-server.md) | 6 stdio tools over core | **New package** |
| [Skills & compile](requirements/04-skills-compile.md) | static skills + generated `SKILL.md` (compile) | **New** |
| [Installation](requirements/06-installation.md) | `gh skill install`, `npx` MCP, npm + `init` flows | **New** |

### 3.1 Rule inventory (the bulk of the work)

22 built-in rules, registered statically, each with a Zod options schema, `document` or `project` scope, and a fixed severity (`error` | `warning`):

- **TBL (tables, 6)** — `TBL-001` required columns · `TBL-002` non-empty cells · `TBL-003` allowed values · `TBL-004` cell regex · `TBL-005` cross-column conditional · `TBL-006` unique IDs across files _(project)_.
- **SEC (sections, 3)** — `SEC-001` required sections · `SEC-002` section order · `SEC-003` template conformance _(project)_.
- **STR (structure, 1)** — `STR-001` required files exist _(project)_.
- **REF (references, 6)** — `REF-001` relative links resolve · `REF-002` anchor/heading slugs · `REF-003` images resolve · `REF-004` cross-zone link declaration · `REF-005` ID traceability _(project)_ · `REF-006` stability consistency _(project)_.
- **CTX (content quality, 3)** — `CTX-001` no placeholder/empty sections · `CTX-002` all checklist items checked · `CTX-003` glossary alias usage _(project)_.
- **GRP (graph integrity, 3)** — `GRP-001` no cycles _(project)_ · `GRP-002` no orphan docs _(project)_ · `GRP-003` ID chain across stages _(project)_.

Note: the current `links/broken-links` behavior maps roughly to `REF-001` + `REF-002` + `REF-003`; current `graph/dependencies` cycle checks map to `GRP-001`; current orphan-doc handling maps to `GRP-002`. The current size / eager-import / context-budget behavior has **no direct equivalent** in the 22 built-in rule taxonomy — see Decision D3 in §5.

---

## 4. Target architecture

Adopt the **core-hosts-the-pipeline** model ([core-hosts-the-pipeline](decisions/core-hosts-the-pipeline.md)): all linting, parsing, graph, and compile logic lives in `core`; every host (CLI, MCP, future LSP) is a thin adapter that imports core and never re-implements the pipeline.

```
@wastech-mdlint/core        ← parser, ParsedDocument, ContextGraph, rule engine,
                                 registry (22 built-in rules + SIZE/LLM + custom), config,
                                 compiler, formatters
        ├── @wastech-mdlint/cli         ← commander: lint|init|graph|slice|impact|compile
        ├── @wastech-mdlint/mcp-server  ← stdio: 6 tools
        └── (optional) @wastech-mdlint/lsp-server   ← stretch / out of v2 scope
skills/                       ← wastech-mdlint-{init,fix,impact}/SKILL.md (agentskills.io)
schema.json                   ← JSON Schema mirror of the config (editor + CI sync test)
```

This requires moving from a single package to a **workspace/monorepo** (npm workspaces). See Decision D1. Naming throughout: bins `wastech-mdlint` and `wastech-mdlint-mcp`, config `wastech-mdlint.config.json`, org/repo `VladimirMakarevich/wastech-mdlint` (replace any leftover `contextlint` or placeholder-org strings from early drafts).

---

## 5. Decisions

Pivotal forks that shape the roadmap. **D1–D3 and the milestone order were confirmed by the owner on 2026-06-21** (all on the recommended option). **D4–D7 were confirmed by the owner on 2026-07-02** (all on the recommended option).

| # | Decision | Resolution |
| --- | --- | --- |
| **D1** ✅ | **Monorepo vs single package.** | **Monorepo (npm workspaces)** — `packages/core` + `cli` + `mcp-server`. Required to ship MCP + CLI separately and to honor the core-hosts-the-pipeline decision. |
| **D2** ✅ | **Config model migration.** | **Clean replace**, no compatibility layer (still `v0.0.0`, no real users). New `{ include, rules[], compile }`; **JSON-only** (drop `.cjs/.mjs`). One-time migration note in the README. |
| **D3** ✅ | **Fate of current LLM features** (size, eager `@import` budget, per-entrypoint token budget) — absent from the 22 built-in rule set. | **Preserve as first-class rules** in the new engine (`SIZE-001` checks bytes/lines/tokens each with independent per-metric `warn`/`error` thresholds; `LLM-001` eager-import budget). Keeps the original PLAN.md mission (LLM context hygiene) on top of doc-integrity. |
| **Order** ✅ | **What ships first after the foundation.** | **Lint parity first** — P3 (all 22 built-in rules + the LLM rules) before graph/agents. M1→M2 is the priority path. |
| **D4** ✅ | **`scan` command.** The current CLI uses `scan`; target uses `lint` (default). | **Default to `lint`, keep `scan` as a hidden alias** for one minor version, then deprecate. |
| **D5** ✅ | **CLI framework.** | **Adopt `commander` + `@inquirer/prompts`** (matches reference, needed for `init`'s interactive flow). |
| **D6** ✅ | **LSP server** (`lsp-server/config-loader.ts` in the spec). | **Out of v2 scope** (stretch). Keep `core` LSP-friendly (no `process.exit` in library code, typed errors, one awaited pipeline). |
| **D7** ✅ | **Docs site** (reference ships Astro/Starlight). | **Out of v2 core scope**; README + schema + skills suffice for launch. |

---

## 5b. Refined requirements

A point-by-point requirements pass (2026-06-21) locked the v2 improvements. These live in **[docs/mdlint_v2/requirements/](requirements/index.md)** and are authoritative wherever the plan is otherwise ambiguous. Headlines that reshape the phases below: **declarative custom rules** (no rebuild/publish), a **`--fix` engine**, **semantic graph edges** (ID/anchor/import), **local-only `$schema`**, **structured MCP output**, a **smart CLI `init`**, and **host-neutral generated skills**. The project is **greenfield** (no migration needed). See the [requirements index](requirements/index.md) for the full decision log and backlog.

## 6. Roadmap — phases

Each phase is an epic detailed in its own folder (meta `index.md` + numbered task files, each with an explicit prev/next/depends/blocks chain). Effort is a rough T-shirt size (S < 2d, M ≈ 2–5d, L > 5d). "Reuse" = how much current implementation code carries over.

**Detailed task plans:** [P0 Foundations](P0-foundations/index.md) · [P1 ParsedDocument](P1-parsed-document/index.md) · [P2 Rule engine](P2-rule-engine/index.md) · [P3 Rules](P3-rules/index.md) · [P4 Graph](P4-graph/index.md) · [P5 Compile](P5-compile/index.md) · [P6 init](P6-init/index.md) · [P7 MCP server](P7-mcp-server/index.md) · [P8 Skills](P8-skills/index.md) · [P9 Remediation](P9-remediation/index.md) · [P10 Consistency](P10-consistency/index.md) · [P11 Post-P9 Remediation](P11-remediation/index.md) · [P12 Post-P9 Consistency](P12-consistency/index.md) · [P13 Correctness](P13-correctness/index.md) · [P14 Host boundary](P14-host-boundary/index.md) · [P15 Output contracts](P15-output-contracts/index.md) · [P16 Release readiness](P16-release-readiness/index.md) · [P17 Plan of record](P17-plan-of-record/index.md) · [P-release Release](P-release/index.md)

**Reference:** [Glossary](glossary.md) — the canonical vocabulary (public types, config keys, CLI/MCP surfaces, rule IDs, and this planning taxonomy) used across these docs · [Accepted behaviors](accepted-behaviors.md) — the register of behaviors deliberately documented rather than fixed, and the residuals recorded rather than closed · [Completion surface](completion-surface.md) — how "done" is recorded: who ticks a task's exit criteria and a phase index's status, and when a criterion is retired instead.

### Phase 0 — Workspace & foundations · `M` · depends on: D1, D5

**Goal:** establish the monorepo and shared tooling so subsequent phases land in the right package.

- Convert to npm workspaces: `packages/core`, `packages/cli`, `packages/mcp-server`.
- Move the current `src/*` tree into `packages/core/src` (parser, graph, discovery, token est.).
- Shared `tsconfig` base, ESLint/Prettier, Vitest, CI matrix (Node 24).
- Decide Zod version (align on the version `core` + `mcp-server` share).
- Bin/package names, `engines.node`, `publishConfig` per package.
- **Exit:** `npm run typecheck && npm test && npm run build` green across the workspace; CLI still runs current behavior.

### Phase 1 — `ParsedDocument` & parser upgrade · `M` · reuse: High

**Goal:** one parse pass produces everything every rule needs.

- Extend the remark parser to emit `ParsedDocument`: `tables` (header + keyed rows + line), `headings`, `sections`, `links`, `images`, `checkItems`, `content`.
- Keep GitHub-style slug generation (already present via `github-slugger`).
- Port `loadDocuments()` (glob → `Map<absPath, ParsedDocument>`), deterministic.
- **Maps to:** [context-graph requirements](requirements/03-context-graph.md) (parser is the data source).
- **Exit:** parser unit tests cover tables/checklists/sections; CJK fixtures pass.

### Phase 2 — Rule engine & new config model · `L` · depends on: D2, D3 · reuse: Medium

**Goal:** the central computational layer + the config that drives it.

- `Rule` / `RuleContext` / `runRules` / `LintMessage` (callback-report model).
- `registry.ts` with `defineRule(schema, factory)` + `resolveRule(name, options)`.
- New config: `{ $schema?, include?, rules: [{rule, options?}], compile? }`, Zod root schema + `findConfig()` walk-up; two-stage validation (root, then per-rule).
- `lintFiles()` orchestration: split `document` vs `project` scope; project rules run once over the `documents` map with file-attributed messages.
- `schema.json` + sync test (every registered rule has a schema entry and vice-versa).
- Migrate the 3 existing checks + D3 size/LLM rules into the engine as the first rules.
- **Maps to:** [rules](requirements/02-rules-engine.md) + [config](requirements/01-configuration.md) requirements.
- **Exit:** engine runs an empty + a small ruleset end-to-end; config errors are clear.

### Phase 3 — Implement the 22 built-in rules + shared utils · `L` · reuse: Medium

**Goal:** full rule coverage. Sub-sequence by category; each rule ships with its own `*.test.ts` and a fixture.

- Utils first: `glob-match` (picomatch `{dot:true}`), `find-line-number`, `extract-section-body`, `regex-string` (Zod), `site-router` (Starlight preset).
- **3a TBL** (001–006) · **3b SEC** (001–003) · **3c STR** (001) · **3d REF** (001–006, reuses current link logic) · **3e CTX** (001–003, incl. the checklist rule CTX-002) · **3f GRP** (001–003, reuses current cycle/orphan logic). Plus the D3 rules `SIZE-001` and `LLM-001`.
- **Maps to:** [rules requirements](requirements/02-rules-engine.md); rule inventory in §3.1 above.
- **Exit:** all 22 built-in rules pass unit + fixture tests; documented in README + schema.

### Phase 4 — `ContextGraph` + `graph`/`slice`/`impact` · `M` · reuse: High

**Goal:** the graph as a first-class primitive and its three CLI surfaces.

- `ContextGraph` (`GraphNode{inDegree,outDegree}`, `GraphEdge{type,line}`), `buildContextGraph`, `topologicalSort` (Kahn), `getComponents`, `getContextSlice` (BFS + table-ID start), `getImpactSet`/`classifyImpact` (reverse BFS, direct/transitive + `via`), `formatContextGraphSummary`.
- CLI: `graph` (human/json, clusters, hubs, reading order), `slice <query> --depth`, `impact <file>` (+ lint of affected subgraph).
- Note the known spec debt: `slice` "keyword search" is really exact path / table-cell match — keep behavior honest in `--help` and docs.
- **Maps to:** [context-graph requirements](requirements/03-context-graph.md).
- **Exit:** graph/slice/impact match reference contracts on a fixture repo.

### Phase 5 — Context compiler & `compile` · `M` · depends on: P4 · reuse: Low

**Goal:** generate a project-specific `SKILL.md`.

- `classifyNodes` (entry/hub/leaf/isolated/bridge), `analyzeGraph`, `extractDocProfile` (outline, table schemas, ID-pattern detection, refs in/out), `describeRules`, `synthesize` → `CompileResult{ skillContent, metadata }`.
- Config `compile` section (skill name/description, section flags); CLI `compile` with `--outdir` / `--dry-run`, default `.claude/skills/wastech-mdlint/`.
- **Maps to:** [skills & compile requirements](requirements/04-skills-compile.md) (generated skill).
- **Exit:** compile produces deterministic `SKILL.md`; `--dry-run` + custom outdir tested.

### Phase 6 — `init` command · `M` · depends on: D5 · reuse: Low

**Goal:** zero-to-config bootstrap.

- Interactive (`@inquirer/prompts`): include patterns, rule categories → confirmable draft, then writes `wastech-mdlint.config.json` with a sensible zero-config rule set.
- Package-manager detection from lockfiles; local `$schema` wiring (no remote URL).
- Reconcile/remove the current `postinstall` default-config script (init replaces it).
- **Maps to:** [installation requirements](requirements/06-installation.md).
- **Exit:** `init` produces a structurally valid config (loads without a `ConfigError`); it lints with exit 0 on a clean fixture (a real ruleset may report findings on non-clean content).

### Phase 7 — MCP server package · `M` · depends on: P2, P4, P5 · reuse: n/a

**Goal:** agent access to the same deterministic operations.

- `@wastech-mdlint/mcp-server`: stdio transport, 6 tools — `lint`, `lint-files`, `context-graph`, `context-slice`, `impact-analysis`, `compile-context` — each a thin wrapper over core; Zod input schemas; text/JSON-in-text responses; `isError`.
- README + host config snippet (`npx @wastech-mdlint/mcp-server`).
- **Maps to:** [MCP requirements](requirements/05-mcp-server.md) + [installation](requirements/06-installation.md).
- **Exit:** tool-layer tests over core green; manual stdio smoke test in one host.

### Phase 8 — Static skills · `S–M` · depends on: P6, P7 · reuse: n/a

**Goal:** ship the 3 hand-authored Agent Skills.

- `skills/wastech-mdlint-{init,fix,impact}/SKILL.md` with frontmatter (`name`, `description`, `license`, `compatibility`, `metadata.{homepage,source}`).
- Encode the workflows (init bootstrap; fix-by-rule-prefix policy; impact blast-radius).
- Keep host-neutral per [vendor-neutral skill distribution](decisions/vendor-neutral-skill-distribution.md); replace upstream placeholders.
- **Maps to:** [skills & compile](requirements/04-skills-compile.md) + [installation](requirements/06-installation.md) requirements.
- **Exit:** skills install via `gh skill install` and reference real command/MCP surface.

### Phase 9 — Post-audit remediation (code) · `M` · depends on: P8 · reuse: n/a

**Goal:** fix the code-level correctness, cross-platform, and tooling gaps from the [P0–P8 audit](audit-2026-07-23-p0-p8.md) before release. See [P9 tasks](P9-remediation/index.md).

- Multi-line `@import` positions (M-1); deterministic loader sort, no `localeCompare` (M-4).
- Windows/macOS CI matrix (M-5); honest MCP `lint` tool description (M-3).
- Resolve `custom` `target: "heading"` mismatch (M-2); fix + enforce the Prettier gate (M-6).
- `init` CI workflow respects the detected package manager (L-7); (stretch) id-ref prose scan (L-6).
- **Maps to:** [audit report](audit-2026-07-23-p0-p8.md) MEDIUM findings + code-level LOWs.
- **Exit:** all MEDIUM code/verification findings closed; gates green and enforced.

### Phase 10 — Post-audit consistency (docs/contracts/tests) · `S–M` · depends on: P9 · reuse: n/a

**Goal:** reconcile governance docs, glossary, requirements, and test guards with the shipped product. See [P10 tasks](P10-consistency/index.md).

- Governance docs drop the removed root `src/`/`test/` (M-7); glossary marks P6–P8 shipped (M-8).
- Clean stale `CHK`/"P2 wires" comments (L-1/L-2); registry inventory guard test (L-12).
- Deepen parser + per-rule tests (L-13/L-14); reconcile R7 / M1-table / P5.04 text (L-8/L-9/L-10).
- Decouple frontmatter-schema import direction (L-5); document accepted behaviors (L-15/L-11).
- **Maps to:** [audit report](audit-2026-07-23-p0-p8.md) documentation/contract/test-depth findings.
- **Exit:** docs/tests describe the current product; no stale-state or phantom-category references.

### Phase 11 — Post-P9 audit remediation (code) · `M–L` · depends on: P10 · reuse: n/a

**Goal:** close the code-level **release-blocking**, **security**, **correctness**, and **data-loss** defects from the [post-P9 audit](audit-2026-07-25-post-p9.md) and the confirmed rule defects from the `p9-09` deep audit, whose report was removed from the tree in `d96b64c`. See [P11 tasks](P11-remediation/index.md).

- Two **release-blockers first**: the CLI `bin` no-op through the npm symlink (H-1) and `SEC-003` reading files outside the analyzed root (H-2).
- `init` data-loss guards: bounded `findConfig` walk-up (H-3) and an existing-`schema.json` guard (H-4).
- Rule-engine correctness by class: unescaped regex substitution (M-1/L-1); `exclude` ignored and stateful `g`/`y` regex (M-2/TP-1); `custom`-without-`id` crash (M-3); duplicate findings (L-3/SC-2); `STR-001` reach (BL-1); dead `GRP` options (SC-1).
- CLI contract: operational failures exit `2` (M-6); unknown subcommand ≠ `exit 0` (M-7); atomic newline-safe writes (M-5/L-6); `init`-scan honesty (L-7…L-11).
- **Maps to:** [post-P9 audit](audit-2026-07-25-post-p9.md) HIGH/MEDIUM + code-level LOWs; `p9-09` BL-1/TP-1/SC-1/SC-2.
- **Exit:** both release-blockers closed; no false-`error`/crash/data-loss path; gates green.

### Phase 12 — Post-P9 audit consistency & coverage (tests/docs) · `S–M` · depends on: P11 · reuse: n/a

**Goal:** close the **test-boundary**, **performance**, **docs-vs-code**, and **decision** findings from the same two audits, so coverage and contracts describe the shipped product and the missed-defect class cannot recur silently. See [P12 tasks](P12-consistency/index.md).

- The systemic backstop: end-to-end `exclude` coverage across the rule families (L-4) and a standing process-boundary test checklist (audit §4) plus a format-gate publish process (audit §1).
- Docs/decisions: glossary `custom.target` optional (L-2); MCP `lint` custom-rule boundary (OG-1); recursive-DFS corpus bound (SC-3); quadratic hot paths (L-5).
- **Maps to:** [post-P9 audit](audit-2026-07-25-post-p9.md) test-depth/perf LOWs; `p9-09` OG-1/SC-3.
- **Exit:** `exclude` e2e everywhere it applies; boundary-test checklist in place; docs/decisions reconciled.

### Phase 13 — Corpus & correctness remediation · `M–L` · depends on: P12 · reuse: n/a

**Goal:** close every defect where the product gives a **wrong answer about the repository with no signal that it did**, from the [2026-08-05 assessments](remediation-backlog-2026-08-05.md) (a deep plan-conformance audit, its QA pass, and a field test of the packed CLI against an external monorepo). See [P13 tasks](P13-correctness/index.md).

- Two blockers first: a `!` in any glob list widens or empties scope instead of subtracting; there is no lint-time default `exclude`, so the zero-config first run lints every `node_modules` tree (3063 files instead of 323, silently).
- Rule options that disable or misfire: `SIZE-001` enabled into inertness, `GRP-002` flagging the repo's own entry points, an unrecorded `TBL-003` default with three consumers, `GRP-001` at `error` on a normal documentation shape.
- Resolution correctness: `REF-001.exclude` inert whenever any `siteRouter` is set; three incompatible definitions of "a Markdown file"; `.gitignore` layer precedence dropping a file real `git` keeps.
- Config diagnostics: a union collapse that hides the key and the enum on **every** rule family.
- **Maps to:** backlog batches B1–B5 (W-01 – W-12).
- **Exit:** no silent wrong answer about corpus membership or rule execution; every fix has a test that fails before it.

### Phase 14 — Host boundary remediation · `M` · depends on: P13 · reuse: n/a

**Goal:** close every defect where a host turns a real failure into an apparent success, or drops the actionable half of a diagnostic. See [P14 tasks](P14-host-boundary/index.md).

- A nonexistent MCP `cwd` silently succeeds on all five file-based tools — the class the CLI guards and names in its own rationale.
- `init --on-existing merge` refuses to write and exits `0`; an out-of-repo `--outdir` renders as `../../../../..`.
- `init` never discloses the Markdown its hidden-directory exclude drops (63 files, 31% of a real corpus), and whether that exclude belongs in a lint-time config is undecided.
- `--config` resolves against two different bases across six handlers; the MCP text block drops the `hint`; schema-level rejections bypass the `{code, message, hint}` contract; the closed error set has no operational code.
- **Maps to:** backlog batches B6–B7 (W-13 – W-21).
- **Exit:** every host rejects what it should and discloses what it knows; three decisions recorded.

### Phase 15 — Output contracts & rendering at real scale · `M` · depends on: P14 · reuse: n/a

**Goal:** one format name denotes one shape, every documented output contract matches what ships, and the human renderers are usable on a corpus nobody designed for. See [P15 tasks](P15-output-contracts/index.md).

- Scale defects no in-repo fixture can produce: `graph --format human` emitting 3.5–3.9 KB single lines; a generated `SKILL.md` that is 89.7% edge list and 0.4% workflow, with one 17 530-character line; a node-role vocabulary where two of five roles hold 83% of nodes.
- Contract defects: `coverage` shipped but documented on none of five surfaces and unreachable from MCP; `format: "json"` denoting different documents on the two hosts; `excluded from reading order` only in the human format; a source comment asserting two hosts share one lint shape when three ship.
- Documentation accuracy: five documented message keys against eight emitted; `helpUri` holding a bare rule ID at 27 sites; the token heuristic stated in bytes where the code counts characters, and its calibration disclosed nowhere a reader of the number will look.
- **Maps to:** backlog batches B8–B9 plus the documentation half of B11 (W-22 – W-28, W-34 – W-36).
- **Exit:** stated bounds at a stated corpus size; one format name, one shape; every documented contract true.

### Phase 16 — Release readiness, tooling & test debt · `M` · depends on: P15 · reuse: Medium

**Goal:** close the test debt that let P13–P15 ship green, then make the published artifact something a stranger can install, read, and trust. See [P16 tasks](P16-release-readiness/index.md).

- The preventive half, first: no fixture is at real scale, on the zero-config path, or in a dot-directory — the single cause behind the four findings that change a user's first ten minutes.
- Publish metadata: no package ships a README or LICENSE and none declares `repository`, so publishing produces three blank npm pages; 204 source maps point at a `../src` no tarball ships; `release:check` validates none of the three `files` allowlists while the glossary says it validates all of them.
- Dev tooling: the WSL wrapper interpolates argv into a `cmd.exe` line against an explicit security rule; the docs generator passes generated content as a regex replacement string.
- **Maps to:** backlog batches B10, B14, B15 plus B11's low-severity residue (W-29 – W-33, W-37 – W-40, W-54 – W-58).
- **Exit:** every P13–P15 fix has a guard that fails before it; each tarball is publishable; four decisions recorded.

### Phase 17 — Plan of record & self-linting · `S–M` · depends on: P16 · reuse: n/a

**Goal:** make the plan describe the product that shipped, and make this repository run its own linter on its own documentation so the next round of drift is a build failure. See [P17 tasks](P17-plan-of-record/index.md).

- **The highest-leverage item in the backlog:** this repository has no configuration of its own, so nothing runs the product on its own corpus. The 17 dead links below were all found by `REF-001` in one run, once a config was supplied from outside the repo — and adding one closes a plan expectation (I8) rather than reversing a decision.
- Precedence-tier defects first: the one "Accepted (enforced)" ADR names three APIs that do not exist and prohibits the async pipeline that shipped, with the glossary repeating the load-bearing half; two dependency-register entries claim more than the code delivers.
- Completion surface: 92 unchecked criteria across 30 `Done` task files while their indexes are ticked, and 33 unchecked index criteria across five phases whose task files all read Done — one of those boxes being permanently unverifiable.
- Sweeps: 17 dead links, `PLAN.md`/`docs/plan/` referenced but absent, every stale release-sense `P9` line — across the plan, three published skill frontmatter strings, and a CI log line users read — and the register's own three contract breaches.
- **Maps to:** backlog batches B12–B13 (W-41 – W-53).
- **Exit:** CI fails on a dead link in `docs/`; every precedence tier describes the shipped code; the completion-surface question is decided, not just actioned.

### Phase P-release — Distribution, CI & release · `M` · depends on: all (incl. P9–P17) · reuse: Medium

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
            └► P6        ├─► P7 ─► P8 ─► P9 ─► P10 ─► P11 ─► P12
                                                              │
              ┌───────────────────────────────────────────────┘
              └► P13 ─► P14 ─► P15 ─► P16 ─► P17 ─► P-release

Critical path: P0 → P1 → P2 → P3 (rules) and P0 → P1 → P4 → P5 (graph/compile)
run largely in parallel after P2. P7 (MCP) needs P2+P4+P5. P8 (skills) needs the
CLI/MCP surface stable. P9/P10 close the first (P0–P8) audit; P11 (post-P9 code
remediation) and P12 (post-P9 consistency/coverage) close the second audit.
P13–P17 close the third round — the 2026-08-05 audit + field test — in order of
depth: corpus correctness, host boundary, output contracts, release readiness
and test debt, then the plan of record. P-release ships it.
```

Recommended milestones:

- **M1 "Engine":** P0–P2 — workspace + new config + rule engine + first rules runnable.
- **M2 "Lint parity+":** P3 — all 22 built-in rules + current LLM rules; this is a usable linter.
- **M3 "Graph & agents":** P4–P5 + P7 — slice/impact/compile + MCP.
- **M4 "Launch":** P6, P8, then P9/P10, P11/P12 and P13–P17 (three post-audit remediation rounds), then P-release — init, skills, audit fixes, packaging, release.

---

## 8. Cross-cutting concerns

- **Determinism:** sort all output arrays before rendering (already an repository habit; keep it).
- **Paths:** repo-relative POSIX paths in public data/reports; normalize `\`→`/`.
- **Testing layers:** unit (per rule / per algorithm) → core pipeline integration → CLI/MCP e2e on fixture repos. Keep fixtures focused, not the real repo docs.
- **Severity model:** two levels (`error`/`warning`); exit codes `0` pass / `1` lint findings / `2` operational error. (current implementation's `info` severity drops or maps to warning.)
- **i18n:** skill triggers and `init` prompts are multilingual; the generated/skill English scaffold stays English, data is passed through.
- **Token estimation:** keep isolated behind one function so a real tokenizer can replace `ceil(len/4)` later.
- **Honesty in docs:** state genuine limitations plainly (graph rebuilt-not-incremental [G8 backlog], code-plugins deferred [R9 Tier 2]) rather than hiding them.

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
2. **Expand the critical-path phases into `docs/mdlint_v2/NN-*.md` task files** (mirroring the v1 `docs/plan/` granularity), in this order:
   - **P0** — workspace/monorepo bootstrap (gates everything);
   - **P2** — rule engine + new config model (the engine core);
   - **P3** — the 22 built-in rules + the two preserved LLM rules (the lint-parity milestone, M2). P1/P4 can be detailed in parallel once P0 is drafted.
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
| MCP server installation | P7, P-release |
| Linter installation | P6, P-release |
| Post-audit remediation (code) | P9 ([audit](audit-2026-07-23-p0-p8.md)) |
| Post-audit consistency (docs/tests) | P10 ([audit](audit-2026-07-23-p0-p8.md)) |
| Post-P9 remediation (code) | P11 ([audit](audit-2026-07-25-post-p9.md)) |
| Post-P9 consistency (tests/docs) | P12 ([audit](audit-2026-07-25-post-p9.md)) |
| Corpus & correctness remediation | P13 ([backlog](remediation-backlog-2026-08-05.md)) |
| Host boundary remediation | P14 ([backlog](remediation-backlog-2026-08-05.md)) |
| Output contracts & rendering at scale | P15 ([backlog](remediation-backlog-2026-08-05.md)) |
| Release readiness, tooling & test debt | P16 ([backlog](remediation-backlog-2026-08-05.md)) |
| Plan of record & self-linting | P17 ([backlog](remediation-backlog-2026-08-05.md)) |
