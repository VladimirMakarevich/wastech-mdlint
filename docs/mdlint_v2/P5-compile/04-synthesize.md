# P5.04 · `synthesize` → `CompileResult`

> Phase: [P5 — Compile](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Assemble the final `SKILL.md` — deterministic, host-neutral, schema-valid, and
budget-aware — and return `CompileResult`.

## Sequence

- **Previous:** [P5.02 — Doc profile](02-doc-profile.md) and [P5.03 — Describe rules](03-describe-rules.md).
- **Next:** [P5.05 — compile config + CLI](05-compile-config-cli.md).
- **Depends on:** P5.02, P5.03 · **Blocks:** P5.05.

## Deliverables / steps

1. `synthesize(...)` → `{ skillContent, metadata: { documentCount, ruleCount, componentCount } }`,
   assembling: frontmatter + sections **Document Architecture** (file tree + roles + document
   types), **Document Rules**, **Document Dependencies** (reading order — and the
   cycle-`excluded` docs `topologicalSort` reports, rendered explicitly rather than silently
   dropped, preserving the G6 honesty guarantee), **Workflow**, gated by `compile.sections`.
2. **Host-neutral commands** ([S2](../requirements/04-skills-compile.md)): the dependencies
   block is templated by `compile.commandPreset` (`claude|generic|none`); default = plain
   instructions + MCP-tool reference (no `!npx … $ARGUMENTS`).
3. **Determinism + provenance** ([S4](../requirements/04-skills-compile.md)): sorted, no
   timestamps; header "generated from N docs, M rules" + a content hash.
4. **Context-budget summary** ([S6](../requirements/04-skills-compile.md)): reuse the shared
   token estimator `estimateTokens` (`engine/tokens.ts`, isolated per [D3](../index.md) so the
   `ceil(len/4)` heuristic can be swapped later) — corpus token estimate + entrypoints over
   budget.
5. **Frontmatter schema** ([S1](../requirements/04-skills-compile.md)): **define and export the
   SKILL.md frontmatter Zod schema here** (`name`, `description`, `license`, `compatibility`,
   `metadata.{homepage, source}`) and validate the emitted frontmatter against it. This schema
   does **not** exist yet — P5 is its first consumer. Export it from `@wastech-mdlint/core` so
   [P8.01](../P8-skills/01-frontmatter-schema-model.md) reuses (does not redefine) it for static
   skills and P9 CI validates against the same schema (single source, S1).

## Command-block presets (S2) — expected output

The **Document Dependencies** section ends with a command block templated by
`compile.commandPreset`; default is `generic`. Presets change **only** this block — the
computed dependency data above it is identical across presets, and every block is static text
(no timestamps, no host detection), preserving S4 byte-stability. Canonical rendering (examples
locked 2026-07-02, audit 3.4):

**`generic`** (default — host-neutral: plain instructions + MCP-tool reference):

```markdown
### Working with dependencies

- Trace what a change affects: run `wastech-mdlint impact <file>`, or call the
  `impact-analysis` MCP tool with `{ "file": "<file>" }`.
- Pull the context slice for a topic: run `wastech-mdlint slice <query>`, or call the
  `context-slice` MCP tool with `{ "query": "<query>" }`.
```

**`claude`** (Claude-Code command-injection style — the pre-v2 hardcoded form):

```markdown
### Working with dependencies

- Trace what a change affects:

  !npx wastech-mdlint impact $ARGUMENTS

- Pull the context slice for a topic:

  !npx wastech-mdlint slice $ARGUMENTS
```

**`none`** (no command block): the **Document Dependencies** section renders the computed
dependency listing (reading order + per-file references) **only** — no "Working with
dependencies" heading, no runnable commands.

## Frozen types + error contract (audit 4.4)

`CompileResult` is a **public core type, frozen before P7 & P8 depend on it**. The top-level
`compileContext` is the entry both hosts call; `synthesize` is the inner assembly:

```ts
// @wastech-mdlint/core
export interface CompileResult {
  skillContent: string; // full SKILL.md text — deterministic, byte-stable (S4)
  metadata: {
    documentCount: number;
    ruleCount: number;
    componentCount: number;
    contentHash: string; // S4 provenance hash (also embedded in the skillContent header)
  };
}

export function compileContext(config: LoadedConfiguration, cwd: string): CompileResult;
// `LoadedConfiguration` (already exported from core) carries the resolved `config`, `rules`, and
// `settings` the load→graph→analyze pipeline needs — there is no bare `Config` type in core.
// throws CompileConfigMissingError (typed, carries a stable `code`) when config.compile is absent
export function synthesize(/* analysis + profiles + rules */): CompileResult;
```

**Error contract is core-owned**, so both hosts format one source: `compileContext` throws a
typed `CompileConfigMissingError` (code `COMPILE_CONFIG_MISSING`) when `config.compile` is
missing. The CLI ([P5.05](05-compile-config-cli.md)) maps it to **exit 2** with the message; the
MCP tool ([P7.04](../P7-mcp-server/04-compile-tool.md)) maps it to `{ code, message, hint }`.
That `code` is one entry in the P7 MCP error taxonomy.

## Decisions applied

- [S1, S2, S4, S6](../requirements/04-skills-compile.md) · ([S3 skipped — English scaffold](../requirements/04-skills-compile.md)).

## Implementation notes

- `compileContext(config, cwd)` is **async** (`Promise<CompileResult>`), not the sync signature the
  doc text above illustrates: building a `CompileResult` requires `loadContext`, which is async,
  and every comparable core entry point (`lintFiles`, `loadConfiguration`) already is. `synthesize`
  itself stays a synchronous pure renderer — it never touches the filesystem or `cwd`.
- `config.compile` is still `z.unknown()` in `config-schema.ts` — P5.05 owns the strict schema.
  `compile-context.ts` reads it through a local, deliberately lenient (non-`.strict()`) reader that
  only ever *defaults* missing or malformed pieces (`sections.*` → `true`, `commandPreset` →
  `"generic"`, `hubMinInDegree` → `DEFAULT_HUB_MIN_IN_DEGREE`, `skill.name`/`skill.description` →
  `""`). It is explicitly commented as superseded by P5.05 and must not become a second
  authoritative schema.
- Normalization goes leaf-by-leaf, not just top-level: `commandPreset`/`hubMinInDegree` each get
  their own `safeParse`, and so does every individual `skill.name`/`skill.description` and
  `sections.*` flag. A single malformed field (e.g. a non-numeric `hubMinInDegree`, or a
  non-boolean `sections.rules`) only defaults that field — it must not discard an otherwise-valid
  sibling (`skill.name`, or the other three `sections.*` flags), which parsing the containing
  object as one `safeParse` would do by failing all-or-nothing.
- An empty `skill.name`/`skill.description` (the lenient reader's default when `compile.skill` is
  missing) fails `skillFrontmatterSchema.parse` inside `synthesize` with a `ZodError` — there is no
  bespoke error type for that case yet; P5.05 replaces it with a proper load-time diagnostic.
- S6's budget reuses LLM-001's own `optionsSchema` (via `ruleRegistry.getMetadata("LLM-001")`) to
  parse active `LLM-001` config entries, and the shared graph traversal
  (`query(graph, { start, direction: "forward", edgeTypes: ["import"] })`) to sum eager-import
  tokens — not `llm.ts`'s internal traversal, which stays private. `CompileBudget` carries
  `llm001Enabled` (any active `LLM-001` entry exists, set as soon as one is found — independent of
  whether its `entrypoints` glob matched anything) separately from `entrypointsMatched` (beyond the
  doc's illustrative `entrypointsOverBudget` field), so the budget section can render three distinct
  states instead of two: "not enabled", "enabled but its glob matched no files" (a misconfigured or
  empty-match corpus, not silently treated as "not enabled"), and "enabled and everything fits."
- `computeBudget` evaluates *every* active `LLM-001` entry against every entrypoint it matches, not
  just the first one to claim it: `rules[]` can configure LLM-001 more than once, and the engine
  runs every entry independently, so the budget uses the strictest (lowest) matching
  `maxTokensPerEntrypoint` per file — one rendered row per path, but a violation of any configured
  entry's threshold.
- LLM-001's own eager-import resolver (`engine/rules/llm.ts`) now resolves `@target` imports through
  the shared `resolveTargetCandidates` helper (the same one the `ContextGraph` builder and
  REF-001/002 use) instead of its own ad hoc slash-stripping logic, so a root-relative import under
  a configured `siteRouter` resolves identically for LLM-001's lint traversal and for S6's
  graph-based budget — they walk the same "import" edges by construction now, not two independently
  maintained resolvers that could silently disagree.
- "File tree" in Document Architecture is a flat, sorted `Path | Role | Type` table rather than a
  nested tree — the repo-relative path already conveys structure, and a flat table is trivially
  deterministic to render and assert on. `Type` (`reference | tabular | narrative`) is a new,
  derived-only classification with no new parsing: `reference` when the profile has a resolved
  `idPattern`, else `tabular` when it has any table, else `narrative`.
- Command-block presets change only the trailing "Working with dependencies" block; the reading
  order, cycle/excluded listing, and per-file reference lists above it are byte-identical across
  `claude`/`generic`/`none` (pinned by test).
- The provenance line's deterministic text (`Generated from N docs, M rules ...`) is part of the S4
  hash input, not excluded alongside the hash token itself: `contentHash` is computed by first
  rendering the provenance line with a hash placeholder, hashing that alongside every other
  section, then substituting the real hash into the line that actually ships. Excluding the whole
  line let two corpora with different `documentCount`/`ruleCount` share one `contentHash` whenever
  the section that would otherwise reveal the difference (Architecture/Rules) was gated off.
- The Reading Order block distinguishes "no documents in the corpus" from "documents exist but all
  of them are cycle-excluded" (`readingOrder: []` with a non-empty corpus) — the latter renders an
  explicit "excluded by cycles" sentence instead of reusing the empty-corpus wording, preserving G6
  honesty for an all-cyclic corpus.
- Workflow's numbered steps are generated from the *enabled* `sections` flags, not a fixed list: a
  step naming a gated-off section (e.g. "Start from Document Architecture…" when
  `sections.architecture` is `false`) would make the generated SKILL.md self-contradictory. The
  Context Budget step is never gated (S6 always renders), so it is always included.
- `compile.hubMinInDegree` is validated as a positive integer (`z.number().int().min(1)`), not any
  number: `0`/negative thresholds make `classifyNode`'s `inDegree >= hubMinInDegree` check trivially
  true for almost every node, and a fractional threshold is meaningless for an integer degree
  comparison — both default to `DEFAULT_HUB_MIN_IN_DEGREE` like every other malformed `compile.*`
  field, rather than silently rewriting role classification.
- `synthesize.ts` centralizes three Markdown-safety helpers (`toSingleLine`, `codeSpan`,
  `tableCell`) and applies them everywhere a free-form value — a repo-relative path, a rule id, an
  author-supplied custom-rule description, the configured skill name — reaches a heading, table
  cell, or inline code span. Without them, a multiline `skill.name` would truncate the title
  heading, a path containing a backtick would break its code span, and a path containing `|` would
  shift a Document Architecture table row. The References block's per-document label switched from
  bold (`**path**`) to a code span for the same reason — `**` inside a path could otherwise close
  the emphasis early — and now matches how every other path in the module renders.

## Exit criteria

- [x] Output is byte-stable across runs; hash/provenance header present.
- [x] Command block respects the preset; default is host-neutral.
- [x] Budget section present; frontmatter validates against the schema.

## Hand-off to next

P5.05 wires config + the CLI command to write/preview this `CompileResult`.
