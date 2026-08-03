# P10.02 · Refresh glossary phase-status markers (P6–P8 shipped)

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Audit finding **M-8** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Bring the glossary's shipped/planned markers in line with reality — the glossary is an explicit invariant with a maintenance rule requiring exactly this.

## Problem (from the audit)

The glossary still marks P6–P9 as not started while P6/P7/P8 have shipped:

- `glossary.md:25-27,632-635` — "P0–P5 shipped; P6–P9 not started" / "P0–P5 Done; P6–P9 Not started".
- `:81-82` — mcp-server "A stub today; its six read-only tools land in P7 _(planned, P7)_".
- `:420` — "## Init & repo scan _(planned, P6)_".
- `:592-594` — static skills "_(planned, P8)_".

Reality: the 6 MCP tools are registered (`mcp-server/src/tools/index.ts`), init/scan exists (`core/src/discovery/*`), and the three skills exist (`skills/*/SKILL.md`); git log shows P6.01/P7.01/P8.05 landed. An agent trusting the glossary would treat live surfaces as nonexistent.

## Deliverables / steps

1. Update the roll-up status lines to "P0–P8 shipped; P9/P10 remediation + P-release pending" (reflecting the new phase structure).
2. Flip the per-entry `_(planned, P6/P7/P8)_` markers on mcp-server, init/repo-scan, and static skills to shipped.
3. While here, confirm no other glossary entry lags the shipped surface (spot-check compile, graph, custom-rule targets — the last is coupled to [P9.05](../P9-remediation/05-custom-heading-target.md)).

## Exit criteria

- [x] Glossary status markers show P6/P7/P8 as shipped.
- [x] No glossary entry describes a shipped surface as planned.

## Implementation notes

Updated `glossary.md`:

- The roll-up lines (banner "Shipped vs planned" bullet and the Planning taxonomy's `Phase (P0–P9)` / `Milestone (M1–M4)` entries) now read "P0–P8 shipped; P9/P10 (post-audit remediation + consistency) and P-release pending", matching the phase structure in `index.md` §6.
- Flipped the three flagged per-entry markers to shipped: `@wastech-mdlint/mcp-server`'s "A stub today ... _(planned, P7)_" became "shipped in P7"; the `## Init & repo scan _(planned, P6)_` header dropped its marker (the section body already said "Shipped:"); `Static skills` dropped `_(planned, P8)_` in favor of "shipped in P8".
- Spot-checked **Compile & generated skill** and **Context graph & queries** — already clean, no stale markers. Spot-checked the custom-rule **Target** entry coupled to P9.05 — it already documents the resolved five-value enum (no `heading`) with no planned marker, so no change needed there.
- While here, also fixed stale `_(planned, P9)_` / bare `P9` references that predate the P9-remediation/P10-consistency/P-release split, where "P9" used to mean "Release": the `Single-tag release` entry, the `## Distribution & release` header, and the `CHANGELOG` / `release:check` entries now say `P-release` instead of the old `P9`, so `P9` in the glossary consistently means "post-audit remediation" everywhere. This sweep also caught the config-writer note that credited P9.03 (actually the cross-OS CI matrix) with the P-release composite Action (decision I6) — retargeted to `P-release`.
- Exit criterion 2 required more than the flagged headers: the **MCP server** entries described the already-shipped six-tool surface and error contract in future tense ("`compile-context` ships in P7.04", "The type ships in P7.01"), which reads as not-yet-available now that P7 is Done. Converted those phase-mapping clauses to past tense so no shipped surface reads as planned.
- The Planning-taxonomy status line said P9 is "Not started", but P9 remediation is in progress on this branch. Marked P9 **in progress** and reserved "pending" for P10/P-release so the banner bullet and the taxonomy state the same thing.
