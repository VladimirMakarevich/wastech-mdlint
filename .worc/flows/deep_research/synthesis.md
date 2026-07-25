Write the research deliverable for **wastech-mdlint**.{?architecture_design_path} Follow the structure worked out at {architecture_design_path}.{/architecture_design_path}{?repository_analysis_path} Draw evidence from the repository analysis at {repository_analysis_path}.{/repository_analysis_path}{?external_research_path} Cite external sources from {external_research_path}.{/external_research_path} Under this flow's `repository_document` output policy, `{repo}/docs/research/{task_id}/` is the **only**
writable path; any write outside it fails validation. Produce exactly these two files there, and write
nothing anywhere else:

- `{repo}/docs/research/{task_id}/report.md` — the answer in prose. Open with a short summary of the
  question and the headline conclusion, then the findings, the recommended directions and their
  trade-offs, and an **Open questions** section for anything left unresolved or unverified.

  For a **full-solution audit**, structure the findings body under the four category headings —
  **Business/logic defects**, **Technical problems**, **Omissions / gaps**, **Shortcomings** — and order
  findings by severity (high → medium → low) within each. Give each finding: what is wrong, thin, or
  missing; the `path:line` evidence; the standard it violates or falls short of (requirement / decision /
  architecture invariant / glossary or guide claim / phase exit criterion); why it matters; and a concrete
  **recommended direction** (what to change, not an implementation). State which subsystems were covered
  (core engine + primitives, compile, discovery, config, CLI + init, MCP server, generated schema,
  requirements/glossary/guide docs, tests) and name any that yielded no findings so coverage is legible.
  Keep a short **cross-subsystem / cross-phase gaps** note for earlier work left partial and never
  revisited. End with a **Summary** giving the count of findings per category and the highest-severity
  items to address first. Use the glossary's exact terms.

- `{repo}/docs/research/{task_id}/sources.json` — the citation manifest: `{"sources": [ ... ]}`, one
  entry per claim that cites the repository. Each entry is `{"id": "...", "claim": "...", "path":
  "<repo-relative file>", "line": <1-based int, optional>, "snippet": "<exact text expected at that
  location, optional>"}`. For an external reference use `{"id": "...", "claim": "...", "url": "..."}`
  instead of `path`. When a finding is measured against a documented standard, cite both the code location
  _and_ the requirement/decision/invariant clause — a claim that "the code diverges from the plan" needs a
  citation to each side.

Every repository citation must point at a real file/line whose snippet is actually present — a citation
to something that does not exist will be rejected. If a verification round flags a citation as broken,
either correct it to a real location or drop the claim and record it under **Open questions** as
unverified; do not invent findings, and do not overstate a suspected issue as a confirmed one. Do not
modify any source file. Return the typed structured result required by the output schema.
