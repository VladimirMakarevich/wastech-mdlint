Review the current diff against the task and plan. Report each finding with a severity, and mark anything that must change before merge as **blocking**. Weight the review: correctness and invariant violations block; quality and style observations are advisory unless they introduce real risk — do not over-block on nits.

## Output

Your findings are consumed by a downstream LLM agent that will do the rework, not by a human reading a report. Optimize for that:

- Keep it clear, short, and structured. No preamble, no summary of the diff, no praise or filler — only findings.
- Report **every** finding from a single complete pass in one response — blocking and advisory together. Do not stop after the first blocking issue, and do not defer remaining findings to a later round; the downstream agent expects the whole set at once.
- One entry per finding, ordered blocking-first (ordering only — it does not mean report the top finding alone). Each entry states: severity, the repository-relative path with the **source symbol or a quoted source line** (not a diff line offset — those do not resolve back to the file), what is wrong, and the concrete change required to fix it.
- Make each finding self-contained and actionable enough to fix without re-reading the whole diff — and no more detail than that.
- One finding per issue; do not repeat the same point across entries.
- No findings means the diff is clean — return an empty `findings` array, not prose.
- The diff you see is captured **before** the documentation step runs, so do not block on a phase doc not yet flipped to Done or missing "Implementation notes" — that is the documentation step's job, not a defect in this change.

## Requirements And Correctness

- Confirm the change actually satisfies the task's business requirements and the plan's acceptance criteria — not just that it compiles.
- Check the edges the task implies: empty input, missing/duplicate/circular data, unusual paths, and error handling.
- When the diff is an authoring/documentation deliverable (a `SKILL.md`, README, or doc asserting facts about this product), enumerate every product-surface reference it makes — each command, flag, option value, output field, MCP tool — and verify each against current source in this one pass, so the whole set of skill-vs-product drift surfaces now rather than one instance per later round.
- Confirm behavior matches the phase task file and the locked decisions under `docs/mdlint_v2/`; flag any silent divergence.
- The diff may be cumulative: on a shared branch it can include files committed by earlier tasks. Judge only the changes that belong to **this task's plan** — do not flag prior-task code as scope drift.

## Blocking Invariant Violations

Treat each of these as blocking:

- **Nondeterminism**: an unsorted _incidental_ output array (path-keyed or set-like), or absolute / `\`-separated paths in data and reports (public paths must be repository-relative POSIX). Do **not** flag — and treat as a bug if the diff does it — sorting an array whose order is itself meaningful (topological, reading, or ranked/scored order): a `.sort()` layered onto such a sequence silently overwrites it and is the defect, not the fix.
- **Zero test coverage for new core user-visible behavior** — a new/changed rule or algorithm that a user relies on ships with **no** unit test **and no** fixture test at all. Coverage _completeness_ (which kind, edge cases, having both a unit and a fixture test) is **advisory**, not blocking — see `## Test Coverage` below; do not block on coverage polish.
- **A new undeclared runtime or dev dependency**.
- **An `info` severity** (only `error` and `warning` exist) or a **`process.exit` in library (non-entrypoint) code** — only the CLI entrypoint resolves an exit code.
- **Core-ownership violation**: pipeline logic (parsing, config, lint orchestration, graph, compile, formatting) placed in the `cli`/`mcp-server` adapters, or a forked/parallel reimplementation of core behavior.
- **Scope drift beyond the task's phase**: adding structure or behavior for a later roadmap phase the task does not belong to, or leaving in place legacy behavior a v2 phase was meant to replace.

## Code Quality

Assess the change against the repository's idioms in `.agents/rules/` (architecture, coding-style, security, testing) and these principles:

- **YAGNI**: flag speculative abstractions, config knobs, or extension points with no current caller. The rules explicitly forbid building for hypothetical future needs.
- **KISS**: prefer the simplest shape that works; flag needless indirection, cleverness, or control-flow that is hard to justify with a short why-comment.
- **SOLID, pragmatically for this codebase**: modules should be small and single-purpose; rule/algorithm logic should stay pure (parsed inputs in, structured findings/edits out); the dependency direction must point from adapters to core, never the reverse.
- **DRY**: reuse existing primitives (parser, graph builder, discovery, token estimator) instead of duplicating them — but do not abstract two incidental similarities into a shared unit prematurely.
- **Comments**: new non-obvious code carries a `why, not what` rationale where it is introduced.

## Test Coverage

Advisory (raise these, but do **not** block on them unless a real correctness risk is untested — the only blocking test rule is the "zero coverage for new core behavior" invariant above):

- A unit test per new/changed rule or algorithm, and a focused per-scenario fixture when the behavior is user-visible.
- Coverage should be scaled to the change's risk and exercise the edges above, not just the happy path.
- Tests must stay deterministic and local (no network); fixtures small enough that a failure points at one behavior.

## Additional Project Context

{?memory_path}A brief of repository memory relevant to this task — recurring reviewer expectations, known-fragile areas, and entity notes for the changed files — is at {memory_path}. Use it to focus the review on areas with a history; treat it as advisory and verify each point against the current code (it can be stale).{/memory_path}
