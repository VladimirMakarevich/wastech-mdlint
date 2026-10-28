## Description

`wastech-mdlint lint` can run for hours at 100% of one core on a real documentation corpus. It never finishes, so the docs gate in CI and in agent hooks simply stalls. Removing a single ordinary Markdown link makes the same run finish in about a minute.

Observed in the `chat1o1` repository (`@wastech-mdlint/cli` 0.1.2, ~170 Markdown documents):

- One new link from `docs/v2/requirements/mobile-pages/conversation-thread.md` to `DESIGN.md` made the run go from ~92 s to 90–130 CPU minutes and counting. Without the link the corpus lints clean with 0 problems.
- The hang happens with **no rules enabled** (`"rules": []`), so it lives in the core pipeline, not in a rule.
- A V8 CPU profile (`node --prof`) of the stalled run shows ~80% of all ticks in deep recursion of `walk` in `packages/core/src/graph/build-context-graph.ts` (`cyclePath`, around line 366; `dist/graph/build-context-graph.js:290` in 0.1.2).

### Root cause

`cyclePath(component, adjacency)` looks for a concrete cycle through an SCC that `detectCycles` already found. It does this with a backtracking DFS from the component's smallest node, and on backtrack it un-marks the node:

```ts
visited.add(neighbor);
path.push(neighbor);
const found = walk(neighbor);
if (found !== undefined) {
  return found;
}
path.pop();
visited.delete(neighbor); // <- turns the search into enumeration of all simple paths
```

Because of `visited.delete`, the search tries every simple path out of `start` until one happens to close back on it. That is exponential (factorial on dense components) in the SCC size. The code comment only discusses stack depth ("bounded by that SCC's member count"), not running time.

The un-marking is unnecessary. The input is a strongly connected component, so every member reaches `start`. A plain DFS with permanent `visited` marking explores every member at most once and, on reaching the member that has an edge to `start`, returns a cycle — O(V + E). A BFS from `start` would additionally return the shortest cycle, which is a nicer and still deterministic report.

### Minimal reproduction

`a → x1`, the documents `x1…xk` all link to each other, only `x1` links to `z`, and `z → a`. The DFS walks every ordering of the clique before it tries `x1 → z`.

```sh
k=11; R=$(mktemp -d); mkdir -p "$R/docs"
printf '# a\n\n- [x1](x1.md)\n' > "$R/docs/a.md"
for i in $(seq 1 $k); do
  { echo "# x$i"; echo
    for j in $(seq 1 $k); do [ $i != $j ] && echo "- [x$j](x$j.md)"; done
    [ $i = 1 ] && echo "- [z](z.md)"; } > "$R/docs/x$i.md"
done
printf '# z\n\n- [a](a.md)\n' > "$R/docs/z.md"
printf '{ "include": ["docs/**/*.md"], "rules": [] }' > "$R/wastech-mdlint.config.json"
cd "$R" && time npx wastech-mdlint lint .
```

Measured with 0.1.2 on an Intel Mac:

| k (documents = k + 2) | Time |
| --- | --- |
| 7–9 | ~1 s |
| 10 | 2.25 s |
| 11 | 15.7 s |
| 12, 13 | extrapolated: minutes, then tens of minutes (each step multiplies by about k) |

### Verified fix

Deleting the single `visited.delete(neighbor);` line in the built `dist/graph/build-context-graph.js` (a local, reverted experiment) gave:

- k = 11 reproduction: 15.7 s → 1.9 s.
- The real `chat1o1` corpus on the stalling commit: hours → 13 s, 0 problems. That is even faster than the ~92 s the corpus took before the offending link, because the normal run also spent most of its time in this enumeration.

## Acceptance criteria

- [ ] `cyclePath` finds a cycle through an SCC in O(V + E): either DFS with permanent `visited` marking, or BFS from `start` to the shortest path back to it. Output stays deterministic: same start node, stable neighbour order.
- [ ] The comment above `cyclePath` explains the time bound and why un-marking is not needed (every SCC member reaches `start`), not only the stack-depth bound.
- [ ] A regression test builds the clique reproduction above in a temp dir with k ≥ 14 and asserts that the graph build completes quickly, with a generous wall-clock cap so slow CI does not flake. It also asserts that the reported cycle is a valid closed path inside the component.
- [ ] Existing graph/cycle tests stay green. If the reported cycle path changes for existing fixtures (e.g. BFS returns a shorter cycle), the expected outputs are updated deliberately and the change is noted in `CHANGELOG.md`.
- [ ] `npm run typecheck`, `npm run build`, `npm test` and `npm run format` are green.

## Constraints

- Keep the single shared `ContextGraph` and do not add a second traversal implementation.
- Do not change the public shape of cycle findings, only how the path is found.
- No new dependencies.
