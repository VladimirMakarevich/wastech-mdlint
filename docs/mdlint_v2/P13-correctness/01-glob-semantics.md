# P13.01 · Glob semantics: negation, anchoring, and both documented

> Phase: [P13 — Correctness](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Backlog: [W-01](../remediation-backlog-2026-08-05.md) (Blocker), [W-03](../remediation-backlog-2026-08-05.md) (Medium). Sources: audit F1 (HIGH, reproduced 8 ways, re-reproduced independently), F25 (LOW); field F-14, F-07 (major). Depends on [P12](../P12-consistency/index.md). Blocks [P13.02](02-default-exclude.md), [P13.04](04-rule-option-defaults.md).

## Goal

Make a glob in config mean one predictable thing in both of its surprising directions: a `!` entry must subtract from the set or be rejected, and the anchoring rule that decides whether a pattern is root-anchored or depth-agnostic must be stated where a user writes config. These ship together because the documentation cannot be written until the negation decision is made.

## Problem

**Negation (W-01).** `matchesConfigGlob` is the single matcher behind every glob surface in the product, and it calls `micromatch.isMatch` with the whole pattern array ([`packages/core/src/discovery/globs.ts`](../../../packages/core/src/discovery/globs.ts) around `:37`). That call is a first-truthy OR across the list, and a `!`-prefixed entry compiles to an _inverting_ matcher — so `["docs/public/**", "!docs/private/**"]` reads as "under `docs/public` **or** not under `docs/private`", true for almost every path in a repository. A second failure mode sits in the same helper: `normalizeConfigGlob` rewrites a slash-free pattern to a depth-agnostic form (`:14`), so a bare `!keep.md` becomes a literal filename pattern and is a silent no-op. Nothing validates or rejects a leading `!`.

**The repository already diagnosed this and fixed it 200 lines away.** [`workspace-packages.ts`](../../../packages/core/src/discovery/workspace-packages.ts) states in prose at `:249` that an ordered negation "never actually excludes anything" with `isMatch`, uses the correct list form at `:254`, records the semantics in an ambient declaration at [`types/micromatch.d.ts`](../../../packages/core/src/types/micromatch.d.ts) `:8`, and pins it with two tests. The load-bearing matcher was never converted. The dedicated test file for the shared matcher has no ordered-negation case at all — its only `!` is an extglob syntax check in `packages/core/test/rule-utils.test.ts`.

**Blast radius.** Grepping `matchesConfigGlob|matchesFileScope` across `packages/core/src` gives every affected surface: top-level `include`/`exclude`, directory pruning, every rule's `files`/`exclude` through the shared scope helper, `LLM-001.entrypoints`, `SIZE-001.overrides.pattern`, `CTX-003.glossary`, `REF-006`, `GRP-002.entryPoints`, `GRP-003.chain[].files`, `STR-001` entries, REF-001/003 target `exclude`, and `SEC-001`'s inferred scope.

**Anchoring (W-03).** A pattern containing `/` is returned untouched (root-anchored); a pattern without `/` gets a `**/` prefix (any depth). Internally consistent, and documented at exactly one place — `docs/guide/rules/STR-001.md:25` — and nowhere in `docs/guide/configuration.md`, `docs/guide/config-reference.md`, or `README.md`. Both directions bite: `exclude: ["node_modules/**"]` prunes only the root copy and silently under-excludes a monorepo, which is exactly what `README.md:127` tells a user to copy; and `include: ["*.md"]` recurses into the whole tree, the opposite of shell, gitignore and tsconfig. `init` emits `"./*.{md,mdx}"` because the `./` is load-bearing, and nothing says so.

The field test measured the anchoring half on a real monorepo: no config / the README example / an any-depth prefix gave 3 / 2 / 1 files on the same three-file fixture.

## Deliverables / steps

1. **Decide the negation direction — it is a behavior change either way, so decide it deliberately and record the choice.**
   - **(A) Deliver negation:** route `matchesConfigGlob` through the list form already used at `workspace-packages.ts:254`. Negation becomes a feature; any corpus relying on today's accidental widening shrinks.
   - **(B) Reject it loudly:** reject a leading `!` during config validation, with a diagnostic that names the pattern and the key. Smaller behavioral change, turns a silent wrong answer into a loud one, does not deliver the feature.
   - Either way, normalize a leading `!` **before** the depth-agnostic prefix at `globs.ts:14`, or a bare `!keep.md` stays a silent no-op under (A) and slips past validation under (B).
2. **Close it in one place.** The fix belongs in [`packages/core/src/discovery/globs.ts`](../../../packages/core/src/discovery/globs.ts), not per-surface — the whole point of the shared matcher is that every surface inherits it.
3. **Add the ordered-negation case to `packages/core/test/rule-utils.test.ts`**, which is where its absence let this ship. Cover the three reproduced shapes: negated `include`, negated `exclude`, and a negated rule-level `files`.
4. **Document the anchoring rule where config is written:** `docs/guide/configuration.md` and `docs/guide/config-reference.md`. State both directions and the `./` anchoring prefix.
5. **Fix `README.md:127`** to the any-depth form. `README.md:80` and [`discovery/config-writer.ts`](../../../packages/core/src/discovery/config-writer.ts) `:134` are already correct, so only the hand-copy example is wrong.
6. **Record the outcome.** If (B), the anchoring documentation says negation is rejected and why. If (A), it documents ordered evaluation. Either way [`glossary.md`](../glossary.md)'s **File scope** entry — which currently describes glob semantics as "picomatch with `{ dot: true }`" and says nothing about ordering — gains the rule.

## Out of scope

Changing what any shipped default `exclude` contains — that is [P13.02](02-default-exclude.md), which depends on this task's decision. Adding a warning for a slash-free directory-ish pattern that was probably meant to be anchored: the backlog notes it overlaps direction (B) above, so decide it here rather than twice, but implement it only if (B) is chosen.

## Exit criteria

- [ ] `include: ["docs/**", "!docs/private/**"]` yields only `docs/public` — or is rejected with a diagnostic naming the pattern.
- [ ] `exclude: ["docs/private/**", "!docs/private/keepme.md"]` no longer empties the corpus and no longer exits `0` on a repository with findings.
- [ ] A rule-level negated `files` no longer pulls in a third file.
- [ ] A slash-free `!a.md` is not a silent no-op.
- [ ] `packages/core/test/rule-utils.test.ts` carries an ordered-negation case that fails before the fix.
- [ ] Each of the four shapes in the field test's anchoring table (`NOTE.md`, `*.md`, `./NOTE.md`, `node_modules/**`) has a documented, predictable answer in `configuration.md` and `config-reference.md`.
- [ ] The `README.md` example prunes a nested `node_modules`.
- [ ] The glossary's **File scope** entry states the anchoring rule and the negation decision.
- [ ] Gates green.
