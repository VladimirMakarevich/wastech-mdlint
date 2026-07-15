Investigate the **wastech-mdlint** repository at `{repo}` for evidence that bears on the research
question.{?refinement_path} Work from the refined brief at {refinement_path} — cover every
sub-question it lists.{/refinement_path}

## Where the evidence lives

- **Plan of record** — `{repo}/docs/mdlint_v2/`: the roadmap `index.md`, `requirements/`, `decisions/`,
  the per-phase folders `P0-foundations/` … `P9-release/` (each `index.md` carries the dependency table,
  sequence diagram, and **phase exit criteria**), the `glossary.md`, and `p1-p3-execution-notes.md`.
- **Shipped code** — `{repo}/packages/core/`, `{repo}/packages/cli/`, `{repo}/packages/mcp-server/`.
  Legacy single-package code may still live in `{repo}/src/` and `{repo}/test/`; note when something the
  plan says should have moved into a package still only exists in the legacy tree.
- **Delivery evidence** — the git history is always present and authoritative: `git log` shows the
  per-phase/per-task commits (`P0.xx` … `P8.xx`), and `git show`/`git log -p` reveal what each task
  actually changed versus what its task file asked for. Discrepancies here are prime findings. If a
  `{repo}/.worc/logs/<task-id>/` directory happens to be present in the working tree (`summary.md`,
  `plan.md`, `validation_report.json`, `current.diff`) use it as a supplement — but it is gitignored, so
  do not treat its absence as a finding.
- **Tests** — Vitest suites and fixtures colocated with each package (plus legacy `test/`).

## What to look for

Record exact `path:line` for every observation you intend to make a claim about — these become the
citations the synthesis must anchor, so they must point at text that is really there.

For a plan-vs-implementation audit, for each phase in scope:

1. **Exit-criteria coverage.** Read the phase `index.md` exit criteria and the numbered task files, then
   confirm the corresponding code exists in `packages/` and behaves as specified. Note anything checked
   off in the plan but thin, stubbed, or missing in code.
2. **Requirement conformance.** Trace each cited requirement (`requirements/*.md`) to its implementation.
   Note silent divergences and undocumented scope cuts.
3. **Architecture invariants.** Check core-owns-the-pipeline (no forked `lintFiles`/config/formatting in
   CLI or MCP), single `ParsedDocument` parse pass, registry-driven rules, one shared `ContextGraph`
   (no parallel traversal), deterministic repo-relative POSIX output, JSONC config with local `$schema`
   (no remote URLs, no runtime-TS/code-plugin loading), stdio-only read-only MCP.
4. **Test adequacy.** Compare each phase's coverage priorities against what the tests actually exercise.
   Flag rules, graph algorithms, exit codes, cross-platform path/newline behavior, or MCP contracts that
   are asserted weakly or not at all.
5. **Cross-phase gaps.** Follow the `Depends on` / `Blocks` chains. Look for the specific failure mode:
   an earlier phase that needed something from a later phase, was completed with a placeholder or partial
   seam, and was never revisited to close the gap once the later phase shipped. Recorded deferrals in
   task files or `.worc/logs/` are strong leads.
6. **Weak code.** Note fragile parsing, non-deterministic ordering, unhandled error paths, TODO/FIXME
   markers, and abstractions built ahead of a concrete need.

Read only; do not edit code or write files. Return the typed structured result required by the output
schema.
