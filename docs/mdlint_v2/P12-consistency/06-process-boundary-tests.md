# P12.06 · Process-boundary test guards + format-gate publish process

> Phase: [P12 — Post-P9 consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Done**. Sources: post-P9 audit [§4](../audit-2026-07-25-post-p9.md) (systemic cause) and [§1](../audit-2026-07-25-post-p9.md) (red format gate). Depends on [P11.01](../P11-remediation/01-cli-bin-noop.md).

## Goal

Turn the audit's systemic cause — **no tests at the process boundary** — into a standing checklist and a few generalizing guards, and close the process gap that let a red format gate ship in an audit deliverable. This is the "prevent the class" task for the whole post-P9 audit.

## Problem (from the audit)

The audit's [§4](../audit-2026-07-25-post-p9.md) names one root cause behind the missed HIGH findings: nothing tested the process boundary. `src/index.ts` had 0% coverage (H-1); the shared `exclude` option had zero e2e coverage (L-4); no `init` test exercised a write failure (M-5); nothing spawned the binary. Separately, [§1](../audit-2026-07-25-post-p9.md) found `npm run format` **red on the branch** — and half the offending files were added by the `p9-09` audit deliverable itself (`242a518`) and by the P10.04/P10.05 commits — because none of those three runs executed the format gate that P9.06 had specifically added to CI. (On `main` today the gate is green, so this is a **process** fix, not a byte fix.)

## Deliverables / steps

1. **Boundary-test checklist.** Add a short, durable checklist (in the testing rules or the P-release verification) enumerating the process-boundary guards the product must keep: spawn the installed bin (from [P11.01](../P11-remediation/01-cli-bin-noop.md)); an `init` write-failure test (from [P11.09](../P11-remediation/09-atomic-writes.md)); `exclude` e2e (from [P12.01](01-exclude-coverage.md)); a determinism/regex-state guard (from [P11.05](../P11-remediation/05-table-primitive-scope.md)). The point is that these are named categories, so a future subsystem without one is visibly missing it.
2. **Generalize the bin-spawn guard.** Ensure the P11.01 spawn test covers the surfaces most likely to silently no-op — `--version`, a `lint` with a known finding count, and a nonzero-exit path — on all three CI hosts.
3. **Format-gate publish process.** Make `npm run format` (or `prettier --check`) run before any docs deliverable is committed — e.g. document it in the repo-hygiene/testing rules and confirm CI's format job covers `docs/**` and `tasks/**` so a red gate cannot merge. Verify `.gitattributes` keeps the check stable cross-platform (per the P9.06 note).
4. **Accepted behaviors.** Record any behavior P11 chose to _document rather than fix_ (e.g. a corpus-only `STR-001` if [P11.12](../P11-remediation/12-str001-reach.md) took direction B; the `SIZE-001` override interaction if [P11.13](../P11-remediation/13-grp-size-hygiene.md) documented it) in one "accepted behaviors" note, so they are stated, not latent.

## Out of scope

Writing the individual P11/P12 fixes' tests — those ship with their tasks. This task assembles them into a named boundary checklist and closes the publish-process gap; it does not duplicate the tests.

## Exit criteria

- [x] A durable "tests at the process boundary" checklist exists (bin spawn, write-failure, exclude, determinism).
- [x] The bin-spawn guard covers `--version`, a known-count `lint`, and a nonzero-exit path on all three hosts.
- [x] The format gate runs before docs deliverables merge; CI covers `docs/`. The `tasks/` half of this criterion is **deliberately not gated** — see the deviation below.
- [x] Behaviors P11 accepted-rather-than-fixed are recorded in one place.
- [x] `npm run typecheck && npm test && npm run format` green.

## Implementation notes

### The `tasks/` deviation (exit criterion 3, amended)

The criterion asked CI's format job to cover `tasks/**`. It should not, for three reasons, all verified rather than assumed:

1. **It is already outside the gate, structurally.** Prettier's default `--ignore-path` is _both_ `.gitignore` and `.prettierignore` (`prettier --help ignore-path` prints the default list), and `tasks/` is gitignored (`.gitignore`, "orchestrator task files"). So `prettier --check .` never sees it. Confirmed by diffing `npx prettier --list-different .` (clean) against the same command with `--ignore-path .prettierignore` (which reveals ~40 unformatted files under `tasks/done/`).
2. **Gating it would be red on arrival**, since those operator-authored task and summary files were never Prettier-formatted.
3. **It would be unfixable by the agent that hit it.** Agents are forbidden from modifying anything under `tasks/`, so a red gate on an operator-authored task file could not be remedied by the run that tripped it — the worst shape a gate can take.

Recorded alternative, **not** applied: if `tasks/**` should be gated anyway, the change is `"format": "prettier --check . --ignore-path .prettierignore"` in the root `package.json`, **plus** adding `.worc-io/` to `.prettierignore` (it is currently excluded only because it is gitignored), **plus** a one-time `prettier --write tasks/`. The two-ignore-file model is now commented at the top of `.prettierignore` so the next reader does not have to re-derive it.

Also unverifiable from inside the tree: "a red gate **cannot merge**" depends on GitHub branch protection requiring the `verify` check. The workflow runs on every push and PR (`.github/workflows/ci.yml`), but whether it is a _required_ check is repository settings, not a file. Stated rather than claimed.

### Deliverable 2 was already satisfied — for the CLI

`packages/cli/test/bin.e2e.test.ts` (P11.01) already covered every surface the deliverable names: `--version` through a symlink/junction exiting 0, a `lint` pinning the exact summary line `1 problem (1 error, 0 warnings)`, a typo'd subcommand exiting `EXIT_CODE_USAGE_ERROR`, a top-level rejection exiting 2 rather than 1, and an import-does-not-execute check — on all three hosts, since `ci.yml`'s `verify` job matrixes ubuntu/windows/macos.

So the generalization landed where the same class of hole was actually still open: **`packages/mcp-server`**. Its `src/index.ts` received the identical `realOrSelf` fix for H-1, but nothing spawned it through a link — `stdio-integration.test.ts` spawns `dist/index.js` by its _real_ path, which passes with the defect present — and P11.01 explicitly deferred an mcp-server spawn test ("No new mcp-server spawn test"). New `packages/mcp-server/test/bin-entrypoint.test.ts` closes it.

Proven the same way P11.01 proved its own guard: reverting `realOrSelf` in `packages/mcp-server/src/index.ts` and rebuilding makes **only** the new guard fail — the eight `stdio-integration.test.ts` tests still pass — and it fails by _rejecting_ in ~0.5s (`McpError: Connection closed`, because the child starts no transport and exits 0), not by hanging. The explicit `30_000` timeout bounds it anyway, since a CI-only stall is the failure shape worth guarding against.

### The `custom` exclude guard never ran

P12.01 recorded a follow-up: the `satisfies Record<Assertion["kind"], …>` coverage guard in `packages/core/test/rules-custom.test.ts` claimed a 14th assert kind would fail `npm run typecheck`. It would not: **no tsconfig in this repo includes the test trees at all** (each package declares `include: ["src/**/*.ts", …]`, matching its emit contract), so `tsc -b` never reads a test file. The stale claim is replaced with the truth, and the enforcement is now a runtime assertion comparing `Object.keys(CUSTOM_SCOPE_CASES)` against `Object.keys(ASSERTION_TARGETS)`, both sorted. Verified by adding a 14th key to `ASSERTION_TARGETS` locally: the new test goes red.

One deviation from the reviewed plan: it also proposed dropping the `as const` on the grounds that the `satisfies` was not "genuinely true". Checked directly — compiling that file with `tsc --noEmit` reports no error, because the `satisfies` target contextually types the object's array literals. The `as const` is harmless, so it stays; the load-bearing defect was reachability, not validity.

### Guards are tagged, and the tags are enforced

Each guard now carries an `@boundary-guard <category>` comment, and `packages/core/test/boundary-guards.test.ts` asserts every category still has its tagged guard — tag-based rather than describe-name-based, so renaming a test is free while deleting a guard fails. That inventory is the enforcement half of the prose checklist in `.agents/rules/testing.md`; a prose checklist alone rots into claiming coverage the tree no longer has, which is the audit's systemic cause a second time.

The enforcement is deliberately partial, and the testing rules say so rather than implying more. The inventory pins the four category names and the guard files it lists; it does **not** parse the table in `.agents/rules/testing.md`. So deleting a guard, dropping a tag, or growing the inventory fails the suite, while adding a row to the table alone does not. Parsing the table's category column and its `Current guard(s)` code spans would close that last direction, and is the recorded option if the table is ever observed drifting — not taken now, because a doc-parsing test couples the test suite to Markdown table formatting, and the failure it would catch (a row added for a guard nobody wrote) is the one a reviewer sees in the same diff.

### AGENTS.md is now inside the gate

`.prettierignore` had exempted `AGENTS.md` with the note "missing a trailing newline only". Verified that was still the _only_ drift (`prettier` produced a one-byte diff), so the file got its newline while being edited for deliverable 3 and the exemption was deleted. A root instruction file sitting outside the format gate is precisely this task's class of process hole.

### Accepted behaviors

The task's two examples do not apply: P11.12 took direction **(A)** (fixed) and P11.13 **removed** the GRP options rather than documenting the interaction. But a sweep of the P11/P12 task files found thirteen other decisions recorded only in task-file prose, now indexed in [`accepted-behaviors.md`](../accepted-behaviors.md) — eight accepted behaviors (each with a `README.md` / `docs/guide/` home confirmed to exist and to state it) and five maintainer-facing residuals. The register **indexes**; it deliberately does not restate the guide prose, since a second copy is a second thing to disagree with the first.

> **Correction (P17.06).** One of those eight pointers did not survive scrutiny: the leftover-`schema.json` row cited `docs/guide/output.md` as a whole, and that page states the partial-`init` summary but never the schema-first commit order the row is about. [P17.06](../P17-plan-of-record/06-register-and-roadmap.md) repointed it at the `init` atomic-write bullets on `docs/guide/cli.md`, which do, so the claim above is true again. The lesson is in the failure mode rather than the row: a page-level pointer reads as confirmation without being one, so a register row cites the **section** that carries the sentence, and verifying a row means opening that section rather than checking the link resolves.
