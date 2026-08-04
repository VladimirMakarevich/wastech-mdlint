Turn the four analysis passes into a set of concrete, ranked security threats against the product at `{repo}`. The passes found observations on their own surfaces; your job is the step none of them could take — **judging each observation as an attack, and joining observations that are only dangerous together.**

Read everything you were handed before you start:

{?scope_path}- the audit scope and trust model: {scope_path}
{/scope_path}{?analysis_untrusted_input_path}- untrusted input: {analysis_untrusted_input_path}
{/analysis_untrusted_input_path}{?analysis_filesystem_config_path}- filesystem and configuration: {analysis_filesystem_config_path}
{/analysis_filesystem_config_path}{?analysis_interfaces_path}- interfaces (CLI, MCP): {analysis_interfaces_path}
{/analysis_interfaces_path}{?analysis_supply_chain_path}- supply chain: {analysis_supply_chain_path}
{/analysis_supply_chain_path}{?npm_audit_path}- npm-native scan evidence: {npm_audit_path}
{/npm_audit_path}{?checks_path}- the core dependency scanner's report: {checks_path}
{/checks_path}{?review_path}- the coverage gate's findings on the analysis round: {review_path}
{/review_path}

## Your Distinctive Job: Chains

A single-surface observation is usually low severity on its own. The findings that matter in a tool like this are **chains across passes**, and no analysis pass could see them because each was confined to its own remit. Actively look for combinations, and state each as one threat rather than as two:

- Content in an analysed file reaches an agent through an MCP response (interfaces) **and** the agent can be induced to call a tool with a path of its choosing (interfaces) **and** that path is not confined by the same resolver the rest of the code uses (filesystem) — that is a read-beyond-the-tree chain, not three notes.
- A config value redirects where output is written (config) **and** the write path resolves symlinks in a way that permits an existing target outside the tree (filesystem) — that is a write-outside-the-tree chain.
- A CI workflow runs on untrusted fork code with a write-scoped token (supply chain) **and** the tool it invokes evaluates a config from the analysed checkout (config) — that is a CI compromise chain.
- A pattern from config is compiled without a complexity bound (input) **and** a linter runs on every push in CI (supply chain) — that is a build-availability chain.

For each chain, name every link with its `path:line` and state which link is the cheapest to break — that is what makes the finding actionable.

## Frame Each Threat Against The Declared Model

Where the project declares a surface out of scope by design — local-first, no network, no runtime code loading — a threat inside that declared boundary is a **presence finding**: the code being there at all is the issue, cited against the document that forbids it, not a hardening gap to fix with a check.

For everything else, consider the classes that actually apply to this product: unbounded algorithmic cost from supplied patterns or document shape, filesystem escape on read and on write, untrusted content re-entering an LLM's context as apparent instruction, information disclosure through errors and generated output, install-time and CI execution, and dependency advisories whose vulnerable path this product genuinely reaches.

## For Each Threat, State

- **The attack**, in one sentence: who supplies what, and what they get.
- **Who the attacker is.** Be specific, because it sets the severity: an author of a document in an untrusted branch, an operator writing their own config, an LLM choosing a tool argument, or a fork opening a pull request. A threat whose only "attacker" is the victim configuring their own machine is low severity by construction — say so rather than dressing it up.
- **The location** as `path:line` for every link in the chain, or the dependency plus advisory id.
- **Exploitable or theoretical.** State the concrete precondition and the concrete input that trigger it, and whether the attacker you named actually controls them. If there is no reachable trigger in the code today, mark it a defence-in-depth concern explicitly. Do not inflate a theoretical concern into a confirmed vulnerability — the verification pass will reject it and the rework round costs the audit its remaining budget.
- **Impact**, in terms of what this product can lose: developer machine confidentiality, CI integrity, build availability, published-artifact integrity, or the calling agent's decisions.
- **Severity**, consistent with the reachability you just described: `critical` for code execution or a token-bearing CI compromise reachable by an untrusted party; `high` for confidentiality or integrity loss with a real trigger; `medium` for a reachable availability issue or a real gap needing an unusual precondition; `low` for hardening with no reachable trigger.
- **The remediation direction**, one or two sentences, pointing at where the fix belongs in this codebase's own layering — not a generic recipe, and not a redesign.

Where the coverage gate reported a surface as unexamined, do **not** invent threats for it. Carry it forward as a stated limitation of the audit instead: an unexamined surface is a known unknown, and reporting it as "no threats found" would be the most misleading thing this audit could do.

Use the granted network access **only** to confirm an upstream advisory or CVE detail for a flagged dependency — not to fetch anything about this local repository, and not to look up general security advice. If network is unavailable, say so and fall back to the advisory text you were handed.

Read only; do not edit code or write files. Return the typed structured result required by the output schema.
