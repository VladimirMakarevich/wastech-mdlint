# P19.06 — Hub ranking, and the skill sections that scale

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**.
>
> Closes [F-12](../field-test-2026-08-09-debates.md#f-12--graphs-top-hubs-ranks-by-total-degree-and-compile-disagrees-with-it) and [F-13](../field-test-2026-08-09-debates.md#f-13--the-skillmd-sections-that-scale-with-the-corpus-are-the-ones-nobody-bounds).

## Goal

Stop the two graph-derived reports from contradicting each other about what a hub is, and put the growth bound on the section that grows.

## Sequence

- **Previous:** — · **Next:** —.
- **Depends on:** — · **Blocks:** —.

## Problem

**F-12 — `graph`'s "top hubs" ranks by total degree, and `compile` disagrees with it.** The human graph report ranks by `inDegree + outDegree`. On the field-test target its third entry had in-degree **1** and out-degree 67 — an index that references 67 documents and is referenced by one — while the corpus's real hub, at in-degree 45, ranked fourth. `compile` read the same graph and classified that third document as `bridge`, printing `1 / 67` in its own `Refs (in/out)` column.

The number is documented: the context-graph guide says a `top hubs` item is `path (degree)`. The word is the problem, because this product defines "hub" precisely and differently elsewhere — `hubMinInDegree`, default 3, in-degree. Two shipped surfaces give a reader opposite answers about one document, and the one that gets it right is the one that shows both degrees. The cost is a maintainer opening `graph` to find what must not break and being handed the document that depends on everything else.

**F-13 — the `SKILL.md` sections that scale with the corpus are the ones nobody bounds.** Over 151 documents the artifact is ~11 600 estimated tokens: `Document Dependencies` 8 273 (71%), `Document Architecture` 3 052 (26%), and everything a reader would call orientation — the corpus token estimate, the rule list, the workflow — **275 tokens, 2.4%**.

`Document Dependencies` is capped, states its caps precisely, and names `graph --format json` as the full source; it is also **O(1)** in corpus size. `Document Architecture` and `Reading Order` carry no cap and no disclosure and are **O(n)** — one row per document, roughly 20 000 tokens at a thousand documents, in a file whose entire purpose is to be loaded whole. The bounding that exists is excellent and was placed on the section that does not grow.

## Deliverables / steps

1. **Settle what `graph` means by hub.** Either rank by in-degree, matching the word and the `compile` threshold, or keep total degree and render `path (in/out)` — the shape `compile`'s own column already uses for this reason. Whichever is chosen, the two surfaces must agree on the word.
2. **Bound `Document Architecture`, or state that it is unbounded** in the artifact, so a reader knows the file grows with the repository. The `References` subsection is the model for how to say it: what was dropped, how much, and where the rest lives.
3. **Consider `Reading Order` in the same pass** — it is the same shape and the same growth, and splitting them across two rounds means writing the disclosure twice.
4. **A test that pins the composition**, not just the content: for a fixture corpus, the artifact's uncapped sections stay within a stated bound or carry the disclosure.

## Exit criteria

- [ ] `graph` and `compile` do not classify the same document as a hub and a non-hub.
- [ ] A reader can tell in-degree from out-degree in whatever `graph` prints.
- [ ] `Document Architecture` is capped or says it is not.
- [ ] The compile-composition test fails if an uncapped section grows without a disclosure.
