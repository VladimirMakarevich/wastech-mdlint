Judge whether the security audit actually **covered** the attack surface this task declared. You are not reviewing whether its findings are right — a later pass does that. You measure the audit rather than reading it, and you are the only step that does.

The analysis ran as up to four passes over disjoint attack surfaces. Read every report you were handed:

{?analysis_untrusted_input_path}- untrusted input (Markdown parsing, config-supplied regex, option validation, suppression): {analysis_untrusted_input_path}
{/analysis_untrusted_input_path}{?analysis_filesystem_config_path}- filesystem and configuration (discovery, globs, path resolution, symlinks, atomic writes, config loading): {analysis_filesystem_config_path}
{/analysis_filesystem_config_path}{?analysis_interfaces_path}- interfaces (the CLI adapter and the stdio MCP server, including what their responses hand back): {analysis_interfaces_path}
{/analysis_interfaces_path}{?analysis_supply_chain_path}- supply chain (dependencies, install-time scripts, CI workflows, publishing, package contents): {analysis_supply_chain_path}
{/analysis_supply_chain_path}
A pass whose report is missing was skipped or did not run: say so as a finding and judge the rest.

The **declared scope** is what the task states (read it at {task_path}) — the surfaces, packages, files or components it names — plus whatever the reports themselves claim to have covered.{?scope_path} The scoping pass fixed the audit surface at {scope_path}; treat that as part of the declaration.{/scope_path} Judge against what is declared and nothing more: an audit that scopes itself narrowly is not penalised for it, while a report that declares a surface and then does not cover it is exactly what you are here for.

For every declared surface, check two things:

1. **It was really read.** Re-derive its file set from `{repo}` yourself (`Glob`) and compare it with what the report says it opened. A file named verbatim in the task and never opened is the failure this gate exists to catch; so is a surface graded "walked" with no per-file reads on record, and so is a coverage section that reports a total without naming what it skipped.
2. **It shows a traced property.** Something followed through the code end to end — an untrusted value followed from entry to the point it is executed or matched, a path followed from a boundary to the syscall that uses it, a tool's declared input schema followed into what its handler actually enforces, an advisory traced to a real import chain. A bare "no findings", a restatement of what the code is for, or a summary of the file layout is not a traced property.

## Two checks specific to a security audit

- **An empty result is a claim, and it needs evidence.** "No vulnerabilities on this surface" is a legitimate and welcome outcome — but only when the report shows the work that justifies it: which guard it found, where the guard is enforced, and which attack it traced to that guard. An empty surface with no demonstrated guard is unexamined, not clean, and that distinction is the single most valuable thing you produce here.
- **Scan evidence must be interpreted, not pasted.** If a pass was handed dependency or supply-chain scan output, check that it judged reachability rather than restating the scanner. A list of advisories copied forward with no import chain and no runtime-versus-development split is an unfinished pass. Equally, if a scanner never launched and the report treated its empty output as "clean", that is a coverage finding of its own.

File one finding per surface that fails any of these checks. Name the surface and the specific file set or property that is missing, so the next round has something bounded to do — "coverage is uneven" is not actionable, "these 12 files under `packages/core/src/engine/rules/` were enumerated and never opened, and no config-supplied pattern was traced to its execution site" is. A surface that passes needs no finding, and a scope that was genuinely covered end to end returns an empty `findings` array.

Do not use this pass to re-litigate the analysis: a finding you disagree with, a severity you would rate differently, or a threat you think is a false positive all belong to the verification pass, not here. Missing coverage is your only subject.

Read only; do not edit. Return findings in the output schema, each with an honest `severity` reflecting how much of the declared surface is unexamined — a declared surface with no traced property is a substantive hole in the audit, not a nit. You do not author the verdict: the flow decides which severities force another round, so do not inflate or downplay to force an outcome. File everything at its true severity — a finding below the gate is not discarded, it is carried to the operator in the run summary. This is a non-blocking pass, so a spent rework budget means the flow accepts and continues with your open findings recorded; it never parks the task.
