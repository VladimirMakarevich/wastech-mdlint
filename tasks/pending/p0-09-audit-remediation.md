---
id: p0-09-audit-remediation
title: "P0.09 — Phase P0 audit & remediation (requirements + codebase)"
priority: mid
nodes:
  planning:
    reasoning: xhigh # deep, thorough audit pass
  review:
    reasoning: xhigh # rigorous verification of the remediation
depends_on:
  - p0-08-exit-verification
---

## Description

Final, concluding task of phase P0. Audit the **entire** P0 implementation and codebase against the locked requirements and every P0 exit criterion, enumerate all gaps, omissions, and problems, and then fix or add what is missing — so the phase is genuinely complete, consistent, and behavior-neutral rather than merely "checkbox-ticked".

Audit against these sources of truth:

- `docs/mdlint_v2/requirements/` — the locked requirements (especially installation `06-installation.md` and configuration `01-configuration.md`).
- `docs/mdlint_v2/index.md` — decisions D1–D7 and installation items I1/I4/I5.
- Each `docs/mdlint_v2/P0-foundations/0N-*.md` task's exit criteria, plus the phase-level exit checklist in `P0-foundations/index.md`.
- `.agents/rules/` (architecture, coding-style, security, testing) and the cross-cutting concerns in roadmap §8 (determinism, repo-relative POSIX paths, the two-severity model, the testing layers).

Concretely, verify and remediate at least: all three packages (`core`, `cli`, `mcp-server`) exist with the correct names, bins, `exports`, `engines`, `files`, `publishConfig` and npm provenance; `core` re-exports the full public surface; `scan`/`graph` parity is byte-identical to the pre-migration implementation; the `mcp-server` stub builds and smokes over stdio; root workspace scripts fan out; the `tsconfig` project-reference graph is correct and `tsc -b` builds in order; the Zod v3→v4 migration is complete; the `postinstall` config-write is gone (I1); CI runs typecheck/test/build/lint + `npm pack --dry-run` across the workspace on Node 24; and there is no leftover legacy naming (`ctxlint`, `md-context-audit`) or stale root config.

## Acceptance criteria

- [ ] A written audit is produced (in the summary / PR body) enumerating every gap, omission, or problem found across P0, each mapped to the specific requirement or exit criterion it violates.
- [ ] Every in-scope gap is fixed or the missing piece added; anything that genuinely belongs to a later phase (P1+) is recorded as a follow-up instead of built.
- [ ] All P0 exit criteria — the phase index checklist and each P0.0N task's exit criteria — are genuinely met and re-verified.
- [ ] The full workspace gate is green: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; and `npm pack --dry-run` is clean per package.
- [ ] No leftover legacy: no `postinstall` config write (I1), no stale `ctxlint` / `md-context-audit` references, no Zod v3 usage remaining.
- [ ] `scan`/`graph` output parity with the pre-migration implementation is re-confirmed.

## Constraints

- Stay within P0 scope (workspace & foundations). Do NOT implement P1+ product features — `ParsedDocument`, the rule engine, graph `slice`/`impact`, `compile`, `init`, or the 6 MCP tools. If a gap belongs to a later phase, note it as a follow-up; do not build it here.
- Do not weaken, skip, or disable any check or test to make the gate green — fix the underlying cause.
- Follow `.agents/rules/` and the project's determinism and style invariants throughout.
