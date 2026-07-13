Produce a full, implementation-ready plan from the task and its enriched spec. Do not edit code. Return the typed structured result the output schema requires.

## What To Produce

- The files you expect to touch (repository-relative paths), the change at each, and the order to make them in.
- The load-bearing design decisions and their trade-offs, and the hardest or most uncertain part of the change — name it so the implementer starts there, not last.
- The risks, the cross-cutting invariants the change must preserve, and the tests you expect to add or update.
- Keep it concrete and no longer than an implementer needs to execute without re-deriving the approach.

## Explore Before You Plan

Ground the plan in the code as it exists today, not an idealized version of it:

- Read the files named in the task and the enriched spec first, then follow them into the modules they touch.
- Find the conventions and patterns this change must follow, and name a similar existing feature to model the work on rather than inventing a new shape.
- Trace the relevant code paths end to end — real call sites, types, and package boundaries — so the plan never assumes an interface that isn't there. Verify every path you cite against the current tree.
- If the plan departs from an existing pattern, say so and justify the departure instead of quietly diverging.

## Clarification And Approval

- Use `human_input` only for a material clarification or approval of a risky change — state the precise risk and use repository-relative paths.
- If a `human_input` context file is already present, apply that answer and do not repeat the same request.

## Decomposition

- If decomposition is enabled and the task is large, return ordered subtasks with explicit dependencies.
- If the task already supplies operator-authored subtasks, that split is fixed: produce only the shared implementation plan and do not propose your own subtasks.

## Roadmap And Architecture

Plan within the v2 roadmap (`docs/mdlint_v2/`) and honor `AGENTS.md` precedence and phase boundaries. On conflict, follow the more specific source (phase task file > locked requirements > decision > roadmap summary) and surface the contradiction instead of guessing. Do not preserve legacy single-package behavior that a v2 phase explicitly replaces.

The workspace is a three-package monorepo. `@wastech-mdlint/core` owns the pipeline (parsing, config loading, lint orchestration, graph construction, compile, and result formatting); `cli` and `mcp-server` are thin adapters. Do not plan pipeline logic into the host packages or fork parallel implementations of it.

Reuse the existing core primitives rather than rewriting them (confirm each path against the current tree before you rely on it — the module layout evolves):

- remark-based parser — `packages/core/src/markdown/parse-document.ts` (`parseDocument`)
- context-graph builder — `packages/core/src/graph/build-context-graph.ts` (`buildContextGraph`)
- discovery — `packages/core/src/discovery/`
- isolated token estimator — `packages/core/src/engine/tokens.ts` (`estimateTokens`)

## Testing And Invariants To Plan For

- A unit test per rule/algorithm, co-located in the touched package's `test/` directory (for example `packages/core/test/`).
- A focused per-scenario e2e fixture under `packages/cli/test/fixtures/<scenario>/` when the behavior is user-visible.
- Determinism invariants: sorted output arrays and repository-relative POSIX paths.

## Additional Project Context

{?memory_path}A brief of repository memory relevant to this task — distilled lessons, conventions, known-fragile areas, and entity notes from prior runs — is at {memory_path}. Read it first and let it inform the plan; treat it as advisory and verify each point against the current code (it can be stale).{/memory_path}
