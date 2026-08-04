Establish the scope of the security audit for the repository at `{repo}` before any investigation begins: which components and trust boundaries are in scope, which classes of issue to look for in each, and which surfaces are out of scope by design.

## Ground It In The Project, Not In A Generic Checklist

Read how this project declares its own security posture and trust model first — `AGENTS.md`, the rules under `.agents/rules/` (`security.md` in particular), and the security boundary the plan of record draws in `docs/mdlint_v2/`. The audit's job is to check that the code actually holds that line, not to score the product against a checklist written for a different kind of software.

**This matters more here than usual.** A generic application-security checklist assumes a server: authentication, sessions, an HTTP request boundary, a database, stored user data, cloud infrastructure. Establish early which of those this product actually has. Where it has none, say so once, plainly, and do **not** carry the category forward — a report padded with "N/A: no authentication layer" hides the findings that matter and reads as a clean audit. Judge the product that exists.

Then state what the product **is**, in trust terms, from the code in the working tree: what it accepts that it did not author, who supplies it, what it does with it, and what it hands back to whom.

## The Trust Boundary — Where To Look

Derive the audit surface from what the product actually does. A starting frame, to be confirmed or corrected against the tree:

- **Untrusted content.** The documents this tool parses are written by someone else. So are the patterns and options its configuration supplies to the rule engine. Identify where content and configuration enter, and what bounds their cost — for a tool with no attacker session, **unbounded CPU or memory driven by supplied input is the dominant risk class**, not memory corruption.
- **The filesystem boundary.** Which directory tree the tool is confined to when reading, and which single path it is confined to when writing. Symlinks, `..`, absolute paths in config, and case/Unicode path equivalence are the ways such a boundary usually fails, and the project is required to hold it on Windows, macOS and Linux alike.
- **The exposed interfaces.** A CLI and a stdio MCP server. For the MCP server note the inversion that makes it the most interesting surface here: **its caller is an autonomous agent and its output re-enters that agent's context**, so content from an analysed file can reach the agent as something that reads like an instruction. Treat tool responses as a data-to-instruction channel, not only as a data format.
- **Install-time and release-time execution.** Lifecycle scripts, CI workflows, and how a published artifact is produced and by whom.
- **Dependencies.** What is installed, how it is pinned, and whether the vulnerable paths in it are ones this product reaches.
- **Diagnostics.** Whether errors, logs, reports, or generated documents can leak absolute paths, environment values, or local details.

## Declared-Out-Of-Scope Is A Finding Class, Not An Exemption

This project declares itself local-first: no network access, no runtime code loading, deterministic local analysis. When a project draws that line, the mere **presence** of code that crosses it is a finding in itself — not a surface to harden. A network call, a dynamic `import()`, an `eval`, a `new Function`, or a spawned child process in product code contradicts the declared model, and the finding is "this exists at all", reported against the document that says it should not.

Record explicitly which declared boundaries you are treating this way, so the analysis passes look for presence rather than for hardening.

## Your Job

State the scope precisely:

- The surfaces above that apply to the code actually in the working tree, mapped to concrete paths so a later gate can re-derive each file set.
- For each surface, the classes of issue worth looking for **in this product** — and where a standard class does not apply, say so once here rather than leaving it for four passes to rediscover.
- The declared boundaries whose violation is a presence finding.
- What a complete audit must cover for the result to be trustworthy, and the trust model each surface should be judged under: content committed by a third party, a config the operator wrote themselves, a path chosen by an LLM, and a fork's pull request are four different attackers with four different reach, and severity depends on which one applies.

Do not widen scope beyond a security audit of this repository, and do not invent surfaces the project does not have — if there is no HTTP server, no auth layer, and no secret store here, say so rather than inventing one to audit.

This is a read-only scoping pass. Do not edit code or write files anywhere — you only return the typed structured result required by the output schema. Set `human_input` **only** for a genuine scoping decision that cannot be made safely from repository evidence; if a `human_input` context file is already present, apply that answer and do not repeat the question.
