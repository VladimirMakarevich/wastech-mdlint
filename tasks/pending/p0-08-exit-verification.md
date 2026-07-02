---
id: p0-08-exit-verification
title: "P0.08 — Phase P0 exit verification & layout docs"
priority: mid
depends_on:
  - p0-07-ci-packaging
---

## Description

Prove phase P0 is complete and behavior-neutral, and document the new layout so P1+ contributors start from a clear map. Follow `docs/mdlint_v2/P0-foundations/08-exit-verification.md`.

## Acceptance criteria

- [ ] The full gate is green across the workspace: `npm run typecheck && npm test && npm run build`.
- [ ] Parity check: `wastech-mdlint scan` and `graph` produce output identical to the pre-migration implementation, on a fixture and on this repo.
- [ ] The `postinstall` is confirmed gone and install writes no config (I1).
- [ ] `README.md` gains a short "Workspace layout" section (packages, bins, how to build/test); the `docs/mdlint_v2/P0-foundations/index.md` exit checklist is ticked.

## Constraints

- Verification and docs only — do not add product features (P0 is structural).
- Updating `AGENTS.md` "Sources Of Truth" needs the owner's approval — propose it in the PR, do not force it.
