# wastech-mdlint — Glossary

> **Status:** Living reference · Part of the [v2 roadmap](index.md).
>
> This is the canonical vocabulary for `wastech-mdlint`: product concepts, public
> types, config keys, CLI/MCP surfaces, and the planning taxonomy used across
> `docs/mdlint_v2/`. It covers what ships today **and** what is planned, deferred, or
> explicitly out of scope, so a reader can look up a term whether or not the feature exists
> yet. When a term is ambiguous elsewhere, this glossary defines what it means; when a term
> has authoritative detail in a requirements or decision doc, the entry links there rather
> than duplicating it.

## How to use this glossary

- **Definitions, not specs.** Each entry is a short gloss plus a link to the
  authoritative source (a requirements doc, a decision, the README, or the code). Volatile
  detail — full rule descriptions, per-decision content — lives at its source so it does
  not drift here.
- **Concepts, not every symbol.** Options structs, `*Schema` Zod validators, `render*` /
  `format*` formatters, and glob/path helpers are covered by the concept they serve rather
  than given individual entries. The exhaustive, always-current list of public symbols is the
  core barrel [`packages/core/src/index.ts`](../../packages/core/src/index.ts).
- **Cross-links** use repo-relative POSIX paths, the same convention as the rest of the
  product.
- **Shipped vs planned.** Phases **P0–P5 are shipped**; **P6–P9 are not started**. Terms
  for unshipped surfaces are marked _(planned, PN)_ so the glossary stays honest about the
  current state (roadmap §8, "honesty in docs"). Update these markers as phases land.
- **Not-yet and never.** Concepts that are deferred, backlog, or explicitly out of v2 scope
  are catalogued in the **Deferred, backlog & out of scope** section near the end — named so
  planned and deliberately-excluded work is discoverable, not just what ships today.

## Maintenance rule

Keep this glossary current **as part of the change that introduces the term**, not as a
later cleanup pass — the same discipline the repo applies to code comments
([coding-style rules](../../.agents/rules/coding-style.md)). Add, rename, or retire an
entry whenever you:

- add or rename a load-bearing public type, config key, CLI flag, MCP tool, rule ID, or
  assertion primitive;
- change what an existing term means or its shipped/planned status;
- introduce a new domain concept a future reader would have to reverse-engineer from code.

The documentation step of the implementation flow
([`.worc/flows/implementation/documentation.md`](../../.worc/flows/implementation/documentation.md))
treats this as part of "bring the affected docs in line."

---

## Product & architecture

- **wastech-mdlint** — A deterministic, local-first linter and library for the Markdown
  _context_ in a repository.
- **v2 / re-platforming** — The current production effort. v2 rebuilds the config model,
  rule model, CLI framework, and packaging while reusing the v1 analysis primitives
  (remark parsing, graph building, discovery, token heuristic). It is a re-platforming, not
  an extension. See the [roadmap](index.md).
- **core-hosts-the-pipeline** — The load-bearing architecture decision: `@wastech-mdlint/core`
  owns the entire pipeline (parse → config → rules → graph → compile → format) and every
  host is a thin adapter that never re-implements it. See
  [decisions/core-hosts-the-pipeline.md](decisions/core-hosts-the-pipeline.md).
- **Determinism** — A cross-cutting invariant: identical inputs always produce identical
  output. Arrays are sorted before rendering; paths are normalized; no timestamps or
  filesystem-order dependence. See roadmap §8.
- **Greenfield** — There are no released users (`v0.0.0`), so v2 does a clean config
  replace with no migration layer (Decision [D2](index.md), [I8](requirements/06-installation.md)).
- **Local-first** — All analysis reads only the local repository state. External HTTP
  link checking, remote caches, and remote `$schema` URLs are out of scope (see
  [security rules](../../.agents/rules/security.md)).

## Packages & hosts

- **Monorepo / npm workspaces** — The repo is a single npm-workspaces monorepo under
  `packages/`. Internal dependencies pin `"0.0.0"` (not `workspace:*`). Decision
  [D1](index.md).
- **`@wastech-mdlint/core`** — The engine package. Owns parsing, config loading, the rule
  engine, the context graph, compile, and formatters. Its public contract is the barrel
  [`packages/core/src/index.ts`](../../packages/core/src/index.ts).
- **`@wastech-mdlint/cli`** — The commander-based CLI host. Bin: `wastech-mdlint`.
  Argument parsing, command dispatch, exit codes, file output only.
- **`@wastech-mdlint/mcp-server`** — The stdio MCP host. Bin: `wastech-mdlint-mcp`. A stub
  today; its six read-only tools land in P7 _(planned, P7)_.
- **Host / adapter** — Any package that imports core and assembles a user-facing surface
  (CLI, MCP, a future LSP). Hosts hold host-specific concerns only; shared computation
  stays in core.

## Parsing & `ParsedDocument`

- **`ParsedDocument`** — The single data structure produced by **one parse pass** and read
  by every downstream consumer (rules, graph, compile, suppression). Deliberately a
  superset so nothing re-parses Markdown. Fields:
  [`headings`, `sections`, `tables`, `checkItems`, `links`, `images`, `imports`, `directives`, `content`, `path`].
  See [`markdown/document-types.ts`](../../packages/core/src/markdown/document-types.ts).
- **One parse pass** — The invariant that a document is parsed exactly once into
  `ParsedDocument`; consumers read fields, never re-parse. See [P1](P1-parsed-document/index.md).
- **`parseDocument`** — Parses one Markdown string into a `ParsedDocument` (remark + GFM +
  github-slugger).
- **`loadDocuments`** — Globs the corpus and returns a deterministic
  `Map<absPath, ParsedDocument>`. The lint orchestrator re-keys this to repo-relative POSIX
  paths before building contexts.
- **remark / GFM** — The Markdown parser (`remark`) with the GitHub Flavored Markdown
  extension. The source of `ParsedDocument` fields.
- **Slug** — A GitHub-style heading anchor produced by `github-slugger`, stored verbatim on
  `ParsedHeading.slug`. Authoritative for `REF-002`, anchor edges, and the slice index — all
  three resolve against the identical slug string.
- **`Parsed*` node types** — The parser's structured records:
  `ParsedHeading`, `ParsedTable` / `ParsedTableRow`, `ParsedCheckItem`, `ParsedLink`,
  `ParsedImage`, `ParsedImport`, `InlineDirective`.
- **`ParsedLinkKind`** — Link classification: `local-file`, `same-file-anchor`, `external`,
  `mailto`, `other`.
- **Section** — The body of text under a heading, keyed by heading text. Sections drive the
  cheap `SEC-*` / `CTX-*` existence checks; `extractSectionBody` pulls a named section's body.
- **Import (eager import)** — An `@path/to/file.md` reference that pulls another file's
  content into an LLM context. Parsed as `ParsedImport`, becomes an `import` graph edge, and
  is budgeted by `LLM-001`. Decision [D3](index.md).
- **Inline directive** — A captured `<!-- wastech-mdlint-disable ... -->` HTML comment
  recording its kind, rule IDs, and line. The parser only records it; the engine resolves
  ranges. See **Inline suppression**.

## Rule engine

- **Rule engine** — The registry-driven core layer that runs rules over `ParsedDocument`s
  and reports structured findings. See [requirements/02-rules-engine.md](requirements/02-rules-engine.md)
  and [P2](P2-rule-engine/index.md).
- **`Rule`** — A runnable rule instance with `id`, `description`, `category`,
  `defaultSeverity`, `scope`, `fixable`, `check()`, and optional `fix()`. Produced by
  `resolveRule` with options already validated and bound. See
  [`engine/types.ts`](../../packages/core/src/engine/types.ts).
- **`RuleContext`** — The runtime context passed to `check()`/`fix()`: the current
  `document`/`filePath` (document scope), the whole `documents` map + `projectFiles`
  (project scope), `rootDir`, resolved `settings`, the shared `graph`, and `report()`. A rule
  emits a finding by calling `report()` with a `ReportInput` (message, line, and optional
  `column`/`severity`/`data`/etc.); the runner attaches `ruleId` and resolves severity.
- **`RuleMetadata` / `RuleDefinition`** — The static, single-source rule description
  (category, default severity, fixable, docs URL, messages). One source generates
  `schema.json`, the README rules table, `describeRules`, and `init` categories. Decision
  [R6](requirements/02-rules-engine.md).
- **`defineRule`** — Registers a rule definition (options schema + factory) with the
  registry.
- **`RuleRegistry` / `ruleRegistry`** — The registry type and the singleton holding the
  built-in rule definitions (`BUILTIN_RULE_DEFINITIONS`).
- **`resolveRule`** — Validates a config rule entry's options and returns a bound, runnable
  `Rule`. Unknown rules / bad options raise a `RuleResolutionError`.
- **`runRules`** — Runs a set of resolved rules against one context and collects
  `LintMessage`s.
- **`lintFiles`** — The top-level, intentionally **synchronous** pipeline orchestration
  (`globSync` + `readFileSync`): load config, load documents, split document vs project
  scope, run rules, apply severity + suppression, return a `LintResult`. Do not add an async
  variant (splits the pipeline — see [core-hosts-the-pipeline](decisions/core-hosts-the-pipeline.md)).
- **`LintMessage`** — A single structured finding with `ruleId`, `severity`, `message`,
  `filePath`, `line`, and optional `column` / `endLine` / `fixable` / `data` / `helpUri`.
  JSON output is the serialization of this shape. Decision [R3](requirements/02-rules-engine.md).
- **`LintResult`** — The full result of `lintFiles`: summary counts, messages, and per-file
  grouping. Formatted by `formatLintResultText` / `formatLintResultJson`.
- **Finding** — Informal name for a `LintMessage` (a single rule violation at a location).
- **Severity** — A resolved, actionable level: `error` | `warning`. There is no `info`/`hint`
  level in v2.
- **`SeverityOverride`** — A config-time severity: `error` | `warning` | `off`. `"off"`
  keeps a rule documented but disabled (gradual rollout). Decision [C2](requirements/01-configuration.md).
- **`defaultSeverity`** — The severity a rule declares. The orchestrator resolves final
  severity as `configOverride ?? finding.severity ?? rule.defaultSeverity`. Decision
  [R1](requirements/02-rules-engine.md).
- **`RuleScope`** — `document` (runs per file) or `project` (runs once over the whole
  `documents` map, attributing each finding to a specific file). Project rules that receive
  no `documents` fail fast (Decision [R4](requirements/02-rules-engine.md)).
- **Canonical rule ID** — The single normalized ID form (`REF-001`). Config accepts
  case-insensitive, dash-optional input (`ref001`, `ref-001`) and always emits canonical.
  `canonicalizeRuleId` does the normalization. Decision [C3](requirements/01-configuration.md).
- **Inline suppression** — `<!-- wastech-mdlint-disable[-next-line] RULE-ID -->` /
  `-enable` directives, markdownlint-style. `disable` runs until a matching `enable` or EOF;
  `disable-next-line` covers one line; a bare directive (no IDs) applies to all rules.
  Implemented by `createSuppressionChecker`. Decision [R8](requirements/02-rules-engine.md).
- **`--fix` / `fixable` / `TextEdit`** — The auto-fix path: a rule may expose a `fix()` hook
  returning offset-based `TextEdit`s over raw content; `applyFixes` applies them
  (sort descending, splice). `fixable` marks which rules/findings support it. Decision
  [R2](requirements/02-rules-engine.md).
- **`schema.json` / schema sync test** — The JSON Schema mirror of the config, generated by
  `generateConfigSchema` from rule metadata (never hand-edited). A CI **sync test** asserts
  every registered rule has a schema entry and vice-versa, normalizing canonical IDs. See
  Decision [C9](requirements/01-configuration.md).

## Rule categories & catalog

The engine ships **24 registered built-ins across 8 categories** plus the declarative
`custom` rule. Authoritative per-rule descriptions are the generated table in the
[README rules section](../../README.md#rules) (`npm run generate:docs`); the categories are:

- **`RuleCategory`** — The category prefix union:
  `TBL | SEC | STR | REF | CTX | GRP | SIZE | LLM | custom`. Drives README grouping and
  `init` categories. Note there is **no `CHK` category** — checklist completeness is `CTX-002`.
- **TBL (tables, 6)** — `TBL-001` required columns · `TBL-002` non-empty cells _(fixable)_ ·
  `TBL-003` allowed values · `TBL-004` cell regex · `TBL-005` cross-column conditional
  (when → then) · `TBL-006` unique IDs across files _(project)_.
- **SEC (sections, 3)** — `SEC-001` required sections _(fixable)_ · `SEC-002` section order ·
  `SEC-003` template conformance _(project)_.
- **STR (structure, 1)** — `STR-001` required files exist _(project)_.
- **REF (references, 6)** — `REF-001` relative links resolve · `REF-002` anchor/heading
  slugs · `REF-003` images resolve · `REF-004` cross-zone link declaration · `REF-005` ID
  traceability _(project)_ · `REF-006` stability consistency _(project)_.
- **CTX (content quality, 3)** — `CTX-001` no placeholder/empty sections · `CTX-002` all
  checklist items checked · `CTX-003` glossary alias usage _(project)_.
- **GRP (graph integrity, 3)** — `GRP-001` no cycles _(project)_ · `GRP-002` no orphan docs
  _(project)_ · `GRP-003` ID chain across stages _(project)_.
- **SIZE (`SIZE-001`, 1)** — File within byte / line / token budgets (per-metric warn/error
  thresholds). A preserved LLM-hygiene rule. Decision [D3](index.md).
- **LLM (`LLM-001`, 1)** — Eager-import context within a per-entrypoint token budget. A
  preserved LLM-hygiene rule. Decision [D3](index.md).

## Rule domain concepts

Vocabulary the rules operate on, beyond the rule IDs themselves. Full option shapes live in
the [rules requirements](requirements/02-rules-engine.md) and each rule's source under
[`engine/rules/`](../../packages/core/src/engine/rules/).

- **File scope (`files` / `exclude`)** — The shared per-rule scoping base every rule mixes in
  (Decision [R7](requirements/02-rules-engine.md), type `FileScope`): a rule runs on a file
  when it matches the rule's `files` and not its `exclude` (`exclude` wins, the per-rule form
  of C1). Glob semantics are picomatch with `{ dot: true }`, so dotfiles such as `.claude/…`
  match.
- **Zone / Dependencies section (REF-004)** — A **zone** is a top-level docs area: the first
  directory segment under the configured `zonesDir` (a file lives at `<zonesDir>/<zone>/…`). A
  **cross-zone link** points from one zone into another and must be declared in the source
  zone's **Dependencies section** (`dependencySection`, default `"Dependencies"`).
- **Pipeline stage / chain (GRP-003)** — An ordered `chain` of named stages (e.g.
  requirements → design → implementation). Every ID present at stage N must be referenced at
  stage N+1; a gap is a dropped ID. Walks the declared chain columns and is graph-independent.
- **Stability / stability order (REF-006)** — Entities carry a stability level, and a
  reference must not depend on a **less-stable** entity. `stabilityOrder` lists levels least →
  most stable (rank = index); a row's own stability comes from its `stabilityColumn`, the
  referenced entity's from the definition tables.
- **Placeholder (CTX-001 / `noPlaceholders`)** — A stand-in token marking unfinished content.
  The locked default set is `TBD`, `TODO`, `WIP`, `FIXME`, `N/A` (`DEFAULT_PLACEHOLDERS`); the
  `placeholders` option extends it (union). Matched against the whole section body,
  case-insensitive — not as a substring, so ordinary prose is unaffected.
- **Glossary alias vs canonical term (CTX-003)** — CTX-003 reads a project **glossary table**
  (a `termColumn` of canonical terms plus an optional comma-separated `aliasColumn`), builds an
  alias → canonical map, and flags files that use an alias instead of the canonical term. This
  is the rule that would enforce _this_ document's own vocabulary in prose.
- **Definitions vs references (REF-005 / GRP-003)** — ID-bearing tables split into
  **definitions** (where an ID is introduced, keyed by an `idColumn`) and **references** (where
  it is cited). Traceability rules check that every definition is referenced and every
  reference resolves to a definition.
- **Reference template (SEC-003)** — A designated document whose heading structure other
  in-scope files must conform to (a project-scope structural check).

## Assertion primitives & custom rules

- **Assertion primitive** — A member of the closed, Zod-validated vocabulary of checks the
  engine can run over a `ParsedDocument`. The 24 built-ins are re-expressed as named presets
  over these same primitives, so built-ins and custom rules share one execution engine. See
  [`engine/primitives/`](../../packages/core/src/engine/primitives/).
- **Primitive vocabulary** — The `kind`s, by target:
  - **table** — `requiredColumns`, `columnNotEmpty`, `columnInSet`, `columnMatches`,
    `columnUnique`, `crossColumn`;
  - **section** — `sectionPresent`, `sectionOrder`;
  - **content** — `contentNotMatch`, `noPlaceholders`;
  - **checklist** — `allChecked`;
  - **link/image** — `linkResolves`, `imageResolves`.
- **`custom` rule** — The declarative rule that composes the primitive vocabulary from
  config — no code, no rebuild, pure JSONC, safe to run inside the MCP server. Requires a
  namespaced `id` that must not shadow a built-in prefix, a `target`
  (`table | section | content | checklist | link | heading`), and an `assert`. Decision
  [R9](requirements/02-rules-engine.md); see [`engine/rules/custom.ts`](../../packages/core/src/engine/rules/custom.ts).
- **Target** — Which parsed construct a custom assertion runs against
  (`table | section | content | checklist | link | heading`).
- **Code-plugins (Tier 2)** — User-authored rule code (`plugins: [...]`). **Deferred from
  v2** (would execute arbitrary code — a security risk inside the MCP server). No `plugins`
  config key ships in v2. Decision [R9](requirements/02-rules-engine.md).

## Configuration

- **`wastech-mdlint.config.json`** — The v2 config file. Format is **JSONC** (comments +
  trailing commas), extension stays `.json`. Decision [C4](requirements/01-configuration.md).
  Full shape: [requirements/01-configuration.md](requirements/01-configuration.md).
- **JSONC** — JSON-with-comments, parsed tolerantly (`jsonc-parser`). No code execution, so it
  still honors the JSON-only decision [D2](index.md).
- **`include` / `exclude`** — Glob corpora. A path is in-scope if it matches `include`
  **and not** `exclude` — `exclude` wins. Decision [C1](requirements/01-configuration.md).
- **`respectGitignore`** — Opt-in flag (default `false`) to skip `.gitignore`d files without
  hand-listing them in `exclude`. Decision [C8](requirements/01-configuration.md).
- **`rules`** — The array of rule entries: `{ rule, severity?, options? }` (or the `custom`
  shape). Canonical or lenient IDs; per-entry `severity` override including `"off"`.
- **`settings`** — Shared, rule-inheritable config. Currently `siteRouter` and `idRef`.
  Decision [C5](requirements/01-configuration.md).
- **`settings.siteRouter`** — SSG routing config (`preset` e.g. `starlight`, `contentDir`,
  `defaultLocale`) inherited by reference rules so root-relative links resolve the way the
  site serves them; per-rule override allowed.
- **`settings.idRef`** — `{ idPattern, definitions, idColumn }`, feeds the shared context
  graph's `id-ref` edges. Mirrors `REF-005`'s options but is configured separately because a
  resolved rule cannot expose its options back to the graph builder — a project wanting both
  ID traceability and ID-aware graph analysis sets the same shape in both places. See the
  idRef note in [requirements/03-context-graph.md](requirements/03-context-graph.md) and the
  config section of [README](../../README.md#config).
- **`compile`** — The config section for the `compile` command (`outdir`, `skill`,
  `sections`, `commandPreset`, `hubMinInDegree`). See **Compile**.
- **`$schema`** — A **local, version-matched** relative path
  (`./node_modules/@wastech-mdlint/cli/schema.json`) — never a remote URL. When custom rules are
  present, `init` instead generates a project-local `schema.json` via
  `generateConfigSchema({ customRules })` and repoints `$schema` at `./schema.json`. Decision
  [C9](requirements/01-configuration.md).
- **`findConfig` / `loadConfiguration` / `ConfigError`** — The walk-up config search, the
  JSONC loader + two-stage validation (root, then per-rule), and the structured error type.
  `CONFIG_FILE_NAME` is the canonical filename.
- **Did-you-mean diagnostics** — Rich config errors: unknown rule → suggestion; bad option →
  exact path (`rules[3].options.idPattern: expected valid RegExp`). Decision
  [C7](requirements/01-configuration.md).
- **Config types** — The Zod-inferred shapes behind the keys above: `LintConfig` (root),
  `RuleConfigEntry` / `CustomRuleConfigEntry` (a `rules` entry), and `CompileConfig`.
  `LoadedConfiguration` / `ConfiguredRule` are the resolved forms `lintFiles` consumes.
  Validated by `lintConfigSchema` and the per-key schemas in `config-schema.ts`.

## Context graph & queries

- **`ContextGraph`** — The file-level dependency graph shared by graph commands,
  impact/slice, graph-aware rules, MCP, and compile. `{ nodes, edges, cycles }`; nodes are
  files. See [`graph/context-graph-types.ts`](../../packages/core/src/graph/context-graph-types.ts)
  and [requirements/03-context-graph.md](requirements/03-context-graph.md).
- **`ContextGraphNode`** — `{ path, inDegree, outDegree }`. `path` (repo-relative POSIX) is
  the stable node identity.
- **`ContextGraphEdge` / `ContextGraphEdgeType`** — A typed file→file edge. Types are
  **mutually exclusive**, exactly one per source construct:
  - `link` — a Markdown link **without** a `#fragment`;
  - `anchor` — a Markdown link **with** a `#fragment`;
  - `image` — an `![alt](img)` target;
  - `import` — an `@path.md` eager import;
  - `id-ref` — a plain-text token matching an ID defined in another file.

  Same-file anchors (`#frag`, no file part) are **not** materialized as edges — validated by
  `REF-002` instead. Edge metadata (`text`, `rawTarget`, `line`) exists for explainability.
  Decision [G1/G3](requirements/03-context-graph.md).

- **`buildContextGraph`** — Builds the `ContextGraph` from the documents map. Inputs:
  `siteRouter` (mirrors REF-001/002 resolution) and `idRef` (turns on id-ref edges).
- **`loadContext` / `GraphContext`** — Loads the documents map and builds the shared
  `ContextGraph` once for the `graph` / `slice` / `impact` commands (and the MCP graph tools),
  so a host resolves config, reads files, and builds the graph through one core helper instead
  of rebuilding it per call.
- **Defined IDs** — Stable identifiers (e.g. `REQ-001`) declared in table columns or
  headings, derived by `extractDefinedIds(doc, idRef)` / `extractColumnIds` — **not** a
  parser field (keeps the parser config-light). Discovery is **column-based**. See
  [`engine/defined-ids.ts`](../../packages/core/src/engine/defined-ids.ts).
- **`IdRef`** — `{ idPattern, definitions, idColumn }`: how to find defined IDs. Fed to both
  `REF-005` and the graph builder (see `settings.idRef`).
- **`query`** — The unified traversal API taking a graph plus `start`, `direction`,
  `depth`, and `edgeTypes`, that `slice`, `impact`, MCP tools, and compile all call.
  Decision [G2](requirements/03-context-graph.md).
- **`slice` / `getContextSlice`** — Files reachable from a start within N hops. The start is
  resolved by an **exact deterministic index** (`search-index`) over defined IDs, heading /
  anchor slugs, and file paths — never fuzzy/substring/keyword/LLM matching. A non-match is
  an honest empty result (`matchKind: null`), not an error. Decision
  [G4](requirements/03-context-graph.md); `SLICE_RESOLUTION_DESCRIPTION` is the honest
  help text.
- **`SliceMatchKind`** — What a slice query resolved to (an ID, a slug, a path, or `null`).
- **`impact` / `getImpactSet` / `classifyImpact`** — The blast radius of changing a file
  (reverse BFS): `DirectlyAffected` vs `TransitivelyAffected`, each with a `via` trail.
  `ImpactAnalysisError` (exit 2) when the file is outside the corpus.
- **`topologicalSort` (Kahn)** — Reading order over the graph. Cycles are surfaced explicitly
  (see cycles), not silently truncated.
- **Cycle / SCC** — A circular reference chain. `ContextGraph.cycles` is the explicit list
  (computed via the reused Tarjan SCC), read directly by `GRP-001`. Decision
  [G6](requirements/03-context-graph.md).
- **`getComponents`** — Connected components (clusters) of the graph.
- **`computeGraphCoverage` / coverage signal** — Diagnostic when on-disk Markdown under the
  repo is linked-to but excluded from `include`, so impact/orphan results are not silently
  wrong. Reports node/edge counts + "N files on disk outside the corpus." Decision
  [G5](requirements/03-context-graph.md).
- **Hub / orphan / entry point / reading order** — Graph vocabulary surfaced by the `graph`
  command: a **hub** is a heavily referenced file; an **orphan** has no incoming references
  (`GRP-002`); an **entry point** is an intended top of the reading order; **reading order**
  is the topologically sorted node list.
- **Mermaid / DOT export** — `graph --format mermaid|dot` emits a paste-ready diagram
  alongside JSON. Decision [G9](requirements/03-context-graph.md).
- **Graph renderers** — The deterministic formatters hosts use to print results:
  `renderContextGraphText` / `renderContextGraphMermaid` / `renderContextGraphDot` for the
  `graph` command, `renderContextSliceSummary` for `slice`, `renderImpactSummary` for
  `impact`, and `summarizeContextGraph` / `formatContextGraphSummary` for the summary object
  and its text form.
- **Glob & path helpers** — `matchesConfigGlob`, `normalizeConfigGlob` /
  `normalizeConfigGlobs`, and `normalizeRelativePath` are the shared glob-matching and
  repo-relative-POSIX normalization helpers every layer routes through (picomatch
  `{ dot: true }`).

## Compile & generated skill

- **Compile** — Generating a project-specific `SKILL.md` from the document graph, rule
  descriptions, and config. `compileContext` → `CompileResult { skillContent, metadata }`.
  See [P5](P5-compile/index.md) and [requirements/04-skills-compile.md](requirements/04-skills-compile.md).
- **`SKILL.md` (generated)** — The committed, byte-stable output of `compile` (sorted, no
  timestamps; carries a "generated from N docs, M rules" header + content hash for clean
  diffs). Distinct from the hand-authored static skills.
- **`classifyNodes` / `NodeRole`** — Degree-based node classification for the skill:
  `isolated | hub | entry | leaf | bridge`. First-match order is load-bearing. `hub` uses
  `DEFAULT_HUB_MIN_IN_DEGREE` (3), overridable via `compile.hubMinInDegree`. See
  [`compile/graph-analysis.ts`](../../packages/core/src/compile/graph-analysis.ts).
- **`analyzeGraph` / `GraphAnalysis`** — Reading order, components, classification, and
  cycles bundled for the compiler.
- **`extractDocProfile` / `DocumentProfile`** — Per-document outline, table schemas, and
  references in/out used to describe a doc in the skill.
- **`describeRules`** — Turns the active ruleset (including custom rules) into human-readable
  descriptions from rule metadata. Decision [R6](requirements/02-rules-engine.md).
- **`synthesize` / `CompileResult`** — Assembles the profile, rule descriptions, graph
  analysis, and budget into the final deterministic skill content + metadata.
- **`commandPreset`** — `claude | generic | none` (default `generic`): selects the wording of
  the generated "Working with dependencies" block. Keeps the skill host-neutral rather than
  hardcoding Claude-Code command injection. Decision [S2](requirements/04-skills-compile.md).
- **Skill frontmatter** — The Zod-validated YAML header on a `SKILL.md`
  (`name`, `description`, `license`, `compatibility`, `metadata.{homepage,source}`).
  `skillFrontmatterSchema` validates both generated and static skills. Decision
  [S1](requirements/04-skills-compile.md).
- **`Skill` / `SkillKind` / `validateSkill`** — The unified skill model
  `{ id, kind: "static" | "generated", path, frontmatter }` (`skillModelSchema`), the one shape
  shared by static skills (P8) and the compiler's generated output (P5). `validateSkill` is the
  non-throwing validator (deterministic, sorted issues) over `skillFrontmatterSchema`;
  `parseSkillFrontmatter` is the throwing frontmatter helper `synthesize` routes through. Decision
  [S5](requirements/04-skills-compile.md).
- **Compile budget** — The LLM context-budget summary embedded in the generated skill
  (corpus token estimate + entrypoints over budget). Reuses the token estimator. Decision
  [S6](requirements/04-skills-compile.md).

## Init & repo scan _(planned, P6)_

Core-only groundwork for `init`'s situational awareness, plus the CLI `init` command that wires
it up. Shipped: the pure `scanRepository` scanner and its helpers, `inferRuleSet` which turns a
scan into a draft rule proposal, a real `init` command that runs both and prints a confirmable
preview, and (as of [P6.04](P6-init/04-config-writer-schema.md)) the `generateInitConfig` writer
that turns a confirmed draft into the written config and wires its local `$schema`. See
[P6.01](P6-init/01-repo-scan-detection.md) and [P6.02](P6-init/02-rule-inference.md) for the
underlying scan/inference.

- **`scanRepository`** — Scans a repo for Markdown doc clusters and the package manager in
  use, returning a `RepoScanResult`. Runs the cluster heuristic per **scope** (the repo root
  minus workspace-package files, plus one scope per detected workspace package) so a
  package's own `docs/` groups with that package rather than the root. Decision
  [I2](requirements/06-installation.md).
- **`DocCluster` / `DocClusterKind`** — A proposed `include` candidate: `path`, `score`,
  `subtreeCount`, `includeGlob`, sorted `sampleFiles`, and an optional `workspacePackage` tag.
  Three kinds, ranked in this order regardless of score: `cluster` (a directory that qualifies
  via the scoring heuristic — `subtreeCount >= minClusterSize`, or any count when its basename
  is a known doc-directory name), `root` (scattered root-level files, always low-priority), and
  `fallback` (the global `**/*.md` safety net, used only when nothing else qualified anywhere
  but Markdown exists).
- **`DetectedPackageManager`** — `bun | pnpm | yarn | npm | undefined`, detected from a
  lockfile at the repo root (priority bun > pnpm > yarn > npm). `undefined` means no lockfile
  was found; core does not default-guess `"npm"` — that UX call belongs to the interactive
  `init` layer (P6.03).
- **`WorkspacePackage`** — `{ path, name? }` for a detected workspace package (repo-relative
  POSIX `path`; root itself is never a `WorkspacePackage`). Detected from
  `package.json#workspaces` (npm/Yarn forms) or `pnpm-workspace.yaml`, falling back to a
  sibling `packages/*` / `apps/*` heuristic only when neither declares anything explicit.
- **`inferRuleSet`** — Samples each `DocCluster`'s files, detects reference/table/checklist/
  placeholder/ADR/cycle patterns, and maps them to a draft, registry-sourced `rules[]` proposal
  with per-rule rationale, ready for [P6.03](P6-init/03-interactive-prompts.md)'s confirmation
  prompt. Registry-driven (no hardcoded id table): groups `registry.getAllMetadata()` by
  `metadata.category` into an id-keyed lookup, so a renamed/removed rule silently drops its
  proposal instead of crashing. Decision [R6](requirements/02-rules-engine.md).
- **`DetectedPatterns`** — Per-cluster (and repo-wide, summed) structural/quality tallies:
  `localLinkCount`, `anchorLinkCount`, `imageCount`, `tableCount`, `checklistItemCount`,
  `placeholderSectionCount` (via the real `noPlaceholders` primitive), and `adrSections` (the
  exact-string heading intersection when every sampled doc in a cluster matches an ADR-style
  triplet).
- **`InferredRule`** — One draft config `rules[]` entry: canonical `rule` id, `category`,
  `description` (verbatim from `RuleMetadata`), `defaultSeverity`, `fixable`, a repo-specific
  `rationale` string, and an optional `options` — populated only for `SEC-001`, the one gated
  rule whose schema supports `files` scoping and whose `sections` option is derivable per
  ADR-shaped cluster.
- **`ClusterRuleInference`** — One cluster's evidence trail: `clusterPath`, `includeGlob`,
  `sampledFiles` (the samples actually read, after skipping stale paths), its own
  `DetectedPatterns`, and `contributesTo` (the canonical ids that cluster's own evidence alone
  would justify — a rule only lands here if the cluster's `includeGlob` actually matches its
  `sampledFiles`, so a mismatched scope, e.g. the `**/*.md` fallback sampling `.mdx` files, never
  attributes a dead proposal).
- **`RuleInferenceResult`** — `inferRuleSet`'s return shape: `clusters`
  (`ClusterRuleInference[]`, the per-cluster evidence trail) and `rules` (the deduped, id-sorted
  `InferredRule[]` proposal).
- **`generateInitConfig` / `config-writer.ts`** — The pure, fs-free P6.04 writer that turns a
  confirmed draft into the `wastech-mdlint.config.json` bytes (a hand-rolled JSONC serializer, so
  each newly-inferred rule can carry its rationale as a trailing `//` comment) and wires the local
  `$schema` — the CLI passes a `packageSchemaRef` computed relative to the config's *own* directory
  and anchored on the actual installed schema (walked up on disk), falling back to the repository
  root, so a subdirectory config points up at the hoisted node_modules (`../node_modules/...`) rather
  than a fixed root literal. `"fresh"` writes `$schema` + `include` (omitted when empty) + `exclude`
  (the scanner's pruned noise dirs as globs, so a written config never re-scans `node_modules`/`.git`/…
  — C1) + inferred `rules`; `"merge"` is additive/existing-wins — it round-trips every existing
  top-level key verbatim, keeps every existing `rules[]` entry (canonicalizing its id per C3), and
  only appends rules whose canonical id is absent. `identifyExistingRule` keys a built-in by its
  canonical `rule` and a custom rule by its canonical `id` (never the literal `"custom"`); a `merge`
  whose existing config is unreadable/unparsable, whose `rules[]` has an entry that can't be
  canonically identified (a bare string, a non-string `rule`, or a `custom` entry with a
  missing/non-string/non-schemaable `id`), or that `loadConfiguration` would reject (unknown
  top-level key, unknown rule id, invalid preserved options — validated through the real loader
  before writing) aborts the write entirely rather than write a config that is invalid or drops/
  duplicates an entry. Rationale comments are sanitized to a single line so a newline-bearing path
  can't corrupt the JSONC, and a project schema is generated only for custom ids the loader would
  actually accept. Also exports `buildCiWorkflowYaml(configPath?)` / `CI_WORKFLOW_YAML`, the opt-in CI
  workflow template `init` offers to drop — a self-contained install-and-run-the-CLI workflow
  (`npm install` + `npx wastech-mdlint lint --fail-on error`), **not** a `uses:` reference to P9.03's
  composite Action, which is not built yet (P9.03 can later swap the template to the `uses:` form). It
  is anchored at the repository root — the `.git` root when one exists (a nested workspace package
  still anchors at the real repo root, not `packages/foo`), else the nearest `package.json`/
  `node_modules` — where GitHub loads workflows. For a subdirectory config it scopes lint to the
  config's directory (`lint <dir>`, so `include`/`exclude` resolve there) plus a shell-quoted
  `--config`; a path with a line terminator is declined rather than emitted broken. The offer belongs
  only to the confirmed config-write branch — `--on-existing skip` is a strict no-write outcome and
  never drops a workflow — and a Ctrl+C at its post-write prompt is treated as "no workflow" so the
  config/schema write summary still prints. The CLI host does the actual `writeFile` and reports
  repository-relative POSIX paths. Decisions
  [C3/C4/C9](requirements/01-configuration.md),
  [I3/I6](requirements/06-installation.md).

## CLI

- **commander / `@inquirer/prompts`** — The CLI framework (`commander`) and the interactive
  prompt library (used by `init`). Decision [D5](index.md).
- **`lint`** — The default command; running `wastech-mdlint` with no subcommand lints the
  cwd. Flags: `--config`, `--format text|json`, `--fail-on error|warning|off`, `--fix`.
- **`scan`** — A **hidden, deprecated alias** of `lint`, kept for one minor version. Decision
  [D4](index.md).
- **`graph`** — Prints the context graph: `human` (clusters, hubs, reading order, coverage),
  `json` (`{ nodes, edges, components, readingOrder }`), or `mermaid` / `dot`.
- **`slice <query>`** — Files reachable from an exact-matched `query` within `--depth` (default
  2). Scans the cwd; no `[path]` argument.
- **`impact <file>`** — Blast radius of changing `file` plus a lint of the affected subgraph
  (project rules still see the whole corpus; reported messages are narrowed). Exits `2` if
  `file` is outside the corpus. Scans the cwd; no `[path]` argument.
- **`schema`** — Writes the config JSON schema to a **local** file (`--out`, never a remote
  URL).
- **`compile`** — Generates and writes `SKILL.md` to the resolved outdir
  (`--outdir` → `config.compile.outdir` → `.claude/skills/wastech-mdlint/`); `--dry-run`
  prints instead. Takes `--cwd` (not `[path]`) and resolves relative `--config`/`--outdir`
  against it. Requires a `compile` config section (missing → exit 2 with guidance).
- **`init`** — Zero-to-config bootstrap: scans for doc clusters, re-infers rules against the
  confirmed cluster subset, and prints a confirmable draft preview (include globs, rules grouped
  by category with rationale, existing-config disposition, package manager). `[path]` defaults to
  the cwd, but re-roots to an ancestor directory's config when `[path]` is below one (see
  [P6.03](P6-init/03-interactive-prompts.md)'s implementation notes for why). `-y`/`--yes` skips
  every prompt (for CI / the `-init` skill) and defaults `--on-existing` to `skip` when omitted —
  interactive mode always prompts for it, and every prompt's own unchosen-Enter default matches
  the same `--yes` defaults. With no existing config, both flags are ignored. Ctrl+C during any
  prompt exits `0`. On confirmation it **writes** `wastech-mdlint.config.json` and wires its local
  `$schema` (a project-local `schema.json` when custom rules are present); a `merge` whose existing
  config is unreadable or would not load (unknown key/rule/options) aborts the write rather than
  produce an invalid or lossy result. `--with-ci-workflow` (under `--yes` only) drops the opt-in
  `.github/workflows/wastech-mdlint.yml`; interactive runs prompt for it (default no). See **Init &
  repo scan** and `generateInitConfig` for the underlying scanner/inference/writer. Decisions
  [I1–I3, I6](requirements/06-installation.md), [C3/C4/C9](requirements/01-configuration.md),
  [D5](index.md) inquirer.
- **Exit codes** — `0` pass · `1` findings at the `--fail-on` threshold · `2` operational
  error. A cross-cutting contract (roadmap §8).

## MCP server

- **MCP / stdio** — Model Context Protocol; the server exposes core operations to agents over
  **stdio only** (no HTTP/SSE in v2). It is read-only and never loads code-plugins. Decision
  [M8](requirements/05-mcp-server.md). `lint`/`lint-files` ship in P7.02; `context-graph`,
  `context-slice`, and `impact-analysis` ship in P7.03; `compile-context` ships in P7.04,
  completing the six-tool surface.
- **The six tools** — `lint`, `lint-files`, `context-graph`, `context-slice`,
  `impact-analysis`, `compile-context`. Each is a thin wrapper over core with a Zod input
  schema. The tool inventory is generated from registration so docs cannot drift ("5 vs 6").
  Decision [M3](requirements/05-mcp-server.md).
- **`structuredContent` / `outputSchema`** — Typed tool output (derived from core types)
  alongside a short human-readable text summary, so hosts need not re-parse text. Decision
  [M1](requirements/05-mcp-server.md). M1 scopes this to the five tools it names (`lint`,
  `lint-files`, `context-graph`, `context-slice`, `impact-analysis`); `compile-context` is the
  exception — it returns two plain-text content blocks (the skill content plus a
  `Documents/Rules/Components` metadata line) and no `outputSchema`. For the five schema-carrying
  tools, the advertised `outputSchema` extends the success shape with the optional
  `{ code, message, hint }` error fields (helper `withErrorOutput`) so the error payload also
  validates on the wire; the pinned SDK only advertises object schemas, so this "success schema
  plus optional error metadata" superset is used instead of a union / `oneOf`.
- **`readOnlyHint`** — The safety annotation on all six tools; a future `fix` tool would be
  `destructiveHint`. Decision [M7](requirements/05-mcp-server.md).
- **Error contract** — `{ code, message, hint }` with `isError`, machine-recoverable. `code` is
  a closed set (`ToolErrorCode`) defined once in core (`packages/core/src/errors.ts`) and shared
  by CLI + MCP: `CONFIG_NOT_FOUND`, `CONFIG_INVALID`, `FILE_NOT_IN_CORPUS`, `TARGET_NOT_FOUND`,
  `COMPILE_CONFIG_MISSING`, `INVALID_INPUT`, `INTERNAL_ERROR` (the catch-all wrap for any
  unexpected throwable; its message is sanitized and never leaks a stack trace). On the wire the
  payload is carried in `structuredContent` (P7.05), because a spec-compliant client validates any
  present `structuredContent` against the tool's advertised `outputSchema` — including on `isError`
  results — so an error that did not conform to the schema would be rejected before the caller saw
  the code. The type ships in P7.01; tool call-sites that map errors to codes land in P7.02–04.
  Decision [M6](requirements/05-mcp-server.md).

## Agent Skills & distribution

- **Agent Skill / `SKILL.md`** — A packaged instruction bundle for AI agents, distributed
  under `skills/<skill-name>/SKILL.md`. Two layers: **generated** (via `compile`) and
  **static** (hand-authored).
- **agentskills.io** — The vendor-neutral skill standard; skills install via
  `gh skill install VladimirMakarevich/wastech-mdlint <skill> [--pin vX.Y.Z]` (GitHub CLI
  v2.90+). Decision: [vendor-neutral-skill-distribution](decisions/vendor-neutral-skill-distribution.md).
- **Static skills** — The three hand-authored skills `wastech-mdlint-{init,fix,impact}`
  _(planned, P8)_. `-fix` delegates mechanical fixes to core `--fix` and reserves AI for
  judgement calls. Decision [S7/S8](requirements/04-skills-compile.md).
- **Host-neutral / vendor-neutral** — The rule that skills avoid Claude-Code-specific syntax
  (e.g. dynamic command injection) so they work across 35+ agentskills.io clients.
- **Single-tag release** — One `vX.Y.Z` git tag publishes `@wastech-mdlint/{core,cli,mcp-server}`
  and tags the skills together, preventing version skew. Decision
  [I4](requirements/06-installation.md) _(planned, P9)_.

## LLM context & tokens

- **Context hygiene** — The original product mission: keeping the Markdown that feeds an LLM
  small, resolvable, and non-circular. The `SIZE-001` / `LLM-001` rules and the compile budget
  serve it.
- **`estimateTokens`** — The isolated token heuristic (`ceil(len / 4)`), kept behind one
  function so a real tokenizer can replace it without broad rewrites. See
  [`engine/tokens.ts`](../../packages/core/src/engine/tokens.ts).
- **Context budget** — A byte/line/token ceiling on a file (`SIZE-001`) or on the eager-import
  closure of an entrypoint (`LLM-001`).
- **Entrypoint** — A file treated as a top-level context root whose eager-import closure is
  budgeted by `LLM-001`.

## Cross-cutting conventions

- **Repo-relative POSIX path** — The canonical path form in all public data and reports:
  relative to the repo root, `\` normalized to `/`. Node identity, finding attribution, and
  `documents` keys all use it.
- **Fixture** — A small, scenario-focused test input under a package's test tree. Preferred
  over linting the repo's real docs so a failure points to one behavior. See
  [testing rules](../../.agents/rules/testing.md).
- **Zod** — The runtime validation library used for config, rule options, the primitive
  vocabulary, and skill frontmatter.
- **ESM / NodeNext** — The module system: ES modules with `NodeNext` resolution, so relative
  imports carry a `.js` extension. TypeScript is strict.

## Planning taxonomy

- **Sources of truth / precedence** — When docs disagree: (1) the specific phase task file,
  (2) the relevant locked requirement, (3) the relevant decision, (4) the roadmap summary.
  See [AGENTS.md](../../AGENTS.md).
- **Phase (P0–P9)** — The nine roadmap epics:
  `P0` Foundations · `P1` ParsedDocument · `P2` Rule engine · `P3` Rules · `P4` Graph ·
  `P5` Compile · `P6` init · `P7` MCP server · `P8` Skills · `P9` Release. Each has a folder
  (meta `index.md` + numbered task files). **P0–P5 are Done; P6–P9 are Not started.**
- **Milestone (M1–M4)** — Delivery groupings: **M1** "Engine" (P0–P2), **M2** "Lint parity+"
  (P3), **M3** "Graph & agents" (P4–P5 + P7), **M4** "Launch" (P6, P8, P9). See roadmap §6.
- **Task file** — A numbered file inside a phase folder with a `Previous` / `Next` /
  `Depends on` / `Blocks` chain and exit criteria; the most specific source of truth for the
  work it describes.
- **Decision codes** — Lettered decision logs, each family living in one doc; cite the code
  rather than restating the resolution:
  - **D1–D7** — pivotal roadmap decisions ([index.md](index.md) §5);
  - **C1–C9** — configuration ([requirements/01-configuration.md](requirements/01-configuration.md));
  - **R1–R9** — rules & engine ([requirements/02-rules-engine.md](requirements/02-rules-engine.md));
  - **G1–G9** — context graph ([requirements/03-context-graph.md](requirements/03-context-graph.md));
  - **S1–S9** — skills & compile ([requirements/04-skills-compile.md](requirements/04-skills-compile.md));
  - **M1–M8** — MCP server ([requirements/05-mcp-server.md](requirements/05-mcp-server.md));
  - **I1–I8** — installation & distribution ([requirements/06-installation.md](requirements/06-installation.md)).

  Note: `M1–M4` (milestones) and `M1–M8` (MCP decisions) are different sequences that share
  the letter — disambiguate by context.

- **Task numbering (`PN.NN`)** — Within a phase, task files are numbered `P4.01`, `P4.06`,
  etc.; this glossary and the journals cite that number to point at the exact task.

## Distribution & release _(planned, P9)_

Production packaging. The mechanics land in [P-release](P-release/index.md); the decisions are in
[requirements/06-installation.md](requirements/06-installation.md).

- **Single-tag release** — One `vX.Y.Z` git tag publishes `@wastech-mdlint/{core,cli,mcp-server}`
  and tags the skills together, preventing version skew (also listed under **Agent Skills &
  distribution**). Decision [I4](requirements/06-installation.md).
- **Changesets** — The planned release-automation tool driving the coordinated version bump and
  changelog behind the single tag. Decision [I4](requirements/06-installation.md).
- **npm provenance / supply chain** — Planned per-package hardening: npm provenance on every
  package, a `files` allowlist, per-package `publishConfig`, `engines.node` (`>=24.17.0`, no
  upper bound), and lockfile-based CI. Decision [I5](requirements/06-installation.md).
- **GitHub Action / reusable workflow** — A publishable, reusable CI Action; `init` can
  optionally drop a `.github/workflows/wastech-mdlint.yml`. Decision
  [I6](requirements/06-installation.md).
- **`--pin` / `compatibility`** — `gh skill install … --pin vX.Y.Z` plus each skill's
  `compatibility` frontmatter pins a skill to a matching CLI version. Decision
  [I7](requirements/06-installation.md).
- **CHANGELOG** — The release changelog, produced in the P9 README/packaging pass.
- **`release:check` / `npm pack --dry-run`** — The `npm run release:check` script
  (typecheck + test + build + `npm pack --dry-run`) exists today and validates each package's
  published `files` set without publishing; the full release workflow around it is P9.

## Deferred, backlog & out of scope

Named here so planned-but-not-yet and deliberately-excluded work is discoverable rather than
hidden (roadmap §8 "honesty in docs", §9 "out of scope"). **None of these ship in v2.**

Out of v2 scope (roadmap §9):

- **LSP server** — A language-server host over core; a stretch goal. Core stays LSP-friendly
  (synchronous, no `process.exit` in library code). Decision [D6](index.md).
- **Docs / marketing site** — An Astro/Starlight site; README + schema + skills suffice for
  launch. Decision [D7](index.md). Distinct from the `starlight` `siteRouter` preset, which
  ships.
- **External HTTP link checking / link cache** — Out of scope by design; all analysis is local.
- **Runtime `.ts` / `.cjs` / `.mjs` config** — Rejected for v2; config is JSONC data only
  (Decision [D2](index.md)).
- **Incremental / cached graph rebuild (G7/G8)** — The graph is rebuilt in full each run;
  duplicate-edge collapsing with a `count` (G7) and a content-hash cache (G8) slot in later
  behind the query layer. Decisions [G7/G8](requirements/03-context-graph.md).

Backlog / next iteration:

- **Presets / `extends` (C6)** — Shared config presets; revisited alongside `init`'s
  zero-config rule set. Decision [C6](requirements/01-configuration.md).
- **`fix` / `schema` MCP tools (M5)** — A mutating (dry-run-first) `fix` tool and a config
  `schema` tool; v2 MCP stays at the six read-only tools. Decision
  [M5](requirements/05-mcp-server.md).
- **4th skill `-compile` / `-review` (S9)** — v2 ships exactly `init`, `fix`, `impact`.
  Decision [S9](requirements/04-skills-compile.md).
- **`--watch` mode** — A re-lint-on-change CLI loop; enabled later by the G8 cache.
- **Code-plugins (R9 Tier 2)** — User-authored rule code; the `Rule`/registry interface is
  kept open but no `plugins` key ships (see **Code-plugins (Tier 2)**). Decision
  [R9](requirements/02-rules-engine.md).
- **Async rules / external HTTP checks** — Conflict with the synchronous
  core-hosts-the-pipeline design and with determinism.
- **`info` / `hint` severity** — Rejected; v2 keeps two actionable levels plus `"off"`.
  Decision [C2](requirements/01-configuration.md).

Enabled but not built:

- **SARIF output** — Structured `LintMessage`s (R3) are SARIF-ready, but no SARIF formatter
  ships in v2. Decision [R3](requirements/02-rules-engine.md).

Not needed:

- **`migrate` command (I8)** — Greenfield: no prior users, so the repo's own config is simply
  rewritten in the new shape rather than migrated. Decision [I8](requirements/06-installation.md).

## Tooling & environment

- **Node 24.17.0 LTS** — The runtime target. `engines.node` is `>=24.17.0` with no upper
  bound; CI validates on the Node 24 LTS line.
- **Vitest / ESLint / Prettier** — Test runner, linter, formatter. Verification gates:
  `npm run typecheck`, `npm test`, `npm run build`; `npm run lint` / `npm run format` when the
  scope needs style checks.
- **`generate:docs`** — `npm run generate:docs` regenerates the README rules table from rule
  metadata (the `BEGIN/END GENERATED RULES` block) and the README MCP tool inventory from the live
  tool registration (the `BEGIN/END GENERATED MCP TOOLS` block); neither block is hand-edited.
- **micromatch / picomatch** — The glob engines used for `include`/`exclude` matching
  (`{ dot: true }`).
- **RTK (Rust Token Killer)** — A local token-optimizing CLI proxy used during development;
  prefix shell commands with `rtk`. See [RTK.md](../../RTK.md).
- **wastech-orchestrator (`.worc/`)** — The task orchestrator that drives multi-step
  implementation via flows. The documentation step lives at
  [`.worc/flows/implementation/documentation.md`](../../.worc/flows/implementation/documentation.md).
