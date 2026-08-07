# P18.09 — A guard against docs citing APIs that do not exist

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Depends on [P18.02](02-code-fixes.md) and [P18.05](05-doc-claims.md), so it runs against a tree whose citations are already correct.
>
> The only item in this phase that addresses the cause of the follow-up stream rather than an instance of it. Spun out of [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md), whose implementation notes state plainly that this defect class has no automated guard.

## Problem

Fifty-five of the 74 items this phase triaged are a documentation claim that outran the code, and the largest recurring shape is the narrowest: **a document names a function, export or constant that no longer exists.** [P17.03](../P17-plan-of-record/03-adr-and-dependency-register.md) had to fix an enforced architecture decision naming three APIs absent from the tree; [P18.02](02-code-fixes.md) carries two more comments naming removed expressions (`include ?? ["**/*.md"]`, "all three functions"). Each was found by a human reading closely, one at a time.

[P17.02](../P17-plan-of-record/02-self-linting-config.md)'s CI step catches a broken **link**, which is why the 17 dead links became a build failure. It cannot catch a code span naming a symbol that was renamed or removed, because nothing connects an inline code span to the package exports. That is the gap: the repository lints its own prose for references between documents and not at all for references into its own source.

Scope discipline matters more here than coverage. A guard that flags every inline code span will flag prose, option names, CLI flags and shell fragments, and will be disabled within a week — the same failure mode [P17.02](../P17-plan-of-record/02-self-linting-config.md) avoided by starting with two rules that already reported zero. So the target is the narrow, high-value case: an identifier-shaped code span in an **enforced or tier** document, checked against the packages' actual exports, with an explicit allowlist for the historical citations that are supposed to name removed APIs (a decision record describing what was reversed is not a defect).

## Deliverables / steps

- [ ] Decide where the guard lives: a repository test in `packages/core/test/`, a CI step beside `lint:docs`, or a custom rule this tool can run on itself. Prefer whichever needs no new dependency, and record why the other two were rejected.
- [ ] Define the corpus narrowly and by name — the enforced and tier documents, not all of `docs/` — and state the rule for growing it, mirroring the "a rule joins once it already reports zero" rule in the self-lint config.
- [ ] Define what counts as an identifier-shaped span, and pin the definition with cases that must **not** match: CLI flags, config keys, file paths, shell fragments, and prose in backticks.
- [ ] Resolve candidates against the real export surface of the three packages rather than a hand-written list, so a rename fails the guard without anyone updating it.
- [ ] Provide one allowlist with a required reason per entry, for citations that deliberately name a removed or historical API.
- [ ] Bring the corpus to zero before the guard becomes blocking, and fix whatever it finds in the same change.

## Exit criteria

- [ ] The guard reports zero over its declared corpus on the day it lands, and is blocking from that day.
- [ ] Renaming or deleting an exported symbol that a tier document cites fails the guard.
- [ ] A CLI flag, config key or path in backticks does not trip it, pinned by tests.
- [ ] Every allowlist entry states why the citation is deliberate.
- [ ] The corpus-growth rule is written down where the next contributor will read it.
