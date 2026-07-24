Investigate the **wastech-mdlint** repository at `{repo}` for evidence that bears on the research
question.{?refinement_path} Work from the refined brief at {refinement_path} — cover every
sub-question it lists.{/refinement_path}

When the question is a **full-solution audit** — walk the ENTIRE solution and surface every real
problem — treat the whole codebase as in scope and cover it subsystem by subsystem (below), not just a
few areas. The roadmap and per-phase plan remain a lens (does shipped code meet what the plan of record
promised), but coverage is organized by subsystem, and every finding is classified into one of four
categories: **business/logic defect**, **technical problem**, **omission/gap**, or **shortcoming**.

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

## Subsystems to cover (a full-solution audit walks all of them)

1. **Core engine + primitives** — `packages/core/src/engine/**` (the rules engine, `lint-files`, `fix`,
   `path-resolve`, `defined-ids`, `format-lint-result`) and the primitives (`assert`, `checklist`,
   `content`, `reference`, `section`, `table`).
2. **Compile** — `packages/core/src/compile/**` (context, graph-analysis, skill-frontmatter, synthesize).
3. **Discovery** — `packages/core/src/discovery/**` (repo-scan, globs, rule-inference, config-writer,
   package-manager, workspace-packages).
4. **Config** — `packages/core/src/config/**` (config-schema, load-config) and the generated
   `engine/schema.ts` enum surface.
5. **CLI + init** — `packages/cli/**` (commands, init flow, program wiring) and the committed generated
   `packages/cli/schema.json`.
6. **MCP server** — the stdio server surface and its tool/lint description contract.
7. **Docs vs implementation** — `requirements/**`, `glossary.md`, and the guide (`docs/guide/**`) against
   what the engine actually accepts and does.
8. **Tests** — coverage depth and whether assertions are meaningful vs shape-only.

## What to look for

Record exact `path:line` for every observation you intend to make a claim about — these become the
citations the synthesis must anchor, so they must point at text that is really there. For each finding,
capture enough to classify it (business/logic defect | technical problem | omission/gap | shortcoming)
and to assign a severity later.

Across each subsystem above:

1. **Business/logic defects.** Behavior that is wrong against the requirements or the documented intent:
   a rule that accepts/rejects the wrong input, an exit code or diagnostic that misrepresents the result,
   config resolution that resolves to the wrong thing, a `target`/`kind` mismatch, an MCP tool that
   describes itself dishonestly. Trace each cited requirement (`requirements/*.md`) to its implementation
   and note silent divergences and undocumented scope cuts.
2. **Technical problems.** Fragile parsing, non-deterministic ordering, unhandled error paths, resource
   or performance hazards, cross-platform (path/newline) breakage, and **architecture-invariant drift**:
   core-owns-the-pipeline (no forked `lintFiles`/config/formatting in CLI or MCP), single `ParsedDocument`
   parse pass, registry-driven rules, one shared `ContextGraph` (no parallel traversal), deterministic
   repo-relative POSIX output, JSONC config with local `$schema` (no remote URLs, no runtime-TS/code-plugin
   loading), stdio-only read-only MCP.
3. **Omissions / gaps.** Documented or implied behavior that simply is not implemented; phase exit criteria
   checked off in the plan but thin, stubbed, or missing in code; **cross-phase gaps** — an earlier phase
   left partial because it depended on a later phase and was never revisited once that phase shipped
   (follow the `Depends on` / `Blocks` chains; recorded deferrals in task files or `.worc/logs/` are strong
   leads); and missing tests for rules, graph algorithms, exit codes, cross-platform behavior, or MCP
   contracts that documented behavior should have covered.
4. **Shortcomings.** Working but weak: TODO/FIXME markers, abstractions built ahead of a concrete need,
   duplicated logic, weak or shape-only test assertions, and doc/guide claims that overstate or lag the
   implementation.

Separate confirmed observations from suspected-but-unverified ones so the synthesis can mark the latter
honestly. Read only; do not edit code or write files. Return the typed structured result required by the
output schema.
