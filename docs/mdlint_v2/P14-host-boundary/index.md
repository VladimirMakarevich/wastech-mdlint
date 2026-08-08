# Phase P14 — Host boundary remediation (exit codes, validation, error contract)

> Roadmap: [v2 Index](../index.md) · Phase **P14** · Size **M** · Status **Done** · Depends on [P13](../P13-correctness/index.md) (corpus and rule correctness landed).
>
> **Goal:** close every defect where a **host** — the CLI or the MCP server — turns a real failure into an apparent success, or drops the actionable half of a diagnostic on its way to the surface a human or a model reads. Sourced from the [consolidated remediation backlog](../remediation-backlog-2026-08-05.md), batches **B6–B7**.

## Why this phase exists

The architecture invariant that CLI and MCP are thin adapters over core holds — the audit checked it invariant by invariant. What the invariant does not cover is **what each host is obliged to reject before calling core**, and that is where this phase lives. Core's terminating behavior for a root that does not stat as a directory is a silent empty map, pinned as intentional precisely so each host guards its own boundary. The CLI does, and names the defect class in its own rationale. The MCP server does not, on all five file-based tools.

The pattern repeats in the other direction too: `init` prints a correct, well-worded refusal and exits `0`; the MCP `lint` tool builds a complete `{code, message, hint}` payload and then renders text without the `hint`; a schema-level rejection returns raw transport text with no `structuredContent` at all. Each of these needs a spawned process or a comparison between two surfaces to see — which is exactly the class the [process-boundary guards](../../../.agents/rules/testing.md) exist for, and two of these tasks add one.

## Tasks

| # | Task | Backlog | Sev | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| [P14.01](01-mcp-cwd-validation.md) | A nonexistent `cwd` silently succeeds on five MCP tools | W-18 | High | M | P13 |
| [P14.02](02-cli-exit-codes.md) | CLI exit codes and out-of-repo path rendering | W-13, W-17 | High | S–M | P13 |
| [P14.03](03-init-disclosure.md) | `init` disclosure and the hidden-directory default | W-14, W-15 | High | M | P13.02 |
| [P14.04](04-config-resolution-base.md) | `--config` resolves against two different bases | W-16 | Medium | S–M | P13.06, P14.01 (if direction A) |
| [P14.05](05-mcp-error-contract.md) | MCP error-contract parity and the operational code | W-19, W-20, W-21 | Medium | M | P14.01 |

> **Backlog key.** `W-NN` are the work items in the [consolidated remediation backlog](../remediation-backlog-2026-08-05.md), which names each item's source finding IDs so the original evidence stays reachable.

## Sequence

```
(P13) ─► P14.01 (stat-and-reject at four MCP sites)
             ├─► P14.05 (error contract — shares the INVALID_INPUT path)
             └─► P14.04 (only if it takes direction A — same MCP resolver)
        P14.02  P14.03   (independent)
                                   └─► (P15)
```

> **P14.01 before P14.05**, because both land in the MCP error path and P14.01 introduces the `INVALID_INPUT` rejections whose text rendering P14.05 then has to get right. **P14.03 after [P13.02](../P13-correctness/02-default-exclude.md)**, since the question it answers — is a hidden-directory exclude the right _lint-time_ default — only has a stable answer once the lint-time defaults exist at all. **P14.04 after P14.01 if it takes direction (A):** honoring the caller's `cwd` deletes the MCP context helper's local workaround, and that helper is one of the four `cwd` sites P14.01 refactors — landing them in the wrong order leaves the shared resolver half-refactored. Under direction (B) (register the divergence) P14.04 touches no MCP code and is independent. P14.02 is independent of everything here.

## Decisions this phase must reach

Three tasks carry a genuine fork rather than a fix, and each terminates either in code or in [`accepted-behaviors.md`](../accepted-behaviors.md):

- **Is a lint-time hidden-directory exclude the right default?** ([P14.03](03-init-disclosure.md)) The scan's rationale is sound; whether that pruning decision should be written out as a permanent lint-time exclude is a different question, and in an agent-documented repository the dot-directories are the corpus that matters most.
- **Do schema-level rejections owe the `{code, message, hint}` contract?** ([P14.05](05-mcp-error-contract.md)) Pre-validate inside the handler, or document the exemption.
- **Should the closed error-code set gain an operational code?** ([P14.05](05-mcp-error-contract.md)) This one cannot be closed locally — it means amending a decision record that defines the set as closed.

## Phase exit criteria

- [x] All five file-based MCP tools reject a nonexistent `cwd` with `INVALID_INPUT` over real stdio (W-18).
- [x] `init --on-existing merge`'s refusal exits `2`, proven by a spawned process and tagged `@boundary-guard installed-bin-spawn` (W-13).
- [x] An out-of-repo `--outdir` prints something a user can read (W-17).
- [x] `init` names, in its summary, how many Markdown files its excludes dropped and why (W-14).
- [x] The lint-time hidden-directory exclude is either separated from the scan prune or recorded in [`accepted-behaviors.md`](../accepted-behaviors.md) with W-14's disclosure as its condition (W-15).
- [x] All six `--config` call sites agree on one resolution base, or the divergence is in the register **and** in the guide (W-16).
- [x] Every MCP error path that carries a `hint` includes it in the text block (W-19).
- [x] Schema-level rejections either carry `{code, message}` or the exemption is stated where the contract is documented (W-20).
- [x] The operational-error asymmetry between CLI and MCP is closed in the taxonomy or registered, with the caller-visible consequence stated (W-21).
- [x] Gates green.

## What P14 unblocks

- [P15](../P15-output-contracts/index.md). With the hosts rejecting what they should and disclosing what they know, the remaining boundary work is the **shape** of what they emit.
