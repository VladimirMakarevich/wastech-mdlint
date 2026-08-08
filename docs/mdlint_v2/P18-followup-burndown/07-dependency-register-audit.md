# P18.07 — Trace the remaining dependency-register entries

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.
>
> Spun out of [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md), which named this the largest un-swept surface it left behind and put it explicitly out of its own scope.

## What was wrong, and what was done

- [x] **Twenty of the register's 29 entries had never been checked against the code they describe.** [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md) traced nine and found two wrong — a 2-of-9 rate on entries written before implementation, in a document that sits in a **precedence tier** contributors are told to obey, so a wrong entry does not merely confuse a reader: it points the next change in the direction the register names. Every entry is now traced, and each amendment names the file that decided it.
- [x] **The scope turned out to be all 29, not the complement of nine.** P17.03 recorded four verdicts while counting nine traced, so five traces left nothing behind — and a trace with no recorded verdict is indistinguishable from no trace at all. This pass therefore read every entry, including the four with standing verdicts. (Its "nine of the 29 **numbered** entries" is also loose: 22 entries are numbered and 7 are the unnumbered per-phase bullets, which are equally part of the log.)
- [x] **No further falsehood, one further qualifier.** The `init`-merge entry said merge keeps every existing `rules[]` entry **verbatim**. It does not: `canonicalizeExistingEntry` rewrites a merged entry's **id** through `canonicalizeRuleId`, so an accepted `ref001` is re-emitted as `REF-001`, while severity, options and key order are genuinely untouched. Amended in place with the reason the code already gives — a written config always emits canonical ids, and a custom entry's id has to agree with the `const` the generated project schema is built from. The `include`/`exclude`/`settings` half is literal, and now says so.
- [x] **One wording amendment.** 2.3 read "tested with the real injected **legacy** graph". The strategy holds and the qualifier does not: `rules-grp.test.ts` drives every case through `lintFiles`, which injects the semantic `buildContextGraph` that 2.2 itself predicted would replace the legacy builder at P4.06. Substance unchanged, stale descriptor removed.

### What the trace found, by entry

Every verdict below names the deciding site, so re-checking one entry costs one file rather than a repeat of this pass.

| Entry | Verdict | Decided by |
| --- | --- | --- |
| 1.1 Zod v4 | holds | `zod@^4` in `core` and `mcp-server` and nowhere else (`cli` carries none), `z.toJSONSchema` in `engine/schema.ts`; no `zod-to-json-schema` anywhere |
| 1.2 TS project references | holds | root `tsconfig.json` `references` the three packages; `composite` in `tsconfig.base.json`, restated per package; build script is `tsc -b` |
| 1.3 D4–D7 | holds | `lint` registered as default with a hidden `scan` alias (`cli/src/program.ts`); `commander@^14` + `@inquirer/prompts@^8`; no LSP package, no docs site |
| 2.1 No `ids` on `ParsedDocument` | holds | no such field in `markdown/document-types.ts`; `extractDefinedIds` in `engine/defined-ids.ts`, imported by `graph/build-context-graph.ts` and `engine/rules/ref.ts` — the two consumers named |
| 2.2 Graph injected from P3 | holds | `RuleContext.graph` is optional in `engine/types.ts`; `engine/rules/grp.ts` reads `context.graph` and builds no adjacency; GRP-003 is graph-independent |
| 2.3 Graph-rule test strategy | holds, qualifier | `rules-grp.test.ts` runs through `lintFiles` — real injected graph, no mocks. "legacy" amended away |
| 2.4 Inline-disable | holds | directive grammar in `markdown/parse-document.ts`; the three kinds in `document-types.ts`; per-rule ranges computed engine-side in `engine/suppression.ts` |
| 2.5 Edge taxonomy | holds | the five types in `graph/context-graph-types.ts`; `hasFragment ? "anchor" : "link"` and the same-file skip at three sites in `build-context-graph.ts` |
| 3.1 CTX-001 placeholder set | holds | `engine/primitives/content.ts` — the five literals, extends-by-union, whole-body and case-insensitive, each stated at the constant |
| 3.2 LLM-001 single budget | holds | `maxTokensPerEntrypoint` is the only budget option in `engine/rules/llm.ts` |
| 3.3 Node role thresholds | holds | `classifyNode` in `compile/graph-analysis.ts` — degree-only, first-match in the order given, default threshold 3, with the order's load-bearing-ness stated in place |
| 3.4 Compile presets | holds | `CompileCommandPreset` is the three names; `compile/compile-context.ts` defaults to `generic` |
| 3.5 Custom rule IDs | holds | `CUSTOM_ID_GRAMMAR` in `engine/rules/custom.ts` is byte-identical to the grammar above, with the reserved-prefix check beside it; the schema pattern is built with prefix lookaheads in `engine/schema.ts` |
| 4.1 Schema-generator API | holds | recorded by P17.03 |
| 4.2 `--fix` engine | **false**, amended | recorded by P17.03 |
| 4.3 P4 query layer | **false**, amended | recorded by P17.03 |
| 4.4 Frozen `CompileResult` | holds, qualifier | recorded by P17.03 |
| 5.1 Slug contract | holds | `github-slugger` imported and instanced per document in `markdown/parse-document.ts`; `document-types.ts` states the slug is verbatim and never re-derived |
| 5.2 Impact traversal | holds | `graph/query.ts` keeps a visited map with the termination reason stated; `getImpactSet` in `graph/impact-analysis.ts` is the full closure filtered to `depth > 0`, with no cap |
| 5.3 Block→section ownership | holds | `markdown/parse-document.ts` and the field's own comment in `document-types.ts` — most-recent heading at any level, flat |
| 5.4 `init` cluster scoring | holds | `discovery/repo-scan.ts` — `subtreeCount + (isKnown ? minClusterSize : 0)`, threshold 3 |
| 5.5 id-ref discovery | holds | the `IdRef` shape in `engine/defined-ids.ts`; `build-context-graph.ts` adds id-ref edges only when `idRef` is configured |
| REF-005/006 orphan detection | holds | `engine/rules/ref.ts` requires both column options non-empty; orphan is a warning, dangling an error |
| REF-001 i18n resolution | holds | `engine/site-router.ts` resolves same-locale first and falls back to `defaultLocale` |
| Component sort order | holds | `graph/graph-algorithms.ts` sorts by length descending then by first path, each component pre-sorted by path so the first is the smallest |
| Edge multiplicity & cycles | holds | `build-context-graph.ts` states no `(from,to)` dedup and names dedup-with-count as a future shape |
| P6 `init` merge | holds, qualifier | `discovery/config-writer.ts` — top-level keys round-tripped except `rules`/`$schema`; ids canonicalized, amended above |
| P7 MCP error taxonomy | holds | `errors.ts` — the eight-code closed set including the amended `OPERATIONAL_ERROR` |
| P9 `engines.node` | holds | `>=24.17.0`, no upper bound, on the root and all three packages |

## Notes

**The falsehoods are not randomly distributed, and that is the finding worth more than the sweep.** Both — 4.2 and 4.3 — are in **cross-phase dependencies**, the section whose entries predict what a _later_ phase will consume. Every entry describing a decision rather than a prediction held: the algorithms, the taxonomies, the locked constants, all twenty-four of them. A register of decisions decays where it forecasts, not where it decides. That is now recorded in the log itself, so the next sweep knows where to start and how much of it is likely to be worth re-reading.

**No code changed.** Two entries were reworded to match the tree; the tree was already right in both cases.

**The new citation guard covered this change.** [P18.09](09-doc-citation-guard.md)'s corpus includes `docs/mdlint_v2/decisions/`, so every symbol these amendments name — `canonicalizeExistingEntry`, `canonicalizeRuleId`, `buildContextGraph`, `lintFiles` — was checked against the source as the amendments were written, rather than being another citation somebody verifies in a later round. That is the first time this register has been edited with that check in place.

## Exit criteria

- [x] Every one of the 29 entries has been traced against current source, and the notes name which pass did it.
- [x] No entry states a dependency, symbol or version the tree contradicts.
- [x] Each corrected entry names the file and line that decided it, so a future reader can re-check without repeating the grep.
- [x] The hit rate over the full 29 is recorded in the register, with what it says about where this surface decays.
- [x] `npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run lint:docs` and `npm test` all pass.
