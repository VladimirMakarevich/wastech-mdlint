# Understand the blast radius before editing

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** before changing a load-bearing doc, see what depends on it; and explore what one entry
point pulls in.

```bash
wastech-mdlint impact docs/requirements/auth.md            # who references this, directly + transitively
wastech-mdlint impact docs/requirements/auth.md --format json
wastech-mdlint slice docs/index.md --depth 2               # what index.md reaches within 2 hops
wastech-mdlint slice REQ-42                                 # everything reachable from an ID
```

**You get:** the affected subgraph (with lint narrowed to it) from [`impact`](../context-graph.md),
and forward reachability from [`slice`](../cli.md#slice-query). Resolution is exact match only (ID,
`#slug`, or path) — a miss is an honest empty result, not an error.
