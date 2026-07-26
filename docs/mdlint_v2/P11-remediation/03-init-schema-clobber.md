# P11.03 · Guard an existing `schema.json` in `init`

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Done**. Audit finding **H-4** (data loss,
> [post-P9 audit](../audit-2026-07-25-post-p9.md)).

## Goal

`init` must never silently overwrite a user's existing `schema.json`. Today it truncates and replaces
it with the generated schema, with no check and no warning.

## Problem (from the audit)

`packages/cli/src/init-command.ts:783-789` writes the project schema with a bare
`writeFile(schemaPath, …)` and **no `fileExists()` guard**. The asymmetry is the bug: the CI-workflow
write 280 lines above **does** guard (`init-command.ts:505-507`) and is covered by a test
(`init.e2e.test.ts:1017` — "never overwrites an existing CI workflow file"). Reproduced: a user's
44-byte `schema.json` was replaced by the 70,055-byte generated one after
`init . --yes --on-existing merge`.

`schema.json` is a very common filename, and `wastech-mdlint schema` itself defaults to
`--out schema.json`, so a collision is likely. This violates the invariant the module itself cites
(`init-command.ts:39` — "I1's 'no implicit file-clobbering' spirit") and requirement **I1** in
[`docs/mdlint_v2/requirements/06-installation.md`](../requirements/06-installation.md). No tests
cover it.

## Deliverables / steps

1. Add the same existence guard the CI-workflow write uses (`init-command.ts:505-507`) before
   writing the schema at `:783-789`. Respect the `--on-existing` policy consistently with how the
   config write treats an existing config.
2. Surface the outcome in the write summary — an explicit "kept existing `schema.json`" (or
   "overwrote, per `--on-existing overwrite`") line, not a silent skip. Use the repo-relative path
   (see [P11.10](10-cli-exit-contract.md) for the path-normalization invariant).
3. Regression tests mirroring the CI-workflow test: an existing `schema.json` is preserved by
   default and the summary reports it; an explicit overwrite policy still replaces it.

## Exit criteria

- [x] `init` with an existing `schema.json` does not overwrite it by default and says so in the summary.
- [x] The `--on-existing` policy governs the schema write the same way it governs the config write.
- [x] A test asserts the existing `schema.json` is byte-unchanged on the default path.
- [x] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.

## Implementation notes

- **New pure decision function, `resolveSchemaWriteOutcome`**, exported next to `formatWriteSummary`
  in `init-command.ts`: takes the already-resolved
  `existingConfigAction: ExistingConfigAction | "none"` (the same signal that already governs the
  config write — no new CLI flag, no new prompt, no `InitPrompter` change) plus the existing file's
  content (`existingSchemaText: string | undefined`) and the freshly generated
  `generatedSchemaText: string`, and returns `{ shouldWrite, kind }` where `kind` is
  `"written" | "unchanged" | "kept" | "overwritten"`. No
  existing file writes fresh; identical bytes report `"unchanged"` with no write regardless of
  action; among differing bytes, `"overwrite"` bypasses the guard and `"merge"`/`"none"` both keep
  the file untouched. `"skip"` never reaches the write step (it returns earlier), so those four
  outcomes are the only ones that matter here.
- **Write site (`runInitCommand`, formerly `:783-789`)** now reads the existing file's full text
  (`readFile(schemaPath, "utf8").catch(() => undefined)`, the same "treat any read failure as
  absent" degrade `fileExists` already uses elsewhere in this file) instead of only checking
  existence, and only calls `writeFile` when `resolveSchemaWriteOutcome(...).shouldWrite` is true.
  The decision and the act are kept as two separate steps so P11.09's atomic-write helper can later
  replace the raw `writeFile` call without touching this guard.
- **`formatWriteSummary`'s `schemaPath?: string` param became `schema?: SchemaWriteOutcome`** (one
  new exported union type, `SchemaWriteOutcome`). The single `if (schemaPath !== undefined)` block
  became a call to a small `formatSchemaWriteLine` helper with a `switch` over `schema.kind`,
  mirroring `formatExistingConfigLine`'s existing exhaustiveness-check style
  (`const exhaustiveCheck: never = ...` default case) for the same shape of closed union already
  used elsewhere in this file. This is the only signature change to an exported function;
  `tsc -b` found exactly one production call site (this same file) to update, as expected.
- **Reachability gap, recorded honestly (mirroring `02-sec003-path-escape.md`'s own residuals
  section):** a real CLI invocation can never exercise "explicit overwrite + a schema write is
  attempted" together. `result.projectSchema` (core's `generateInitConfig`) is only populated when
  the final `rules[]` contains a `rule: "custom"` entry, `rule-inference.ts` never emits one, so the
  only source of a custom rule is one preserved from an existing config — which only happens when
  `existingConfigAction === "merge"` (`config-writer.ts`'s `existingRules` is always `[]` for a
  `"fresh"` action). `existingConfigAction === "overwrite"` always maps to `action === "fresh"`
  (by design — `overwrite` fully discards the old `rules[]`, custom entries included; that is
  `overwrite`'s existing, correct, out-of-scope-to-change semantics, not a bug this task touches).
  So a schema write is only ever attempted under `"merge"`, matching the audit's own repro. The
  `"overwrite"` kind (and the equal-bytes short-circuit ahead of it) is proven correct only through
  `resolveSchemaWriteOutcome` and `formatWriteSummary` unit tests, not an end-to-end CLI regression
  test — there is no CLI input today that could exercise that combination. Kept for policy parity
  (a defensive branch, not a user-facing escape hatch — see the review fix below for why the first
  draft's own wording contradicted this).
- **Review fix — the `"kept"` message advertised a regeneration route that cannot work.** The first
  draft told the user to "run again with `--on-existing overwrite`" to replace a kept
  `schema.json`. That is false: per the reachability gap above, `--on-existing overwrite` always
  maps to `action === "fresh"`, which discards the config's custom rules entirely, so
  `result.projectSchema` is `undefined` and no schema write is ever attempted — following the old
  advice would lose the config's custom rules and still leave `schema.json` untouched. The message
  now tells the user the route that actually works: remove or rename the file and re-run `init`
  with `--on-existing merge` (the only action that ever populates `projectSchema`). The same false
  claim had been copied into `README.md`, `docs/guide/cli.md`, and `docs/mdlint_v2/glossary.md`
  (each gained the identical "replaced only under an explicit `--on-existing overwrite`" clause);
  all three now state the working remediation instead. The `"kept"` message also now says the
  config's `$schema` still points at the kept file even though its contents differ, so the config
  may not validate until the two are brought back in sync — a gap the first draft's wording left
  implicit even though `formatWriteSummary`'s own "merge preserves an existing schema.json"
  regression test constructs exactly that scenario (a hand-written `schema.json` while `$schema`
  points at it).
- **Review fix — an existence-only guard misreported an ordinary repeat run.** The first draft's
  `resolveSchemaWriteOutcome` only checked `schemaAlreadyExists: boolean`, so a second
  `init --on-existing merge` run after the first one had already written `schema.json` printed the
  same "kept" warning even when the file was byte-identical to what `init` would generate again —
  and gave no way to tell a truly stale schema (rules changed since it was generated) apart from a
  freshly-written one. `resolveSchemaWriteOutcome` now byte-compares the existing file against
  `result.projectSchema.text` before deciding: identical bytes report the new `"unchanged"` kind
  (no write, no warning — there is nothing to preserve), and the `"kept"` warning is reserved for a
  real divergence. This also means the `"overwrite"` bypass only ever applies when the bytes
  actually differ; if they already match, the outcome is `"unchanged"` regardless of
  `existingConfigAction`, since forcing an identical write would be a no-op it makes no sense to
  frame as an "overwrite".
- **Tests** (`packages/cli/test/init.e2e.test.ts`): `describe("resolveSchemaWriteOutcome", ...)`
  now covers `existingSchemaText`/`generatedSchemaText`/`existingConfigAction` combinations for all
  four kinds, including the equal-bytes case under both a keeping action and `"overwrite"` (proving
  the byte-match check runs before the action check); `formatWriteSummary` gained `"kept"` (now
  also asserting the `$schema`-still-points-at-it sentence and the `--on-existing merge`
  remediation, and asserting the old `--on-existing overwrite` advice string is gone),
  `"unchanged"`, and `"overwritten"` cases, plus the existing "mentions the project-local schema
  and CI workflow" case updated for the new `schema` param shape; the e2e suite has the existing
  "merge preserves an existing schema.json byte-for-byte and reports it in the summary" regression
  (a hand-written, differing `schema.json` survives a merge run byte-for-byte) plus a new "a second
  merge run reports the schema as already up to date, not falsely 'kept'" regression that runs
  `init --yes --on-existing merge` twice in a row and asserts the second run reports "already up to
  date" (not "Kept existing schema.json") with the file still byte-identical to what the first run
  wrote.
- **No core changes.** `generateConfigSchema`, `generateInitConfig`'s schema-content generation, and
  the `schema` command's default `--out schema.json` target are all unchanged — this task only
  guards the CLI-host write.
- **Docs updated alongside the fix**, per `AGENTS.md`'s hygiene rule: `docs/guide/cli.md`
  (`## init`), `README.md` (`init` paragraph), and `docs/mdlint_v2/glossary.md` (`init` bullet)
  each state that `init` never replaces an existing `schema.json` — the write summary reports
  whether it already matches or differs — and that a differing file is only regenerated by removing
  or renaming it and re-running `init` with `--on-existing merge` (the review-fixed wording above,
  not the first draft's `--on-existing overwrite` claim). The wording is deliberately
  unconditional rather than "preserved by default": "by default" would send the reader hunting for
  a non-default policy that, per the reachability gap above, cannot exist. The `README.md` and
  `docs/guide/cli.md` sentences also name _why_ the guard is there (`schema.json` is a common
  filename and is the `schema` command's own default `--out`), since the guarded behavior on its
  own reads like an arbitrary restriction. No new glossary entry — this updates what an
  already-documented behavior does, not a new term.
