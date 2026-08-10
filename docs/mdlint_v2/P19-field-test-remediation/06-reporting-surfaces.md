# P19.06 — Hub ranking, and the skill sections that scale

> Phase: [P19 — Field-test remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.
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

## Outcome

**F-12. One threshold, applied by both surfaces.** The choice was between ranking `top hubs` by in-degree and keeping total degree while rendering `path (in/out)`; what shipped does both, because only the pair closes the exit criteria literally. `top hubs` now lists documents whose **in-degree** reaches `hubMinInDegree`, ranked in-degree first (out-degree, then path, break ties), rendered `path (in/out)`. `DEFAULT_HUB_MIN_IN_DEGREE` moved to `graph/graph-algorithms.ts` and `compile/graph-analysis.ts` re-exports it, so there is one definition rather than two that happen to agree; both hosts thread the configured value from `compile.hubMinInDegree`, which is now the one `compile.*` key reaching another command.

The rejected option was renaming the section to something like `most connected`. It would have removed the vocabulary collision without removing the misdirection F-12 measured — the index that depends on everything would still have led the list — and the whole cost of the finding was a maintainer being pointed at the wrong document.

A corpus where nothing clears the threshold now prints `(none: no document has 3 or more incoming references)` rather than falling back to the best-connected files. That is the same answer the skill's `Role` column gives such a corpus, and an empty list that explains itself is worth more than a populated one that means something else.

The section header deliberately still carries no count. A counted header joins the human-versus-structured parity contract the shared reader enforces, and the JSON document has no hub array to compare against — so the hub lines are instead diffed against per-node `inDegree`/`outDegree` in both hosts' suites. Reverting any part of this fails `compile-graph-analysis.test.ts` ("never lists a document the classifier calls a non-hub"), `graph-algorithms.test.ts`, and the degree-parity cases in `packages/cli/test/graph.e2e.test.ts` and `packages/mcp-server/test/context-graph.test.ts`.

**F-13. Cap the table; label what stays complete.** `Document Architecture` is capped at 25 documents, selected by the ranking `### References` already used — deliberately the same 25, so the artifact describes one set of documents in detail rather than two overlapping ones — and carries the same three-part disclosure: the bound always, the omission count when the cap engages, and where the rest lives. The measured effect on the 139-document fixture is the artifact falling from ~29 000 to 19 776 bytes, with the table going from ~32% to 9.4%.

Capping it is safe for one reason, and the disclosure says so: `Reading Order` lists every document and is not capped, so the cap drops columns rather than documents. That block and the excluded list keep growing with the corpus by design — a document silently missing from the reading order is the dishonesty they exist to prevent — and each now opens with a `Complete:` line naming itself as complete-and-therefore-growing. Every section of the artifact is now one of the two kinds and says which.

The alternative the task allowed — leave it uncapped and disclose — was rejected because the goal was to put the growth bound on the section that grows, and a disclosure alone still reaches ~20 000 tokens at a thousand documents.

The composition test is `packages/core/test/compile-composition.test.ts`, and it measures growth rather than shares: it synthesizes the same corpus at 50 and 200 documents with an identical rule set and asserts that any block growing past 1.5× carries `Bounded summary:` or `Complete:`. Deleting the reading order's disclosure line fails it by name. A share bar cannot make that distinction — at one corpus size a capped section and a merely small one are the same number — which is how the inversion survived. The share bars in `compile-context.test.ts` were retuned around the new composition, since capping the table raises the dependency section's share of a smaller artifact; the orientation floor stayed there rather than moving into the growth test, because two blocks are complete by design and no orientation share can hold at every corpus size. What the growth test asserts instead is scale-free: essentially all of the artifact's growth lands in blocks that declare it.

## Exit criteria

- [x] `graph` and `compile` do not classify the same document as a hub and a non-hub.
- [x] A reader can tell in-degree from out-degree in whatever `graph` prints.
- [x] `Document Architecture` is capped or says it is not.
- [x] The compile-composition test fails if an uncapped section grows without a disclosure.
