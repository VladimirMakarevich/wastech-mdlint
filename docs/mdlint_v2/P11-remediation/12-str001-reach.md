# P11.12 · `STR-001` filesystem reach vs corpus-only (+ guide)

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Finding **BL-1**
> ([`p9-09` report](../../research/p9-09-full-solution-deep-audit/report.md), Medium, confirmed).

## Goal

`STR-001` ("required files exist") and its guide must agree. Today the rule can only see the Markdown
corpus, so a present non-`.md` required file — the guide's own `LICENSE` example — is reported
missing on a compliant repository.

## Problem (from the audit)

`STR-001` decides satisfaction by scanning `context.projectFiles`
(`packages/core/src/engine/rules/sec.ts:204-205`), which `lint-files.ts:87` populates as
`[...documents.keys()]` from `loadDocuments(include ?? ["**/*.md"], …)` (`lint-files.ts:75`). So the
satisfaction set is the `include`-matched **Markdown corpus — never the filesystem.** A required entry
that is not Markdown within `include` (the guide's `LICENSE`, or `package.json`) is reported _missing
even when it exists on disk_. The membership test compounds it: `matchesConfigGlob` rewrites a bare
`README.md` to `**/README.md` (`discovery/globs.ts:7`), so a required root file is satisfied by any
`docs/**/README.md` anywhere — the rule cannot pin a required file to a location.

The guide overstates this: it claims `STR-001` "scans the analyzed file corpus"
([`STR-001.md:8`](../../guide/rules/STR-001.md)) yet motivates it with "every project must ship a
`README.md`, a `CONTRIBUTING.md`, a `LICENSE`" (`:11`) and "literal paths must match exactly" (`:66`)
— both falsified. The one test never exercises the failure: it requires `LICENSE.md` and only asserts
genuinely-absent names (`rules-str.test.ts:54`).

## Deliverables / steps

Pick one direction (a maintainer decision the audit leaves open) and make code, guide, requirement,
and test agree:

- **(A) Filesystem resolution** — resolve each required path against the filesystem via a **bounded**
  `existsSync`-style probe from the analyzed root (reusing the containment helper from
  [P11.02](02-sec003-path-escape.md) so the probe cannot escape the root). Restores the guide's
  `LICENSE`/"match exactly" promise; widens the rule's reach beyond the parsed corpus — document that.
- **(B) Corpus-only, honestly** — narrow the guide and the requirement to "required **Markdown** files
  within `include`", drop the `LICENSE` example and the "literal paths must match exactly" claim, and
  document that bare names are corpus-wide globs.

Either way, add a regression fixture with a **present non-`.md` required file** so the false-missing
case is covered (it is untested today).

## Exit criteria

- [ ] `STR-001`, its guide (`STR-001.md`), the relevant requirement, and the test tell one story.
- [ ] A present non-`.md` required file is either satisfied (A) or explicitly out of scope (B), with a fixture.
- [ ] If (A): the filesystem probe cannot read/resolve outside the analyzed root.
- [ ] If (B): the `LICENSE` example and "literal paths must match exactly" claim are removed.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
