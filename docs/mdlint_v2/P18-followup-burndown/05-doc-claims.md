# P18.05 — Three surviving documentation over-claims

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Depends on [P18.01](01-compile-renderers.md) if that task changes `compile.md`'s fan-out wording.
>
> Of the 55 documentation items the follow-up stream recorded, 52 were swept by a later round's docs pass. Two of these three were not; the third turned out to be a fourth.

## What was wrong, and what was done

- [x] **FU-37 — closed on arrival.** The bullet "**A malformed `custom` entry is a config error, never a crash.**" in [custom rules](../../guide/rules/custom.md) no longer leaves the reader to infer which subject a sentence belongs to. The MCP half now announces itself ("The MCP ad-hoc `lint` tool holds the same line, with wording of its own"), the follow-on sentence opens "In that tool", and it links [the error contract](../../guide/mcp-server.md#error-contract) — the prescribed fix, applied by a later round's docs pass without knowing it was recorded. Nothing to do; recorded here so it is not re-opened.
- [x] **FU-45 — a property claim four surfaces stated and the code does not hold.** [Output & exit codes](../../guide/output.md#operational-failures-on-both-hosts) said "no MCP payload names a host path outside the directory being analyzed" and contrasted it with the CLI keeping the `../` form, implying MCP never emits one. It does, and by design: `displayConfigPath` is `normalizeRelativePath(path.relative(cwd, configPath))` with **no containment check**, so a `configPath` above the `cwd` comes back verbatim — verified in this tree, `resolveToolConfiguration({ cwd, configPath: "../secrets/x.json" })` answers `CONFIG_NOT_FOUND: Config file not found: ../secrets/x.json` — and across Windows drives `path.relative` hands back an outright absolute path. [The MCP guide](../../guide/mcp-server.md#error-contract) documents that rendering as supported, so two paragraphs of one guide contradicted each other. All four sites now state the property that actually holds: **no payload names a host path the caller did not itself supply**, with the two caller-supplied paths named (the `cwd`, echoed absolutely by [P14.01](../P14-host-boundary/01-mcp-cwd-validation.md)'s `INVALID_INPUT`; the `configPath`, rendered relative to `cwd`) and what the sanitization adds stated as the real bound — an errno **discovered during the run** cannot widen that set.
- [x] **FU-48 — the same glossary sentence was also unparseable.** The em-dash aside sat between the subject clause and the colon introducing the two bounds, so the colon read as introducing the aside. Split in the same edit: the two bounds first, then what they buy, then the property as its own sentence. The glossary is a lookup reference, which is the one place the cost lands.

## Notes

**The claim had a fourth site, and it is fixed too.** FU-45 named three and explicitly scoped out `packages/mcp-server/src/shared/operational-error.ts` and [P14.05](../P14-host-boundary/05-mcp-error-contract.md)'s bullet as `OPERATIONAL_ERROR`-scoped and therefore correct. They are correct about the bound and wrong in the same clause as the three: both asserted the `cwd` is "the one absolute path any payload carries", which `displayConfigPath` contradicts. Correcting three surfaces and leaving the two nearest ones saying the false thing would recreate the drift this phase exists to end, so the clause is corrected wherever it appears — a phrasing change, not a scope change. P14.05's bullet carries a one-line supersession pointer rather than a silent rewrite, since a completed task file is a record of what that task decided.

**One test came with the doc change.** The property is now pinned in `packages/mcp-server/test/tool-context.test.ts`: a `configPath` above the `cwd` is named as typed, `../` included. FU-45 exists because a claim outran the code and nothing could tell; the claim it is replaced with is the one the evidence supports, so the evidence is in the suite rather than in this file.

**FU-37 is why the count moved without work.** It was fixed by the docs pass of a round that never saw the follow-up, which is the pattern the [phase index](index.md) records for 35 of the 75 triaged items — and the reason [P18.09](09-doc-citation-guard.md) is the one task in this phase aimed at the cause rather than an instance.

## Exit criteria

- [x] No `custom.md` bullet leaves the reader to infer which subject a sentence belongs to.
- [x] The path-containment property is stated identically at every site — the three the item named plus the two it scoped out — and is true of `displayConfigPath`, including the cross-drive case.
- [x] The `OPERATIONAL_ERROR` glossary entry reads correctly on a first pass.
- [x] The corrected claim is pinned by a test rather than by a second reading.
- [x] `npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run lint:docs` and `npm test` all pass.
