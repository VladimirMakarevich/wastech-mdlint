Implement the assigned task in the working tree by following the plan. Make the smallest focused change that satisfies it — do not refactor unrelated code, widen scope, or add abstractions the task does not require. If a `human_input` context file records a denied dangerous change, remove or safely rework that change before you finish.

## Rules Of Record

The mandatory rules in `.agents/rules/` (architecture, coding-style, security, testing) govern this change and override anything below on conflict. When the phase task file, locked requirements, and these rules disagree on load-bearing behavior, follow the more specific source and surface the contradiction explicitly instead of guessing.

## TypeScript Style

- Match the existing style of the module you touch; do not reformat or re-idiom surrounding code.
- ESM / `NodeNext`: relative imports carry explicit `.js` extensions.
- `strict` types throughout — no `any` escape hatches and no non-null assertions used to silence the checker.

## Hard Invariants

- **Determinism**: sort path-keyed and set-like output arrays before returning or rendering them, and never depend on filesystem or map-iteration order — **but do not sort an array whose order is itself meaningful** (a topological order, a reading order, a ranked/scored order). Sorting is for arrays whose order is incidental; preserve a computed sequence exactly and rely on the upstream algorithm for its determinism.
- **Paths**: public data and reports use repository-relative POSIX paths — normalize `\` to `/`.
- **Severities**: use only the two severities `error` and `warning`.
- **No exit in library code**: `core` and `mcp-server` never call `process.exit`; only the CLI entrypoint resolves an exit code.
- **Isolated token estimator**: keep the heuristic behind its single function so it can be replaced later without touching callers.
- **Dependencies**: do not add any runtime or dev dependency without explicit approval.

## Tests

Add or extend tests alongside the change, scaled to its risk:

- A unit test for the rule or algorithm, co-located in the touched package's `test/` directory (for example `packages/core/test/`).
- A focused fixture when the behavior is user-visible, following the per-scenario pattern under `packages/cli/test/fixtures/<scenario>/`.
- Keep fixtures small, local, and network-free so a failure points at one behavior rather than a whole repo snapshot.

## Verify

Before finishing, run the checks that apply to the touched scope and confirm they pass:

```bash
npm run typecheck
npm test
npm run build
```

Use `npm run lint` and `npm run format` when the touched scope requires style verification.

## Authoring And Documentation Deliverables

Some tasks ship prose, not code — a `SKILL.md`, a README section, a doc page — and its correctness is whether every claim it makes about THIS product is true. The checks above (`typecheck`/`test`/`build`) do not read prose: they pass while the text is wrong, so they are not verification for this class of work.

- Treat every command, flag, option value, output field, and path the document asserts as a claim to verify against the authoritative source before you write it — the CLI command wiring (`packages/cli/src/program.ts` and the command modules), the core contracts (types, schemas, result shapes), and the MCP tool/`inputSchema` definitions. Quote the source; do not recall it.
- Bind each flag or option to the command that owns it — a flag on one command is not evidence another accepts it (`lint --config` does not make `init --config` exist).
- Describe behavior at its real edges (no-detection / no-write / rerun / nested-target / non-LF / duplicate-input), not the happy path alone; keep it host-neutral and portable exactly as the task requires.
- Verify the deliverable the way its consumer will: parse frontmatter through the real validator, resolve every referenced surface against the current tree. If a claim cannot be verified against source, do not make it.

## Comments And Rationale

- Treat comments as part of the deliverable: all new code must be documented where it is introduced, not left for a later cleanup pass.
- Follow the rule `why, not what`: write comments to explain why the code exists, why a constraint matters, or why a specific shape was chosen.
- Prefer rationale, invariants, tradeoffs, cross-platform notes, and bug-prevention context over narrating what the syntax already says.
- Do not add comments that merely restate names, types, assignments, loops, or conditionals.
- When behavior is non-obvious, surprising, or roadmap-constrained, capture that reason next to the relevant code path.
- If a block is hard to justify with a short why-comment, simplify or restructure it until the intent and rationale are clear.

## Additional Project Context

{?memory_path}A brief of repository memory relevant to this task — distilled lessons, conventions, known-fragile areas, and entity cards for the files you will touch — is at {memory_path}. Read it before editing and let it guide the change; treat it as advisory and verify each point against the current code (it can be stale).{/memory_path}

{?subtask_spec_path}The task is decomposed and you must implement ONLY this subtask — subtask {subtask_order} of {subtask_count} — per its immutable spec: {subtask_spec_path}{/subtask_spec_path}

{?predecessor_context}A handoff brief covering the subtask(s) this one depends on — their changed files, locked decisions, and open edges — is at {predecessor_context}. Read it first: build on what they established, do not re-explore or duplicate it, and do not break the contracts it marks as locked. It is ground truth for facts (files, commits) and advisory for interpretation — verify interpretive claims against the current code.{/predecessor_context}
