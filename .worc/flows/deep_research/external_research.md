Gather **external** evidence that bears on the research question about **wastech-mdlint** — only when
the question genuinely turns on how an upstream contract, spec, or library actually behaves. This is an
internal codebase whose plan of record is `{repo}/docs/mdlint_v2/`; do not restate that plan here, and
do not go looking for external sources when the answer is fully determined by the repository itself.

{?refinement_path}Use the refined brief at {refinement_path} to decide whether any sub-question needs
external grounding.{/refinement_path}{?repository_analysis_path} The repository analysis at
{repository_analysis_path} lists the assumptions the code makes — validate the load-bearing ones against
their authoritative source.{/repository_analysis_path}

Authoritative sources that matter for this product, when relevant:

- **CommonMark** and **GitHub Flavored Markdown** specs — for parsing, tables, task-list items, and
  slug/heading behavior the rules and `ParsedDocument` rely on.
- **remark / unified / micromark** and **github-slugger** — the parsing stack the plan says to reuse.
- **Model Context Protocol** spec — for the stdio transport and tool contract the MCP server implements.
- **Zod**, **commander**, **npm workspaces**, and the **Node.js `24.17.0`** runtime — for config
  validation, CLI framework, package layout, and platform APIs.
- **JSONC** and JSON Schema `$schema` resolution — for the local-schema config model.

Use only the network access the flow grants; if network is unavailable, say so and fall back to what the
repository documents. Record each source with a stable reference (URL or precise citation) and a one-line
note on what it establishes and whether the implementation matches it. Read only; do not edit code or
write files. Return the typed structured result required by the output schema.
