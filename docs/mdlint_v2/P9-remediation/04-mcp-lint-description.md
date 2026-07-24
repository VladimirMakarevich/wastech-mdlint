# P9.04 · Make the MCP `lint` tool description honest

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** ·
> Status **Done**. Audit finding **M-3** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Every shipped MCP tool description must match its real behavior (requirement **M2**, the locked
requirement most concerned with tool copy matching reality).

## Problem (from the audit)

`packages/mcp-server/src/tools/lint.ts:177` describes the tool as *"Reads no filesystem or
config."* But `lint.ts:141` sets `rootDir: process.cwd()`, and REF-001/REF-003 resolve relative
link/image targets via `existsSync(path.resolve(rootDir, relPath))`
(`packages/core/src/engine/primitives/reference.ts:23,109`). So linting content with a REF rule
and a relative link makes the tool `stat` paths under the server's cwd — contradicting the
description.

## Deliverables / steps

1. Rewrite the `lint` description to be accurate, e.g. *"Does not read config; for reference
   rules (REF-001/003) it may probe whether relative link/image targets exist, relative to the
   server's working directory."*
2. Re-check the other five tool descriptions against actual behavior while here (cheap, prevents
   the same class of drift).
3. If a stdio-integration or tool-docs test snapshots descriptions, update it; the description is
   surfaced via `listTools`, which the skills-surface test parses.

## Exit criteria

- [x] `lint` description accurately reflects its filesystem access.
- [x] All six tool descriptions verified against behavior.
- [x] `npm test` green.

## Implementation notes

- The shipped `lint` description now states that it does not load project config, while file-resolving
  rules such as REF-001/REF-003 and SEC-003 may probe or read paths relative to the server's working
  directory.
- The other five registered descriptions were re-checked against their handlers: `lint-files` uses
  resolved config or the zero-config fallback, graph/slice/impact are read-only core projections, and
  `compile-context` returns the documented two text blocks without structured output.
- The README generated MCP row and MCP guide copy were aligned, and `smoke.test.ts` now pins the
  honest `lint` description through the live `listTools` surface.
