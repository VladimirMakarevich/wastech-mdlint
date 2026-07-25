# Concepts

> [Guide index](README.md) · [Rules](rules/README.md) · [Context graph](context-graph.md)

Background on how the linter works — useful for understanding rule behavior and writing custom
rules.

## One parse pass → `ParsedDocument`

Each Markdown file is parsed **once** (remark + GitHub-flavored Markdown + GitHub slugger) into a
`ParsedDocument` that captures everything downstream needs:

- **headings** and their GitHub-style **slugs** (for anchor resolution);
- **sections** (a heading plus the body it owns, last-heading-wins);
- **tables** (header + keyed rows + line);
- **checklist items** (`- [ ]` / `- [x]`);
- **links** and **images** (with resolved raw targets);
- **eager imports** (`@path` directives);
- **inline-disable directives**;
- raw **content** (for placeholder scans, size/token estimation).

Rules, the [context graph](context-graph.md), [`compile`](compile.md), and inline
[suppression](suppression.md) all read this one structure — nothing re-parses Markdown ad hoc.

## The rule engine

The engine is **registry-driven**: each rule declares structured metadata (category, scope,
default severity), a Zod options schema, and a factory that produces findings. Rules are **pure**
where practical — parsed inputs in, structured findings (or deterministic edits) out.

- **Scope** is `document` (evaluated per file) or `project` (evaluated once over the whole corpus,
  with file-attributed findings). Each rule's page states its scope.
- **Severity** resolves as `config override ?? per-finding ?? rule default`; `"off"` drops the
  rule.
- **Assertion primitives** are the shared building blocks (table/section/content/checklist/link
  checks) that both built-in rules and the declarative [`custom`](rules/custom.md) rule compose.

## Determinism

All user-visible output is deterministic: collections are sorted before rendering, paths are
normalized to repository-relative **POSIX** form, and there are no timestamps or
filesystem-order-dependent results. The same inputs produce byte-identical output across runs and
across Windows/macOS/Linux.

Ordering uses a plain code-point string comparison, not locale-aware collation — locale
collation depends on the host's ICU data and default locale, so it cannot guarantee the same
order on two machines. The trade-off is that sorting is not human-locale-aware: ASCII uppercase
sorts before lowercase (`Beta.md` before `alpha.md`) and non-ASCII names sort by code point.
Stable-everywhere ordering is worth more than locale-friendly ordering for output meant to be
diffed and cached.

## Token estimation

The context-budget rules ([SIZE-001](rules/SIZE-001.md), [LLM-001](rules/LLM-001.md)) estimate
tokens with a simple, isolated heuristic (`ceil(bytes / 4)`). It is deliberately kept in one place
so it can be replaced with a real tokenizer later without touching unrelated code.

## Local & data-only

- Analysis is **local**: no network, no external HTTP link checking, no link cache.
- Config is **data-only** JSONC: no runtime `.ts`/`.cjs`/`.mjs` config, no `postinstall` writes,
  and custom rules compose a **closed** primitive vocabulary — never arbitrary user code.
