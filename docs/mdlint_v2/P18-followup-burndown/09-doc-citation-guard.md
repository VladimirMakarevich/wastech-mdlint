# P18.09 — A guard against docs citing APIs that do not exist

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**. Depends on [P18.02](02-code-fixes.md) and [P18.05](05-doc-claims.md), so it ran against a tree whose citations are already correct.
>
> The only item in this phase that addresses the cause of the follow-up stream rather than an instance of it. Spun out of [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md), whose implementation notes state plainly that this defect class has no automated guard.

## What was wrong, and what was done

- [x] **The repository lints its own prose for references between documents and not at all for references into its own source.** Fifty-five of the 74 items this phase triaged are a documentation claim that outran the code, and the largest recurring shape is the narrowest: a document names a function, export or constant that no longer exists. [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md) had to fix an enforced architecture decision naming three absent APIs; [P18.02](02-code-fixes.md) fixed two comments naming a moved expression and a miscounted set. Each was found by a person reading closely, one at a time, rounds apart. [P17.02](../P17-plan-of-record/02-self-linting-config.md)'s CI step catches a broken **link** — which is why seventeen dead links became a build failure — and structurally cannot catch a code span, because nothing connects inline code to the source tree. `packages/core/test/doc-citations.test.ts` closes that half, and is blocking from the day it lands because it reports zero.

### The four decisions the design turned on

**Where it lives: a repository test in `packages/core/test/`.** The precedent is already five files deep — `docs-sync.test.ts`, `boundary-guards.test.ts`, `plan-completion-surface.test.ts`, `package-payload.test.ts` and `registry-inventory.test.ts` all read the repository from there — and it needs no new dependency and no new CI step, so the local gate gets it for free. **A CI step beside `lint:docs`** was rejected for the opposite reason: it would run only on the runner, so a contributor would learn about a broken citation after pushing. **A custom rule this tool runs on itself** was rejected as impossible rather than undesirable: a declarative custom rule is pure data asserting over Markdown, and `Rule.check` is synchronous by an [enforced decision](../decisions/core-hosts-the-pipeline.md) — resolving names against the packages' TypeScript sources is neither.

**The corpus is two directories, named.** `docs/mdlint_v2/decisions/` and `docs/mdlint_v2/requirements/` — precedence tiers 2 and 3 of [AGENTS.md](../../../AGENTS.md). A wrong citation there does not merely misinform; it points the next change in the wrong direction. Measured before choosing: 11 files, 135 candidate spans, **3 unresolved**. The wider corpora were measured too, and that is why they are out — over `docs/guide` most of what a guard reports is a Markdown table's `Owner` column and a rule example's `Summary` heading, and a guard that reports noise is switched off within a week, which is the failure [P17.02](../P17-plan-of-record/02-self-linting-config.md) avoided by starting with two rules that already reported zero. **Growth follows the same rule**: a document joins once a run over it already reports zero. The next candidate is the roadmap (4 spans today), then the glossary — which also needs the token source widened to `test/support/`, because it documents shared test helpers by name.

**What counts as a citation.** Three shapes, each unambiguous in prose: a call (`foo(...)`), a camelCase identifier, and a PascalCase one. Everything else is deliberately invisible, and the exclusions are pinned as a test of their own rather than left to the reader: a CLI flag, a lower-case config key, a shell fragment, a document path, a glob, an extension, a generic, a dotted member, a snake*case path and a SCREAMING_CASE constant all read as \_not a citation*. Requiring a capital is what keeps `include`, `error` and `off` out while keeping `respectGitignore` in.

**What a name is resolved against: every identifier token in `packages/*/src`, not the barrels' export list.** A deliberate weakening, and the reason it is not a false-positive machine: these documents legitimately cite internals the barrels do not carry — `displayConfigPath`, and `classifyPrunedDirName`, which [P18.02](02-code-fixes.md) removed from a barrel on purpose — and config keys declared as Zod object properties rather than as bindings (`respectGitignore`, `minCycleLength`). An export-list check would report correct citations as defects and be switched off for it. The bound this accepts is stated at the guard: a rename trips it only once the old name is gone from every source file, so a half-finished rename that leaves the old spelling in one comment still passes. Verified by mutation — renaming `topologicalSort` in one of its five source files leaves the guard green, renaming it in all five fails it naming the document and the symbol.

### What the corpus held, and the shape of each

- [x] **`resolveConfig` — the one real stale citation, corrected in place.** [Requirements M3](../requirements/05-mcp-server.md) named the shared MCP config helper `resolveConfig`; it shipped as `resolveToolConfiguration` (with `resolveToolContext` beside it). Amended in the [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md) style — the requirement is unchanged, the planning name is corrected so nobody greps for it.
- [x] **`globSync` — a citation of an absence, allowlisted.** The [enforced decision](../decisions/core-hosts-the-pipeline.md) states "no `globSync` call exists in core" as evidence that discovery reads through `node:fs/promises`. The name is _supposed_ to be missing.
- [x] **`destructiveHint` — a future API, allowlisted.** An MCP SDK annotation the requirement names to say what a `fix` tool would declare; M5 defers that tool, so nothing uses it yet.
- [x] **`resolveConfig` again — the amendment quoted the name it was retiring**, and the guard reported it. That is the superseded-name shape every decision record produces, and it is allowlisted with the reason, which is what "a decision that was reversed is still a decision" costs in practice.

**The allowlist cannot rot in either direction.** A third assertion fails when an entry's citation has left the corpus (dead weight) **or** when the name it exempts has appeared in the source. The second half is load-bearing for `globSync`: if a `globSync` call ever lands in core, the exemption goes red and the sentence claiming its absence is what has to change — a guard on a document's negative claim, which nothing else in the tree provides.

## Notes

**It found its own author.** The guard reported the amendment written to satisfy it, because that amendment quotes the retired name. Nothing about that is a flaw — it is the case the deliverable calls "a decision record describing what was reversed is not a defect", arriving unprompted on the first run, and it is why the allowlist takes a required reason rather than a bare list of names.

**Two documentation surfaces moved with it.** [testing.md](../../../.agents/rules/testing.md) gains a section naming the three suites that read this repository's own Markdown and what each proves — this guard, the plan completion surface, and the generated-docs sync — plus `lint:docs` as the fourth and only non-Vitest one. It is deliberately **not** a process-boundary category: those five are a closed set about the process boundary, and this is not one.

**What this does not close.** The other 52 documentation items in the triage were claims that were wrong rather than absent — an equivalence stated too strongly, a count off by one, a property that outran its code. No greppable guard catches those; [P18.05](05-doc-claims.md)'s answer was to pin the corrected claim with a test at the site, which is the general form and does not generalize into a sweep.

## Exit criteria

- [x] The guard reports zero over its declared corpus on the day it lands, and is blocking from that day.
- [x] Renaming or deleting an exported symbol that a tier document cites fails the guard — verified by mutation over all five files that name `topologicalSort`.
- [x] A CLI flag, config key or path in backticks does not trip it, pinned by tests.
- [x] Every allowlist entry states why the citation is deliberate, and a stale entry fails the suite.
- [x] The corpus-growth rule is written down at the guard and in [testing.md](../../../.agents/rules/testing.md).
- [x] `npm run format`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run lint:docs` and `npm test` all pass.
