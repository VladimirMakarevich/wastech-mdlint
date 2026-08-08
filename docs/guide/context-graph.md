# Context graph — `graph`, `slice`, `impact`

> [Guide index](README.md) · [CLI reference](cli.md) · [Rules: GRP](rules/README.md)

`wastech-mdlint` builds a **context graph** of how documents reference one another, from the same single parse pass the rules use. The graph is shared infrastructure: the `graph`, `slice`, and `impact` commands, the graph-integrity rules ([GRP-001](rules/GRP-001.md)…[GRP-003](rules/GRP-003.md)), the [MCP graph tools](mcp-server.md), and [`compile`](compile.md) all read the same graph — there is no parallel traversal logic. It is also built over the same corpus the lint runs over, `include`/`exclude` and the [default `exclude`](configuration.md#what-is-excluded-before-you-write-anything) included: a document under a default-excluded tree is not a node, which is why `impact` on such a file reports it as outside the corpus rather than answering over a tree the linter would never read.

## Nodes and edges

- **Nodes** are documents, each carrying in-degree and out-degree.
- **Edges** are directed references, each with a `line` and the raw target text for explainability. There are five semantic edge types:

| Edge type | Created by |
| --- | --- |
| `link` | A relative Markdown link `[text](other.md)`. |
| `anchor` | A link to a heading/anchor (`other.md#slug` or `#slug`). |
| `image` | An image reference `![alt](diagram.png)`. |
| `import` | An eager import directive `@path` (also feeds [LLM-001](rules/LLM-001.md)). |
| `id-ref` | An ID reference resolved via [`settings.idRef`](configuration.md#settingsidref). |

`id-ref` edges only materialize when `settings.idRef` is configured; without it, ID references do not affect graph-based rules.

## Algorithms

The graph exposes deterministic algorithms reused across commands and rules:

- **Topological sort** (Kahn) — the reading order; nodes in cycles are reported as excluded.
- **Connected components** — ordered by size, then by a stable representative.
- **Cycles** (Tarjan SCC) — canonicalized cycle lists, surfaced by [GRP-001](rules/GRP-001.md). The graph reports every cycle it found; the rule filters them by [`minCycleLength`](rules/GRP-001.md#options) (default 3), so a two-document mutual link appears here and not in the lint output.
- **Slice** — forward reachability from a resolved query.
- **Impact** — reverse reachability (who depends on this file), with direct/transitive classification and the `via` path.
- **Coverage** — a signal of how much of the corpus the graph covers: the Markdown files that exist on disk under the repository root and are linked-to from the corpus, but fall outside `include`, so they never became nodes. "Markdown file" here means `.md` or `.mdx` — the same set [`init`](cli.md#init) scans for. `.mdx` is reported by coverage but is **not** linted by the default `include` (`**/*.md`), so a linked `.mdx` file shows up here as outside the corpus until you widen `include` yourself. Other extensions, `.markdown` included, are not recognized at all.

All output is sorted and uses repository-relative POSIX paths — no timestamps, stable across runs and platforms.

## `graph`

```bash
wastech-mdlint graph .                    # human summary: clusters, hubs, reading order, excluded, coverage
wastech-mdlint graph . --format json      # { nodes, edges, components, readingOrder, excluded, coverage }
wastech-mdlint graph . --format mermaid   # a Mermaid diagram
wastech-mdlint graph . --format dot       # Graphviz DOT
```

The MCP [`context-graph`](mcp-server.md) tool's `format: "summary"` returns that same JSON document, key for key.

**Both formats carry the excluded set.** A node is excluded from the reading order when a topological sort cannot place it — it sits in a cycle, or it is reachable only through one — so `readingOrder` shorter than `nodes` is explained rather than left to be derived by subtraction. The `human` report prints it as `excluded from reading order (N):`, preceded by one line splitting the set into those two causes by count — `2 of the 230 documents below sit in a cycle; the other 228 are reachable only through one, so breaking the cycles places them all.` — and **omits both when nothing is excluded**; `--format json` always carries `excluded`, as `[]` when empty, because a machine consumer must not have to tell a missing key from an empty set. What neither format states is _which_ node falls under which reason — the count line is a split of the set, not a label per document — and the count line is on the `human` report only, so a JSON consumer holds the set alone. Recorded in the [accepted-behaviors register](../mdlint_v2/accepted-behaviors.md).

The `human` format is **line-oriented throughout**: after the three scalar counters (`nodes:`, `edges:`, `cycles:`), every path-bearing section is a header line plus one indented item per line, so `graph . --format human | head -60`, `grep`, and `wc -l` all behave the way the pipe implies. The shape is not perfectly uniform: `top hubs:`, `clusters:` and `coverage:` carry no count in the header, a `top hubs` item is `path (degree)` rather than a bare path, and `clusters` nests one extra level — `  cluster 1 (88 files):` then its members — to keep the boundary between one component and the next.

The one line whose length follows graph shape rather than a path's own length — a cycle path — is elided past eight entries: the first seven, then `...`, then the node the cycle closes on, then `(+N more hops)` for what was dropped. That middle is **not** recoverable from the CLI: `--format json` carries the complete edge and node lists but has no `cycles` field, so reconstructing the path means re-deriving the cycle from the edges yourself. The MCP [`context-graph`](mcp-server.md) tool's `format: "raw"` does return `cycles` in full. Recorded in the [accepted-behaviors register](../mdlint_v2/accepted-behaviors.md).

## `slice <query>`

Files reachable within `--depth` hops of a resolved query, following edges **forward**.

```bash
wastech-mdlint slice REQ-42 --depth 2
wastech-mdlint slice "#installation" --format json
wastech-mdlint slice docs/index.md
```

Resolution is **exact match only** — a defined ID, a heading/anchor slug (`#slug`), or a file path. No fuzzy, substring, keyword, or LLM matching. A query that matches nothing returns an honest empty result (`matchKind: null` in JSON), never an error. `slice` always scans the cwd (no `[path]`).

The text output is line-oriented like `graph`'s, for the same reason: `starts` only looks like a singleton — an anchor, heading, or ID query resolves to _every_ file carrying that slug — so it is its own `starts (N):` list rather than a parenthetical on the `matched:` line. Read the resolved target(s) from that list, and prefer `--format json` if you are parsing rather than reading.

## `impact <file>`

The blast radius of changing `<file>`: files that reference it directly, files affected transitively, and the reading order over the affected subgraph.

```bash
wastech-mdlint impact docs/requirements/auth.md
wastech-mdlint impact docs/requirements/auth.md --format json
```

Linting still runs over the **whole** corpus (so project rules see every document), but the reported messages/files are narrowed to `file` plus everything it affects. If `<file>` is outside the analyzed corpus, `impact` exits `2` with a hint.

In `--format json` those findings arrive under a `lint` key holding the lint **record** — `{ messages, files, errorCount, warningCount }`, the same shape MCP `lint-files` returns — not the `{ summary, messages, files }` wrapper `lint --format json` prints. See [Output & exit codes](output.md#where-each-host-puts-the-findings).

Its text output is line-oriented too. The affected subgraph is the whole corpus whenever the changed file is a hub, so `reading order` and the excluded list here grow exactly as `graph`'s do — leaving them comma-joined would have kept the defect in the surface most likely to be run on a hub.

## Graph-aware rules

- [GRP-001](rules/GRP-001.md) — no cycles spanning at least `minCycleLength` documents (default 3).
- [GRP-002](rules/GRP-002.md) — no orphan documents (except declared entry points).
- [GRP-003](rules/GRP-003.md) — IDs carried forward across pipeline stages.

Configure [`settings.idRef`](configuration.md#settingsidref) to make ID references participate in GRP-001/GRP-002.

## Limitations

- **One small cycle can empty the reading order.** A topological sort cannot place a document that sits in a cycle, and it cannot place anything reachable only through one — so a single two-document mutual link, the ordinary "README points at the guide index, which points back" shape, can push nearly the whole corpus into the excluded set. Measured on this project's own 231-document tree: one such link leaves the reading order at **1** document and excludes 230, of which only **2** are the cycle itself. [GRP-001](rules/GRP-001.md) will not warn you either, because its `minCycleLength` defaults to 3 and a mutual link is a cycle of two. So `graph` is where you find it: the `cycles:` section names the link, and the line above the excluded list says how many of the excluded documents are the cause and how many merely follow from it. Breaking the cycles places all of them. Recorded in the [accepted-behaviors register](../mdlint_v2/accepted-behaviors.md).
- The graph is rebuilt each run (no incremental cache yet).
- `id-ref` edges are scanned from raw content — the parser exposes no prose-only spans — so an ID that appears **only** inside a code fence, inline code, or frontmatter still creates a real edge. That inflates `impact` and `slice` blast radius and the in-degree [GRP-002](rules/GRP-002.md) reads, and there is no option to narrow it: pick an `idPattern` that prose and code do not share, or leave [`settings.idRef`](configuration.md#settingsidref) unset. Recorded in the [accepted-behaviors register](../mdlint_v2/accepted-behaviors.md).
- Cycle detection walks the graph recursively, so its depth is the longest simple path the traversal takes inside one **connected component**. In a densely cross-linked component that depth approaches the component's document count, with no long authored chain involved — so the assumption is that no single connected component runs to many thousands of documents. Many small components are fine however large the corpus is — the traversal restarts, and the stack unwinds, at each one. As an order of magnitude, a linear chain overflowed at roughly 4,750 documents on one machine; the exact figure depends on platform and stack size. Chains of 1,000 are covered by tests; far past the limit the run fails with a stack-overflow error rather than a normal report.
