# P9.03 · Add Windows/macOS to the CI matrix

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit finding **M-5** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Actually verify the cross-platform contract. `core`, `cli`, and `mcp-server` must behave
correctly on Windows, macOS, and Linux — an architecture invariant — but CI only runs on Linux.

## Problem (from the audit)

`.github/workflows/ci.yml:16,35` both `runs-on: ubuntu-latest`; the only matrix is per-package
`npm pack`. The Windows path-normalization code (`load-documents.ts:24` `toPosixAbsolute`) is
guarded only by `load-documents.test.ts:45` (`!key.includes("\\")`), which is trivially true on a
POSIX host where backslashes never appear. The P1 exit criterion "Windows paths normalized to
POSIX in keys" is therefore never exercised, so path/glob/newline regressions on Windows would
ship undetected.

## Deliverables / steps

1. Add an OS matrix to the `verify` job: at minimum `windows-latest`; ideally `macos-latest` too,
   on the pinned Node 24 line (`.node-version`).
2. Confirm the suite is green on Windows; fix any real path/newline/glob assumptions the run
   uncovers (the normalization code looks correct — this is about *verification*).
3. Keep the `pack` per-package matrix as-is (it stays Linux-only; publish shape is OS-independent).
4. Note cost/time: a 3-OS × per-package fan-out can get large — scope the OS matrix to the
   `verify` job, not `pack`.

## Exit criteria

- [ ] CI runs the full `typecheck`/`lint`/`test`/`build` gate on `windows-latest`.
- [ ] Path/newline behavior is confirmed on Windows (POSIX key normalization actually asserted there).
- [ ] `.github/workflows/ci.yml` documents why the OS matrix is scoped where it is.
