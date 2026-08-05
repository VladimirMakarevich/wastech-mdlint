# P14.04 · `--config` resolves against two different bases

> Phase: [P14 — Host boundary](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** · Status **Not started**. Backlog: [W-16](../remediation-backlog-2026-08-05.md) (Medium). Sources: audit F10 (MEDIUM, reproduced). Depends on [P13.06](../P13-correctness/06-config-diagnostics.md).

## Goal

Make `--config` mean one thing across all six handlers that accept it, or state the divergence in the two places the repository's own rules say a deferral must live.

## Problem

`loadConfiguration` resolves an explicit config path against the **process** working directory, ignoring its own `cwd` parameter ([`packages/core/src/config/load-config.ts`](../../../packages/core/src/config/load-config.ts) around `:182`, `path.resolve(params.explicitConfigPath)` with no `params.cwd`). Four CLI handlers inherit that — `lint`, `graph`, `slice`, `impact` — while `compile` and the MCP context helper work around it locally. The hazard is written down at [`packages/cli/src/commands.ts`](../../../packages/cli/src/commands.ts) `:422`: "`loadConfiguration` resolves `explicitConfigPath` against `process.cwd()`, which silently diverges from `command.cwd` when the two differ."

**User-visible, reproduced:** from a directory containing `proj/cfg.json`, `lint proj --config cfg.json` prints `Config file not found: ../cfg.json` — a path the user never typed, rendered relative to the lint root while resolved against the shell. `compile --cwd proj --config cfg.json` finds the same file.

**The deferral is recorded in the wrong place.** It currently lives only in a task file (`P11-remediation/10-cli-exit-contract.md:47`), which violates the repository's own same-change register rule: a behavior accepted rather than fixed belongs in [`accepted-behaviors.md`](../accepted-behaviors.md) with a user-facing home, not in the prose of a task nobody re-reads.

## Deliverables / steps

1. **Decide the direction.**
   - **(A) Honor the caller's `cwd`** in `loadConfiguration` for all six call sites, and delete the two local workarounds. This is the behavior the guide implies and the one that removes a divergence rather than documenting it.
   - **(B) Keep process-cwd resolution**, add the register row, and state the base at `docs/guide/cli.md:43` where `--config` is documented.
2. **If (A), the diagnostic path matters as much as the resolution.** The reproduced symptom is two bugs compounding: the path resolved against one base and _rendered_ relative to another. Fixing resolution without fixing rendering leaves a correct lookup reported against the wrong base. [P13.06](../P13-correctness/06-config-diagnostics.md) settles the notation question for config diagnostics; keep this consistent with whatever it chose.
3. **If (A), check the MCP helper explicitly.** The workaround there is one of the four `cwd` sites [P14.01](01-mcp-cwd-validation.md) touches; land these two in an order that does not leave the resolver half-refactored.
4. **Either way, remove the task-file-only deferral.** If (A), it is obsolete and should be marked so. If (B), it moves to the register.
5. **Test the six handlers together**, not one: the finding is an inconsistency across call sites, so a test that pins only `lint` would pass with the divergence intact. A table-driven test over the six is the shape that catches a seventh handler added later.

## Out of scope

`[path]` / `--cwd` resolution itself — that contract is settled and correct (both are resolved against the CLI's own cwd and must be existing directories). This task is only about `--config`'s base.

## Exit criteria

- [ ] All six `--config` call sites agree on one resolution base, asserted by a test that covers all six — **or** the divergence has a row in [`accepted-behaviors.md`](../accepted-behaviors.md) and a statement at `docs/guide/cli.md:43`.
- [ ] The reproduced case (`lint proj --config cfg.json` from the parent directory) either finds the file or reports a path the user typed.
- [ ] The diagnostic renders the path against the same base it was resolved against.
- [ ] The deferral no longer lives only in `P11-remediation/10-cli-exit-contract.md`.
- [ ] Gates green.
