Investigate the **exposed interfaces** of the project at `{repo}`: the command-line adapter in `packages/cli/src/` and the stdio MCP server in `packages/mcp-server/src/`, including what each accepts as input and what each hands back to its caller.{?scope_path} Stay inside the scope fixed at {scope_path}.{/scope_path}

This is the **third of four** analysis passes over disjoint attack surfaces: untrusted input → filesystem and configuration → interfaces (yours) → supply chain.{?analysis_untrusted_input_path} The input pass reported at {analysis_untrusted_input_path}.{/analysis_untrusted_input_path}{?analysis_filesystem_config_path} The filesystem/config pass reported at {analysis_filesystem_config_path}.{/analysis_filesystem_config_path} Read what you were handed and build on it. The remit is mandatory and narrow: **do not** re-audit regex safety, document parsing, path containment internals, or dependencies — a sibling pass owns each. Your subject is the boundary itself: what crosses it, in which direction, and what is trusted on the way through.

## The interesting asymmetry: the MCP consumer is an LLM

The CLI is driven by a human who typed the command, so its input is largely self-inflicted. The MCP server is different in a way that matters more than anything else on this surface: **its caller is an autonomous agent, and its output is fed back into that agent's context.** That inverts the usual direction of trust. The tool returns linted document content, rule messages, and graph data — all derived from files the tool did not write — and the agent reads the result as information it may act on.

So treat MCP tool output as a **prompt-injection channel** and judge it as such:

- Does any tool response embed raw document content, a file excerpt, a heading, a link title, or a rule message built from document text?
- Can content inside an analysed Markdown file therefore reach the calling agent as text that reads like an instruction ("ignore your previous instructions", a fake tool result, a fabricated system notice)?
- Is embedded content delimited, escaped, or labelled as untrusted data in the response shape, or is it concatenated into prose the agent cannot distinguish from its own reasoning?
- Is there a size bound? An unbounded excerpt is both a context-exhaustion vector and a larger injection payload.

This is a real finding class for this product, not a hypothetical: the shipped skills exist precisely so an agent drives these tools over a repository the agent did not author. Look at `packages/mcp-server/src/shared/tool-response.ts` and `lint-message-schema.ts` for the response shape, and at each tool under `packages/mcp-server/src/tools/` for what it puts in it.

## What else to look for

- **Tool input validation.** Each MCP tool declares an `inputSchema`. For every tool in `packages/mcp-server/src/tools/`, compare the schema against what the handler actually does with the value: a path accepted as `string` with no containment check, an optional field the handler assumes is present, a numeric bound declared in the schema but not enforced after coercion, an array with no maximum length. A schema is documentation until the handler honours it.
- **Path arguments from a model.** Every tool that takes a path takes it from an LLM's output, which is neither trusted nor validated by anything upstream. Establish where that path is confined and whether the confinement is the same one the filesystem pass identified — a second, weaker resolver on this boundary is exactly the kind of divergence worth reporting.
- **Error and diagnostic leakage.** `packages/cli/src/operational-errors.ts` and the MCP error paths: does a failure return a stack trace, an absolute filesystem path, a config fragment, or an environment value to the caller? For the MCP server that content lands in an agent's context; for the CLI it lands in CI logs.
- **The stdio protocol boundary itself.** The server speaks JSON-RPC over stdio. Check that nothing else writes to stdout (a stray `console.log` corrupts the protocol stream and can be used to inject a forged frame), that diagnostics go to stderr, and that malformed or oversized frames are rejected rather than buffered without bound.
- **Exit codes and process control.** The project's rule is that library code never terminates the process — only the CLI entrypoint resolves an exit code. Verify it: a `process.exit` inside `core` or `mcp-server` would kill a host application that embeds the library, and in the MCP server it would drop the session. Report a violation as an availability finding with the layering rule it breaks.
- **Adapter thinness as a security property.** Both adapters are supposed to be thin over core. A validation, a path normalisation, or a suppression decision re-implemented in an adapter is a divergence: two implementations of one rule drift, and the weaker one becomes the way in. Name any you find.
- **The entrypoint guard.** Both packages ship a `bin`. Check how the entrypoint distinguishes being run from being imported, and whether the guard behaves when the binary is invoked through an npm-style symlink rather than by its real path.

## Coverage is measured, not assumed

A gate downstream re-derives this remit's file list from the repository and compares it against your report, so:

1. **Enumerate first.** `Glob` `packages/cli/src/**` and `packages/mcp-server/src/**` before reading any of them, and keep that list — it is your denominator. This is the smallest remit of the four (roughly eighteen source files), so "I ran out of budget" is not an available excuse for an unopened file here.
2. **Open what you enumerated.** A file you never opened supports no finding — and it supports no "no findings" either. Skipping one is allowed; skipping it silently is not.
3. **One traced property per interface.** For the CLI: one argument followed from parsing to the core call it reaches. For the MCP server: one tool followed from its `inputSchema` through the handler to the exact shape of what it returns. A bare "walked, no findings" label is an unfinished pass.

Record an exact `path:line` for every observation you intend to make a claim about, and quote the text you cite.

**Every finding is a pattern, not an instance.** Six MCP tools share helpers; a missing bound in one is usually missing in its siblings. Grep the class and record every site.

## Severity discipline

Rate by **reachability from input an attacker actually controls**, and state the assumed trust model per finding — an argument the operator types themselves is not the same as a path an LLM chose, and neither is the same as content inside a linted file from an untrusted branch. Mark **exploitable** (name the concrete input) versus **theoretical** explicitly, and do not inflate the latter to make the report look productive.

{?review_path}

## Gaps to close on this pass

A coverage gate reviewed an earlier analysis round; its findings are at {review_path}. Close every gap it names that falls inside this remit — those files and properties first — and do not re-derive what the earlier round already covered.{/review_path}

Read only; do not edit code or write files. **Your report is your final message** — it is persisted as this node's output and is all that later nodes and the coverage gate receive, so it must carry the whole analysis plus a closing `## Coverage` section: what you enumerated, what you opened, what you deliberately skipped and why, and the traced property per interface.
