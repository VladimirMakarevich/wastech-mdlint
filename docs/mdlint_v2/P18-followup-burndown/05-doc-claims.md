# P18.05 — Three surviving documentation over-claims

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Not started**. Depends on [P18.01](01-compile-renderers.md) if that task changes `compile.md`'s fan-out wording.
>
> Of the 55 documentation items the follow-up stream recorded, 52 were swept by a later round's docs pass. These three were not.

## Problem

**FU-37 — two subjects in one bullet read as a contradiction.** In `docs/guide/rules/custom.md`, the bullet "**A malformed `custom` entry is a config error, never a crash.**" carries a sentence added by [P13.06](../P13-correctness/06-config-diagnostics.md) about config-load key location beside a pre-existing sentence about the MCP tool's argument validation catching deeper shape errors. The two describe different subjects and read as contradictory unless the reader notices which is which.

**FU-45 — a property claim that three surfaces state and the code does not hold.** `docs/guide/output.md` says "no MCP payload names a host path outside the directory being analyzed", contrasting it with the CLI keeping the `../` form — implying MCP never emits a `../` path. It does: `displayConfigPath` is `normalizeRelativePath(path.relative(cwd, configPath))` with no containment check, so `lint-files({ cwd, configPath: "../secrets/x.json" })` returns `CONFIG_NOT_FOUND` naming `../secrets/x.json`, and across Windows drives `path.relative` hands back an outright absolute path. `docs/guide/mcp-server.md` documents that rendering as supported, so two paragraphs of the same guide contradict each other. The generalization also appears in [the glossary](../glossary.md) ("Two bounds keep **every payload** from naming a host path **outside** that `cwd`") and in the `OPERATIONAL_ERROR` row's rationale in [accepted behaviors](../accepted-behaviors.md). The `OPERATIONAL_ERROR`-scoped statements in `packages/mcp-server/src/shared/operational-error.ts` and in [P14.05](../P14-host-boundary/05-mcp-error-contract.md)'s notes are correct — only the three that say "every" or "no payload" overreach.

**FU-48 — the same glossary sentence is also unparseable.** "Two bounds keep every payload from naming a host path **outside** that `cwd` — the `cwd` itself is the one absolute path any payload carries, in the `INVALID_INPUT` message above: an errno naming **no** path, and one naming a path outside the tool's `cwd`, both stay a sanitized `INTERNAL_ERROR` — stricter than the CLI…". The em-dash aside sits between the subject clause and the colon that introduces the two bounds, so the colon reads as introducing the aside. The glossary is a lookup reference, which is the one place this costs a reader time.

## Deliverables / steps

- [ ] **FU-37:** make the MCP sentence's subject explicit — "In the MCP tool, shape errors deeper inside the entry are caught a step earlier, by its argument validation" — and link the MCP error contract.
- [ ] **FU-45:** scope the claim to what holds at all three sites: no MCP payload names a host path **the caller did not itself supply**. The paths any payload can carry are the tool's own `cwd` (echoed absolutely by [P14.01](../P14-host-boundary/01-mcp-cwd-validation.md)'s `INVALID_INPUT`) and the caller's own `configPath` (rendered relative to `cwd`, `../` included). Apply it in `docs/guide/output.md`, in [the glossary](../glossary.md)'s "Two bounds keep every payload…" clause, and in the `OPERATIONAL_ERROR` rationale in [accepted behaviors](../accepted-behaviors.md).
- [ ] **FU-48:** in the same glossary edit, split the sentence: state the two bounds first ("an errno naming no path, and one naming a path outside the tool's `cwd`, both stay a sanitized `INTERNAL_ERROR` — stricter than the CLI, which renders a `../` chain"), then the `cwd` exception as its own sentence.

## Exit criteria

- [ ] No `custom.md` bullet leaves the reader to infer which subject a sentence belongs to.
- [ ] The path-containment property is stated identically at all three sites and is true of `displayConfigPath`, including the cross-drive case.
- [ ] The `OPERATIONAL_ERROR` glossary entry reads correctly on a first pass.
