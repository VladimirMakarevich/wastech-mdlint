# P10.02 · Refresh glossary phase-status markers (P6–P8 shipped)

> Phase: [P10 — Post-audit consistency](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Not started**. Audit finding **M-8** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Bring the glossary's shipped/planned markers in line with reality — the glossary is an explicit
invariant with a maintenance rule requiring exactly this.

## Problem (from the audit)

The glossary still marks P6–P9 as not started while P6/P7/P8 have shipped:

- `glossary.md:25-27,632-635` — "P0–P5 shipped; P6–P9 not started" / "P0–P5 Done; P6–P9 Not started".
- `:81-82` — mcp-server "A stub today; its six read-only tools land in P7 _(planned, P7)_".
- `:420` — "## Init & repo scan _(planned, P6)_".
- `:592-594` — static skills "_(planned, P8)_".

Reality: the 6 MCP tools are registered (`mcp-server/src/tools/index.ts`), init/scan exists
(`core/src/discovery/*`), and the three skills exist (`skills/*/SKILL.md`); git log shows
P6.01/P7.01/P8.05 landed. An agent trusting the glossary would treat live surfaces as
nonexistent.

## Deliverables / steps

1. Update the roll-up status lines to "P0–P8 shipped; P9/P10 remediation + P-release pending"
   (reflecting the new phase structure).
2. Flip the per-entry `_(planned, P6/P7/P8)_` markers on mcp-server, init/repo-scan, and static
   skills to shipped.
3. While here, confirm no other glossary entry lags the shipped surface (spot-check compile,
   graph, custom-rule targets — the last is coupled to [P9.05](../P9-remediation/05-custom-heading-target.md)).

## Exit criteria

- [ ] Glossary status markers show P6/P7/P8 as shipped.
- [ ] No glossary entry describes a shipped surface as planned.
