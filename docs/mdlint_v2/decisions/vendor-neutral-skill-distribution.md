# Vendor-neutral skill distribution

> **Status:** Accepted · Part of the [v2 roadmap](../index.md).

## Context

Agent Skills can be distributed several ways:

- a **Claude-Code-specific plugin marketplace** — works with Claude Code but not Cursor,
  Codex, Gemini CLI, or the other agentskills.io-compatible clients;
- a **personal marketplace** under the maintainer's repo — couples the skill lifecycle to a
  personal repo;
- the **agentskills.io standard** — a vendor-neutral open standard adopted by Claude Code,
  Cursor, Codex, Gemini CLI, GitHub Copilot, OpenCode, OpenHands, and dozens of others,
  installable via `gh skill install <owner>/<repo> <skill>` (GitHub CLI v2.90+).

## Decision

Ship Agent Skills under `skills/<skill-name>/SKILL.md` in the `wastech-ctxlint` repo,
following the agentskills.io specification.

- The repo itself is the distribution channel — no separate marketplace repo.
- Users install with `gh skill install VladimirMakarevich/wastech-ctxlint <skill> [--pin vX.Y.Z]`.
- Skills coordinate releases with the npm packages: a single `vX.Y.Z` git tag drives both.
- Avoid Claude-Code-specific syntax inside `SKILL.md` (e.g. dynamic command injection) so
  skills stay portable across all agentskills.io clients.

## Consequences

- **+** Skills work in 35+ AI agent clients out of the box.
- **+** Discoverable via `gh skill search`.
- **+** Same release cadence as the core packages — no separate skill-only releases.
- **−** Lose Claude-Code-specific niceties; mitigated by writing host-neutral instructions.
- **−** No central skill registry — discovery relies on GitHub search and external mentions.
