Write the research deliverable for **wastech-mdlint**.{?architecture_design_path} Follow the structure worked out at {architecture_design_path}.{/architecture_design_path}{?repository_analysis_path} Draw evidence from the repository analysis at {repository_analysis_path}.{/repository_analysis_path}{?external_research_path} Cite external sources from {external_research_path}.{/external_research_path} Under this flow's `repository_document` output policy, `{repo}/docs/research/{task_id}/` is the **only**
writable path; any write outside it fails validation. Produce exactly these two files there, and write
nothing anywhere else:

- `{repo}/docs/research/{task_id}/report.md` — the answer in prose. Open with a short summary of the
  question and the headline conclusion, then the findings, the recommended approach and its trade-offs,
  and an **Open questions** section for anything left unresolved or unverified.

  For a **plan-vs-implementation audit**, structure the body by phase (`P0`…`P8`), findings ordered by
  severity within each phase, and give each finding: what is wrong or thin, the `path:line` evidence,
  the plan clause it violates (phase task file / requirement / decision / architecture invariant), why
  it matters, and a concrete remediation pointing at where it should be closed. Keep a dedicated
  **Cross-phase gaps** section for earlier-phase work left partial pending a later phase and never
  revisited. Use the glossary's exact terms.

- `{repo}/docs/research/{task_id}/sources.json` — the citation manifest: `{"sources": [ ... ]}`, one
  entry per claim that cites the repository. Each entry is `{"id": "...", "claim": "...", "path":
  "<repo-relative file>", "line": <1-based int, optional>, "snippet": "<exact text expected at that
  location, optional>"}`. For an external reference use `{"id": "...", "claim": "...", "url": "..."}`
  instead of `path`. Cite both the code location *and* the plan clause a finding is measured against —
  a claim that "the code diverges from the plan" needs a citation to each side.

Every repository citation must point at a real file/line whose snippet is actually present — a citation
to something that does not exist will be rejected. If a verification round flags a citation as broken,
either correct it to a real location or drop the claim and record it under **Open questions** as
unverified; do not invent sources, and do not overstate a suspected issue as a confirmed one. Do not
modify any source file. Return the typed structured result required by the output schema.
