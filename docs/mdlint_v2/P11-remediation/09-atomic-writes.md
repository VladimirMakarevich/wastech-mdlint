# P11.09 · Atomic, newline-safe writes for `init` and `--fix`

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Findings **M-5** (`init` non-atomic) and **L-6** (`--fix` non-atomic /
> newline), [post-P9 audit](../audit-2026-07-25-post-p9.md). Depends on
> [P11.03](03-init-schema-clobber.md) (shares the guarded write path).

## Goal

A write that fails partway through must not leave a truncated config, a half-written schema, or a
Markdown file with mixed line endings. All product file writes go through one atomic,
newline-preserving helper.

## Problem (from the audit)

**M-5 — `init` writes are non-atomic.** `init-command.ts:783-789` writes config first, then schema —
no temp+rename, no rollback, no ordering that guarantees consistency. Reproduced (`schema.json`
read-only): `exit=1`, **stdout empty** (no write summary at all), stderr `EACCES … schema.json`, and
the config on disk is **already rewritten** with a `$schema` now pointing at the stale user file.
Because `writeFile` is truncate-and-write, a crash or `ENOSPC` mid-write also truncates the user's
existing config with no recovery path.

**L-6 — `--fix` writes non-atomically and LF-only.** `engine/fix.ts:90` is a bare `writeFile` on the
document (a mid-write crash corrupts the user's Markdown), and `rules/sec.ts:54` inserts
`\n## …\n\nTODO\n`, so on a CRLF tree the result is mixed line endings.

## Deliverables / steps

1. Add one shared write helper in `packages/core` — write to a temp file in the same directory, then
   `rename` into place (atomic on a single filesystem). Route the `init` config + schema writes and
   the `--fix` document write through it.
2. Preserve each document's detected newline style on `--fix` (do not force LF into a CRLF file); the
   inserted content in `rules/sec.ts:54` must adopt the document's newline.
3. On partial failure, report what was and was not written (a write summary even on the error path) so
   the user is never left guessing — coordinate with the [P11.03](03-init-schema-clobber.md) summary
   and the [P11.10](10-cli-exit-contract.md) exit-code contract (operational failure exits `2`).
4. Tests: a read-only `schema.json` leaves the existing config byte-unchanged and prints a summary; a
   `--fix` on a CRLF fixture keeps CRLF throughout.

## Out of scope

Cross-filesystem atomicity (temp-dir on a different mount) beyond a documented best-effort fallback.
Redesigning the `--fix` engine or `SEC-003`'s fix content — only its newline handling changes.

## Exit criteria

- [ ] `init` and `--fix` writes are temp-file + rename; a mid-write failure never truncates an existing file.
- [ ] `--fix` preserves the document's newline style (CRLF stays CRLF).
- [ ] A partial-failure write reports what succeeded and what did not.
- [ ] Regression tests cover the read-only-`schema.json` and the CRLF-`--fix` cases.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
