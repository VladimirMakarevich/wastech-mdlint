# Context graph — `graph`, `slice`, `impact`

> [Guide index](README.md) · [CLI reference](cli.md) · [Rules: GRP](rules/README.md)

`wastech-mdlint` builds a **context graph** of how documents reference one another, from the same
single parse pass the rules use. The graph is shared infrastructure: the `graph`, `slice`, and
`impact` commands, the graph-integrity rules ([GRP-001](rules/GRP-001.md)…[GRP-003](rules/GRP-003.md)),
the [MCP graph tools](mcp-server.md), and [`compile`](compile.md) all read the same graph — there
is no parallel traversal logic.

## Nodes and edges

- **Nodes** are documents, each carrying in-degree and out-degree.
- **Edges** are directed references, each with a `line` and the raw target text for
  explainability. There are five semantic edge types:

| Edge type | Created by |
| --- | --- |
| `link` | A relative Markdown link `[text](other.md)`. |
| `anchor` | A link to a heading/anchor (`other.md#slug` or `#slug`). |
| `image` | An image reference `![alt](diagram.png)`. |
| `import` | An eager import directive `@path` (also feeds [LLM-001](rules/LLM-001.md)). |
| `id-ref` | An ID reference resolved via [`settings.idRef`](configuration.md#settingsidref). |

`id-ref` edges only materialize when `settings.idRef` is configured; without it, ID references do
not affect graph-based rules.

## Algorithms

The graph exposes deterministic algorithms reused across commands and rules:

- **Topological sort** (Kahn) — the reading order; nodes in cycles are reported as excluded.
- **Connected components** — ordered by size, then by a stable representative.
- **Cycles** (Tarjan SCC) — canonicalized cycle lists, surfaced by [GRP-001](rules/GRP-001.md).
- **Slice** — forward reachability from a resolved query.
- **Impact** — reverse reachability (who depends on this file), with direct/transitive
  classification and the `via` path.
- **Coverage** — a signal of how much of the corpus the graph covers (files outside it).

All output is sorted and uses repository-relative POSIX paths — no timestamps, stable across runs
and platforms.

## `graph`

```bash
wastech-mdlint graph .                    # human summary: clusters, hubs, reading order, coverage
wastech-mdlint graph . --format json      # { nodes, edges, components, readingOrder }
wastech-mdlint graph . --format mermaid   # a Mermaid diagram
wastech-mdlint graph . --format dot       # Graphviz DOT
```

## `slice <query>`

Files reachable within `--depth` hops of a resolved query, following edges **forward**.

```bash
wastech-mdlint slice REQ-42 --depth 2
wastech-mdlint slice "#installation" --format json
wastech-mdlint slice docs/index.md
```

Resolution is **exact match only** — a defined ID, a heading/anchor slug (`#slug`), or a file path.
No fuzzy, substring, keyword, or LLM matching. A query that matches nothing returns an honest
empty result (`matchKind: null` in JSON), never an error. `slice` always scans the cwd (no `[path]`).

## `impact <file>`

The blast radius of changing `<file>`: files that reference it directly, files affected
transitively, and the reading order over the affected subgraph.

```bash
wastech-mdlint impact docs/requirements/auth.md
wastech-mdlint impact docs/requirements/auth.md --format json
```

Linting still runs over the **whole** corpus (so project rules see every document), but the
reported messages/files are narrowed to `file` plus everything it affects. If `<file>` is outside
the analyzed corpus, `impact` exits `2` with a hint.

## Graph-aware rules

- [GRP-001](rules/GRP-001.md) — no cycles.
- [GRP-002](rules/GRP-002.md) — no orphan documents (except declared entry points).
- [GRP-003](rules/GRP-003.md) — IDs carried forward across pipeline stages.

Configure [`settings.idRef`](configuration.md#settingsidref) to make ID references participate in
GRP-001/GRP-002.

## Limitations

- The graph is rebuilt each run (no incremental cache yet).
- `id-ref` edges are scanned from raw content, so an ID inside a code fence can still create an
  edge (a tracked limitation; see the roadmap's post-audit remediation).
