# Pre-implementation decisions (audit resolutions)

> **Status:** Accepted (2026-07-02) · Part of the [v2 roadmap](../index.md).

## Context

A pre-implementation audit (2026-06-25) found 29 planning gaps — unresolved forks, literal
TBDs, cross-phase API risks, and underspecified algorithms — that needed settling before the
corresponding phases start. All were resolved on **2026-07-02** and recorded in the canonical
phase/requirements files. This document is the consolidated log of those decisions and their
rationale; it replaces the transient `pre-impl-audit.md`.

Task files reference individual entries inline as **"(audit N.N)"** — the IDs below are those
breadcrumbs. Load-bearing forks that warrant their own ADR stay separate:
[core hosts the pipeline](core-hosts-the-pipeline.md),
[vendor-neutral skill distribution](vendor-neutral-skill-distribution.md).

## Decisions

### P0 — foundations

- **1.1 — Zod v4** (`zod@^4`), one version shared by `core` + `mcp-server`. Native
  `z.toJSONSchema()` covers P2.06 schema generation (drops `zod-to-json-schema`) and matches the
  MCP SDK examples; the single v3 usage migrates during P0.04. → `P0.01` §4.
- **1.2 — TypeScript project references** built with `tsc -b` (`composite` per package, root
  `references`). Packages import each other via compiled `dist/`, so build order is load-bearing;
  `tsc -b` orders + caches incrementally. Independent `tsc` rejected (`npm run --workspaces` isn't
  topological). → `P0.01` §5.
- **1.3 — D4–D7 confirmed** on the recommended option: `lint` default + hidden `scan` alias;
  `commander` + `@inquirer/prompts`; LSP out of v2 scope; docs-site out of v2 core scope.
  → `index.md` §5.

### Architecture forks

- **2.1 — No `ids` field on `ParsedDocument`.** Defined IDs are derived from the parsed
  `tables`/`headings` by a shared `extractDefinedIds(doc, idRef)` helper, used by both the graph
  builder and REF-005. Keeps the parser config-light; no re-parse; no data duplication.
  → `P1.01`, `requirements/03`, `P4.01`.
- **2.2 — Inject the graph from P3.** The orchestrator builds + injects `RuleContext.graph`
  starting in P3 (relocated legacy builder); `P4.06` swaps only the builder to the semantic
  `buildContextGraph`. GRP-001/002 never build a local adjacency (upholds the "no parallel
  traversal" invariant); GRP-003 is graph-independent. → `P2.01`, `P2.05`, `P3.06`, `P4.06`.
- **2.3 — Graph-rule test strategy.** Only GRP-001/002 are graph-dependent → tested with the
  **real injected legacy graph** (no mocks, not deferred). REF-005/006 and GRP-003 are
  graph-independent (documents map + table cells). Follows 2.1 + 2.2. → `P3.09`.
- **2.4 — Inline-disable = markdownlint-style.** `disable` scopes to a matching `enable` or EOF;
  `enable` added; `disable-next-line` = next line only; a bare directive (no IDs) = all rules.
  Parser emits `directives[]`; the engine computes per-rule ranges. → `P1.04`, `P2.05`, `R8`.
- **2.5 — Edge taxonomy: one edge per source construct**, mutually-exclusive types. `#fragment`
  present ⇒ `anchor`, else `link`; `@import` ⇒ `import`; `image` disjoint; `id-ref` = plain-text
  ID mention. Same-file anchors are self-refs (not edged; validated by REF-002).
  → `requirements/03`, `P4.01`.

### Explicit TBDs

- **3.1 — CTX-001 placeholder set** locked to `["TBD","TODO","WIP","FIXME","N/A"]`; `placeholders`
  **extends** (union); matching is case-insensitive, whole-body (not substring). → `P3.05`.
- **3.2 — LLM-001 single budget** `maxTokensPerEntrypoint`; per-type limits dropped (no import
  "type" model; parity with current `llm/budget`). → `P3.07`.
- **3.3 — Node role thresholds:** degree-only, first-match `isolated → hub → entry → leaf →
  bridge`; hub = `inDegree >= compile.hubMinInDegree` (default 3). Fixed/configurable for
  deterministic, corpus-independent roles. → `P5.01`, `P5.05`.
- **3.4 — Compile preset examples** for `claude | generic | none` (default `generic`
  host-neutral). → `P5.04`.
- **3.5 — Custom rule IDs:** user-chosen namespaced grammar `^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$`;
  prefix must not be a built-in prefix (reserved set derived from the registry). Enforced in the
  generated `schema.json` pattern (editor-time) + registry runtime check (authoritative).
  → `P3.08`, `P2.03`, `P2.06`.

### Cross-phase dependencies

- **4.1 — Frozen schema-generator API:** `generateConfigSchema(opts?: { customRules? }): string`
  in core; one function backs the `schema` command, the sync test, and P6.04. → `P2.06`, `P6.04`.
- **4.2 — `--fix` engine.** Flag on `lint`, lands in **P3** (not "P6+"), ESLint-style (apply →
  report remaining → exit 0/1/2). Deterministic-fixable subset = **`SEC-*`** (missing-section
  scaffold) + **`TBL-002`** (empty cell → `TODO`); all others `fixable: false`. Matrix generated
  from metadata (P3.09 fix table); the skill reads it. → `P2.07`, `requirements/02`, `P3.09`,
  `P8.03`.
- **4.3 — P4 query layer (already satisfied).** `query` / `getImpactSet` / `classifyImpact`
  signatures are specified in P4.03/P4.05 and reused directly by P7.03 — no change needed.
- **4.4 — Frozen `CompileResult`** + `compileContext(config, cwd): CompileResult`. The
  missing-`config.compile` error is core-owned: a typed `CompileConfigMissingError` (code
  `COMPILE_CONFIG_MISSING`) that CLI maps to exit 2 and MCP to `{ code, message, hint }`.
  → `P5.04`, `P5.05`, `P7.04`.

### Underspecified algorithms

- **5.1 — Slug/anchor contract = github-slugger, verbatim** (canonical, not an impl detail).
  Dedup `-1`/`-2` in document order; `#heading` → first occurrence; CJK/Unicode as-is. REF-002,
  anchor edges, and the slice index all consume the same slugs. → `P1.02`, `P4.04`.
- **5.2 — Impact traversal.** `query` keeps a **mandatory visited-set** (terminates on cyclic
  graphs); `getImpactSet` uses the **full transitive closure, no depth cap** (capping would drop
  affected files); bounded to O(V+E). → `P4.03`, `P4.05`.
- **5.3 — Block→section ownership:** a block belongs to the **most-recent heading above,
  regardless of level**; flat "last heading wins" (no hierarchical paths); `undefined` if none.
  → `P1.02`.
- **5.4 — `init` cluster scoring:** `score = subtreeMarkdownCount + (knownLayout ? N_MIN : 0)`;
  qualifies at `subtreeCount >= N_MIN` (3) or a known layout with ≥1 file (bonus, not filter);
  roll up to the tightest ancestor; monorepo-aware (per workspace package). → `P6.01`.
- **5.5 — id-ref discovery = column-based:** definitions come from the declared
  `definitions`/`idColumn` columns (same model as REF-005); `idPattern` validates the token, not
  a scan of arbitrary cells. No config ⇒ no id-ref edges. → `P4.01`, `P3.04`, `P1.01`,
  `requirements/03`.

### Additional per-phase gaps

- **REF-005/006 orphan detection:** column-based, so no "implicit" definition table. Requires
  both `definitions` and `references` columns (missing ⇒ C7 config error). Orphan def = defined
  ID with no reference (warning); dangling ref = reference with no definition (error). → `P3.04`.
- **REF-001 i18n link resolution:** relative links resolve relative to the source file
  (locale-agnostic); root-relative links go through `siteRouter` and resolve same-locale first,
  then fall back to `defaultLocale`. → `P3.04`.
- **Component sort order:** by size descending, then by the component's smallest repo-relative
  POSIX node path ascending (deterministic). → `P4.02`.
- **Edge multiplicity & cycles:** multiple edges between a node pair count as **one** cycle (SCC
  is reachability-based; GRP-001 canonicalizes). Multiplicity retained only for degree counts;
  dedup is G7 backlog. → `P4.02`.
- **P6 `init` config merge = additive, existing-wins:** keep every existing `rules[]` entry
  verbatim, append only inferred rules whose canonical ID is absent; leave
  `include`/`exclude`/`settings` untouched. `overwrite` replaces; `skip` writes nothing.
  → `P6.03`, `P6.04`.
- **P7 MCP error taxonomy:** a closed, core-owned code set — `CONFIG_NOT_FOUND`, `CONFIG_INVALID`,
  `FILE_NOT_IN_CORPUS`, `TARGET_NOT_FOUND`, `COMPILE_CONFIG_MISSING`, `INVALID_INPUT`,
  `INTERNAL_ERROR` (wraps unexpected throwables; never leaks a stack trace). → `P7.01`.
- **P9 `engines.node`:** dropped the upper bound → `>=24.17.0` (don't lock out future majors; CI
  validates on the Node 24 LTS line). → `P0.01`, `P0.07`, `P9.01`, `requirements/06`.

## Consequences

- **+** One place to see *why* each contested decision went the way it did, cross-linked to the
  canonical task files that carry the implementation-level detail.
- **+** Task-file breadcrumbs "(audit N.N)" remain meaningful — they map to the entries above.
- **−** This log must be kept honest if a decision is later revisited: update the entry here and
  the canonical task file together (the task file remains the source of truth for behavior).
