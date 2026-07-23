# P9.03 · Add Windows/macOS to the CI matrix

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Done**. Audit finding **M-5** ([report](../audit-2026-07-23-p0-p8.md)).

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

- [x] CI runs the full `typecheck`/`lint`/`test`/`build` gate on `windows-latest`.
- [x] Path/newline behavior is confirmed on Windows (POSIX key normalization actually asserted there).
- [x] `.github/workflows/ci.yml` documents why the OS matrix is scoped where it is.

## Implementation notes

- **Full 3-OS matrix, not just Windows.** The task allowed `windows-latest` alone, but the
  architecture invariant names all three hosts, so the `verify` job now fans out over
  `ubuntu-latest`, `windows-latest`, and `macos-latest`. Windows is the leg that actually
  exercises the code (native `\` separators), but macOS is cheap insurance against a
  BSD/darwin-specific path or newline assumption that neither Linux nor Windows would surface.
- **`fail-fast: false`.** A failure on one OS should not cancel the other legs — when a
  cross-platform bug appears we want to see which hosts are affected in a single run rather than
  re-triggering to learn whether the break is Windows-only.
- **Matrix scoped to `verify`, `pack` stays Linux-only.** The per-package `npm pack` job checks
  the published tarball shape, which is OS-independent; running it under a 3-OS × per-package
  fan-out would multiply cost for no additional signal. The scoping decision is documented inline
  in `ci.yml` so the asymmetry is intentional rather than looking like an oversight.
- **The normalization assertion was vacuous on POSIX, so the test was made non-vacuous on
  Windows.** The existing key-normalization check passes trivially on Linux/macOS because
  backslashes never appear. Rather than rewrite the assertion, the test now guards on
  `path.sep === "\\"` to assert the fixture root really contains native separators before
  `loadDocuments` returns POSIX keys — so the Windows leg proves the conversion happened instead
  of confirming a no-op. No production code changed; the code was already correct and this task
  is about verification.
