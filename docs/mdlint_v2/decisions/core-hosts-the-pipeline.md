# Core hosts the pipeline; hosts never duplicate

> **Status:** Accepted (enforced) · Part of the [v2 roadmap](../index.md).

## Context

Three packages need to lint files: `cli`, `mcp-server`, and a future `lsp-server`. Each could implement its own glob → read → parse → run-rules → format pipeline, but:

- bug fixes in the pipeline would need synchronized changes across packages;
- output formatting (human / JSON) drift between hosts is a UX hazard;
- config-loading rules (precedence, defaults, walk-up search) are tricky enough to deserve a single owner.

Duplication of `lintFiles` and of the config-loading pair (`findConfig` + `loadConfiguration`) across hosts was hit during early development and consolidated into core.

## Decision

`@wastech-mdlint/core` is the **single source of truth** for:

- the lint pipeline — `lint-files.ts` owns discovery (corpus scope, `loadDocuments`, severity resolution, the shared graph), `lint-corpus.ts` owns the one **step order** over a corpus already in memory, and `lint-content.ts` is the ad-hoc entry point over that same order. Two entry points, one order: a host never assembles a third out of `runRules`, because a step added to one order would silently not reach a hand-assembled second;
- config loading (`findConfig`, `loadConfiguration`);
- result formatting (`formatLintResultText`, `formatLintResultJson`, plus the graph/slice/impact renderers in `graph/graph-render.ts`).

Hosts (`cli`, `mcp-server`, and any future `lsp-server`) import from core and assemble user-facing layers on top. They never re-implement these.

The **discovery** entry points are **async**: `lintFiles`, `loadConfiguration`, and `compileContext`. `loadDocuments` reads through `node:fs/promises`, and no `globSync` call exists in core. `lintContent` is **synchronous**, because its caller supplies the corpus and the resolved rules in memory — nothing on that path needs _asynchronous_ I/O. The probes rules make on that path — `existsSync` in the reference primitives and in `STR-001`'s literal check, `readFileSync` for `SEC-003`'s template — are synchronous by design, not absent. **Rule execution** is the other synchronous layer, and that is the constraint this decision preserves: a rule's `check(context): void` returns nothing to await, the assertion primitives are pure (inputs in, messages out) and synchronous, and `lintCorpus` runs the step order over a corpus that is already in memory. Two shipped behaviors rest on it — `STR-001` satisfies its glob entries from the analyzed corpus by deliberate scoping rather than expanding them against the filesystem, since a synchronous `check` could not await a filesystem walk; and the primitives' purity is what keeps findings independent of evaluation order. **Adding an `await` to a discovery entry point is not a departure from this decision; making a rule or a primitive async is.**

## Consequences

- **+** Single bug-fix surface for the lint pipeline.
- **+** Consistent output across CLI, MCP, and future hosts.
- **+** New hosts (e.g. a GitHub Action wrapper) start from a vetted base.
- **−** Anyone touching the pipeline affects every host; CI catches breakage, but reviewers should ack the cross-package impact.
- **−** An async discovery entry point cannot be called from a synchronous context. Costless so far — both shipped hosts are async end to end — but a caller that must stay sync and cannot resolve config and rules itself has no way into discovery; `lintContent` is the sync door for a caller that already holds content and resolved rules, not a route around this.
- **−** The synchronous **rule** contract is the half that could actually bite: a check needing asynchronous I/O has nowhere to put it. That is why external HTTP link checking sits outside v2 rather than behind a flag — admitting it would mean an async `check`, and with it the loss of the two behaviors above.
