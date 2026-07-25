From the repository and external evidence, work out the structure of the answer so the synthesis can
present it with citations.

{?repository_analysis_path}Base this on the repository analysis at {repository_analysis_path}.{/repository_analysis_path}{?external_research_path} Fold in the external evidence at {external_research_path}.{/external_research_path}{?refinement_path} Keep it scoped to the brief at {refinement_path}.{/refinement_path}

## What to produce

Organize the evidence into the shape the deliverable needs, and capture the reasoning behind it. For a
design/recommendation question that means the options, their trade-offs, and a recommended approach
grounded in what the evidence actually supports.

For a **full-solution audit** — the primary use of this flow here — organize the findings so each one is
directly actionable:

- **Classify every finding into one of four categories**: business/logic defect, technical problem,
  omission/gap, or shortcoming. These are the top-level groups of the report.
- **Within each category, order by severity** (high → medium → low), where severity reflects both how
  wrong or how far short of the requirements/plan the shipped state is and the blast radius of the issue.
- For each finding capture: the exact `path:line` evidence; the standard it violates or falls short of
  (a requirement, decision, architecture invariant, glossary/guide claim, or phase exit criterion) with
  its own citation; *why* it matters (correctness, determinism, cross-platform, test-coverage, or
  architectural-drift consequence); and a concrete **recommended direction** (what to change — not an
  implementation), pointing at the subsystem/file where it should be addressed.
- Ensure the organization reflects coverage of every subsystem the analysis walked (core engine +
  primitives, compile, discovery, config, CLI + init, MCP server, generated schema, requirements/glossary/
  guide docs, tests). If a subsystem yielded no findings, say so explicitly rather than omitting it.
- Keep **cross-subsystem / cross-phase gaps** identifiable (an earlier phase left partial pending a later
  one and never revisited; a contract split across CLI/core/MCP that drifted) — these usually land under
  omission/gap, but state the chain and what remains open.
- Separate confirmed defects from suspected-but-unverified ones so the synthesis can mark the latter
  honestly under Open questions.

Keep enough reasoning that a reader can follow each judgment back to its evidence. Under this flow's
`repository_document` output policy, `{repo}/docs/research/{task_id}/` is the **only** writable path —
organize any notes there and nowhere else. A write anywhere outside it (repo root, `packages/`, `src/`,
a scratch file) fails validation, so do not create one. Return the typed structured result required by
the output schema.
