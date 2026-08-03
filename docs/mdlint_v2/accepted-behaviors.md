# Accepted behaviors register

> Roadmap: [v2 Index](index.md) · Reference (not a precedence tier) · Established by [P12.06](P12-consistency/06-process-boundary-tests.md), deliverable 4.

The P11 remediation round fixed most of what the [post-P9 audit](audit-2026-07-25-post-p9.md) found, but some behaviors were deliberately **documented rather than changed**, and a few residuals were **recorded rather than closed**. Scattered across fifteen task files, those decisions are latent: a future reader hits the behavior, cannot tell whether it is intentional, and either "fixes" a deliberate tradeoff or files it again as a new finding.

This register is the one place they are stated. It is an **index, not a restatement**: each row points at where the behavior is already explained. Duplicating the explanation here would create a second copy to disagree with the first, so a row is a pointer plus the one-line reason it exists.

## How to use it

- **Adding a row.** When a task decides to accept a behavior instead of fixing it, add the row in the same change — the same "document where it is introduced" discipline the [glossary](glossary.md) and code comments follow.
- **User-facing vs maintainer-facing.** A behavior a _user_ can hit must have a home in `README.md` or `docs/guide/` — the register links it, it does not substitute for it. A residual only a maintainer can act on may cite its task file alone.
- **Removing a row.** When a later task actually fixes the behavior, delete the row rather than marking it stale.

## Accepted behaviors

Deliberate tradeoffs. Each is stated for users where they can hit it.

| Behavior | Why accepted | Stated for users in | Decided in |
| --- | --- | --- | --- |
| `columnMatches` accepts the `g`/`y` regex flags while they carry no meaning (each cell is a membership test, and match position is discarded between cells) | Keeps one uniform `flags` vocabulary across rules; rejecting them in the schema would have made a `"flags":"g"` config a validation error rather than a correct run | [TBL-004](../guide/rules/TBL-004.md), [custom rules](../guide/rules/custom.md) | [P11.05](P11-remediation/05-table-primitive-scope.md) |
| A target's own read-only mode no longer blocks a write: `--fix` rewrites a `0444` document and `init --on-existing overwrite` replaces a read-only config on Linux/macOS | Follows from replacing files by `rename()` (which needs directory, not target, permission). An `access(target, W_OK)` pre-check would be a TOCTOU race and would not hold on Windows; file mode was never the way to opt a document out of `--fix` — `exclude` is | [Output & exit codes](../guide/output.md) | [P11.09](P11-remediation/09-atomic-writes.md) |
| `wastech-mdlint ./docs` is `error: unknown command './docs'`, not a lint of `./docs` | An operand cannot be both a path and a misspelled command name. Only "no subcommand at all" was ever promised to lint the cwd, and every documented invocation names its subcommand | [CLI reference](../guide/cli.md) | [P11.10](P11-remediation/10-cli-exit-contract.md) |
| An `init` write that fails after the schema was committed leaves a `schema.json` behind (commit order is schema-first, config-last) | The config points at the schema, so schema-first keeps the old config and its still-accurate `$schema` valid if the schema rename fails. The reverse asymmetry is inherent without a journal, so it is reported in the partial-write summary rather than prevented | [Output & exit codes](../guide/output.md) (partial `init` summary) | [P11.09](P11-remediation/09-atomic-writes.md), [P11.14](P11-remediation/14-init-cli-lows.md) |
| `init` writes depth-agnostic `**/<name>/**` noise globs, so hand-written docs under a nested directory literally named `build`/`out`/`vendor`/… are pruned too | Root-anchored globs would have left a monorepo's `packages/*/dist` in the corpus — the exact thing the list prevents. `init` could never have proposed such files anyway, and the written config is an editable starting point | [CLI reference](../guide/cli.md) | [P11.08](P11-remediation/08-init-exclude-anchoring.md) |
| `STR-001` glob entries are satisfied only from the analyzed Markdown corpus, never expanded against the filesystem; and a glob cannot be pinned to the repository root | `Rule.check` is synchronous, so expanding globs would mean walking the tree from a sync call, and `include`/`exclude` already define what a run considers. Changing glob anchoring would silently break every existing entry rather than the narrow literal case | [STR-001](../guide/rules/STR-001.md) | [P11.12](P11-remediation/12-str001-reach.md) |
| Path containment is **lexical only**: a symlink that lives inside the analyzed root but points outside it is still probed | Resolving every candidate would add a syscall per reference on the hot path; the boundary check exists to stop the option being used as a host file-existence oracle, which lexical rejection already does | [STR-001](../guide/rules/STR-001.md) | [P11.02](P11-remediation/02-sec003-path-escape.md), [P11.12](P11-remediation/12-str001-reach.md) |
| Cycle detection is recursive, so one densely connected component of many thousands of documents can exhaust the call stack | Documented bound rather than a rewrite to an iterative traversal: many small components are fine at any corpus size, and no real corpus has reached it | [README limitations](../../README.md#limitations), [context graph limitations](../guide/context-graph.md#limitations) | [P12.05](P12-consistency/05-recursion-depth.md) |

## Recorded residuals

Known, narrow, and not fixed. These are maintainer-facing: no user action closes them, so they cite their task file rather than a guide page. Listed so a later sweep re-finds them as _known_ rather than filing them again.

| Residual | Why not fixed | Recorded in |
| --- | --- | --- |
| A `STR-001` literal whose filename is itself glob syntax (`LICENSE(1)`, `docs[x]/a.md`) is classified as a glob and routed to the corpus branch, so a non-Markdown file at that path still reports missing | Unchanged pre-existing behavior (every entry took the corpus branch before P11.12), needs a filename that is glob syntax, and the fix would be an escaping vocabulary the option does not have | [P11.12](P11-remediation/12-str001-reach.md) |
| `candidateEscapesRoot` does not repeat `resolvesOutsideRoot`'s resolve-and-compare step, so a candidate normalizing to a bare drive-relative remainder (`c:secret.md`) on a different drive than the root is not caught at the three `existsSync` call sites | Reaching it needs an attacker-authored document, a Windows host, and a `..`-cancellation leaving a bare drive letter with no root separator — materially narrower gain than the fix that shipped. `SEC-003`'s `template` is fully covered | [P11.02](P11-remediation/02-sec003-path-escape.md) |
| A gitignored workspace package is still detected by `init` and still produces a (empty) scan scope; the gitignore layers are threaded only through the Markdown walk, not through workspace-package detection | The asymmetry is invisible in the draft — an empty scope proposes nothing — and workspace detection reads `package.json` files, which `.gitignore` rarely speaks about deliberately | [P11.14](P11-remediation/14-init-cli-lows.md) |
| The `init` draft a user confirms does not name the project-local `schema.json` the `npx` path writes; only the after-the-fact write summary does | A gap against the warn-before-confirming discipline, explicitly **deferred** rather than accepted — the one row here a future task should close rather than keep | [P11.14](P11-remediation/14-init-cli-lows.md) |
| The `--no-install` flag on the `npx` smoke check in `packages/cli/test/bin.e2e.test.ts` is load-bearing nowhere: it is an npx-v6 spelling the pinned npm parses as an unknown config. The check's `cwd` is the whole no-network guarantee | Harmless where it sits, and removing it is a test-hygiene cleanup rather than a behavior fix | [P11.01](P11-remediation/01-cli-bin-noop.md) |

## See also

- [Glossary](glossary.md) — the canonical vocabulary, including **Accepted-behaviors register** and **Process-boundary guard**.
- [Process-boundary guards](../../.agents/rules/testing.md) — the paired checklist of guards the product must keep, enforced by `packages/core/test/boundary-guards.test.ts`.
- [Post-P9 audit](audit-2026-07-25-post-p9.md) — the findings these decisions answer.
