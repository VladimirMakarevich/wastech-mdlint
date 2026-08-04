Investigate the **untrusted-input surface** of the project at `{repo}`: everything that consumes content this tool does not control — Markdown documents, and the regular expressions and matching options a user's configuration supplies to the rule engine.{?scope_path} Stay inside the scope fixed at {scope_path}.{/scope_path}

This is the **first of four** analysis passes over disjoint attack surfaces: untrusted input (yours) → filesystem and configuration → interfaces (CLI, MCP) → supply chain. The remit is mandatory and narrow: **do not** audit path resolution, glob or symlink handling, config file loading, the CLI, the MCP server, or dependencies. A later pass owns each of those, and budget spent there is depth the surface that needs it never gets.

## Why this surface is the first one

This product's whole job is to read documents it did not write, using patterns a user supplied, with no authentication in front of it. There is no attacker "session" here — the attacker's input **is** the repository content and the config. That makes the dominant risk class **algorithmic complexity, not memory corruption**: a pattern or a document that makes the tool consume unbounded CPU or memory. In a linter that runs in CI on every push, or inside an editor on save, a hang is a real denial of service.

## What to look for

- **Catastrophic backtracking (ReDoS).** `packages/core/src/engine/regex.ts` is the module that constructs `RegExp` objects; find every place a pattern originates from user configuration rather than from a literal in the source, and judge whether the construction path applies a safety analysis or merely a `try`/`catch` around a syntax error. A pattern that compiles is not a pattern that terminates. Trace at least one config-supplied pattern from where it is declared to where it is executed against document text, and state which of the two the guard actually protects against.
- **Every regex construction site, not just the guarded one.** `new RegExp` also appears in the rule implementations under `packages/core/src/engine/rules/` (for example the term-matching construction in `ctx.ts` and the id pattern in `ref.ts`). For each, establish whether the inputs are escaped, whether the escaping helper used is the project's own, and whether a site bypasses the shared safety layer that `regex.ts` provides. A finding that names one unsafe construction while a sibling file has the same shape understates its own severity.
- **Unbounded work driven by document shape.** Deep nesting, very long lines, a pathological table, a document that is one enormous paragraph, thousands of headings, a reference graph with a cycle. Look for recursion with no depth bound, quadratic scanning (an inner search restarted per token or per line), and any place a `RegExp` with the `g` flag is reused across calls so `lastIndex` carries state between documents.
- **Parse-layer assumptions.** In `packages/core/src/markdown/`, check what the parse pass assumes about its input — encoding, line endings, byte length, whether a construct can be truncated mid-token — and what happens when the assumption is violated rather than what happens on well-formed input.
- **Option validation that does not validate.** Options are Zod-validated in several places. A schema that accepts a `string` where the code then treats it as a pattern, a coercion that widens rather than narrows, or a `passthrough`/`catchall` that lets an unmodelled key reach behaviour, is a validation gap even though a schema is present.
- **Suppression and trust.** `packages/core/src/engine/suppression.ts` lets a document turn rules off from inside its own content. Establish what a document can suppress, whether the suppression syntax can be smuggled through a construct that should not carry directives (a code fence, a link title, an HTML comment inside a table cell), and whether a suppression can reach beyond its own file.
- **Delivery evidence.** Where the history is reachable **with the tools you were actually granted** (`git log` / `git show` need a shell), a hardening commit that covered one call site and left its siblings is a prime finding. With no shell, say so and drop the claim — do not read a changelog and present it as history.

## Coverage is measured, not assumed

A gate downstream re-derives this remit's file list from the repository and compares it against your report, so:

1. **Enumerate first.** `Glob` the remit's files before reading any of them, and keep that list — it is your denominator.
2. **Open what you enumerated**, largest and least familiar first. A file you never opened supports no finding — and it supports no "no findings" either. Skipping one is allowed; skipping it silently is not.
3. **One traced property per subsystem.** Name something you followed end to end: an untrusted value from where it enters to where it is executed or matched, a bound you confirmed exists, a validation you confirmed rejects what it claims to reject. A bare "walked, no findings" label is an unfinished pass, not a result.

Record an exact `path:line` for every observation you intend to make a claim about, and quote the text you are citing so a later pass can check the location without re-deriving it.

**Every finding is a pattern, not an instance.** Before you record one, grep the corpus for the whole class and record every site — same defect shape, sibling file, second call site, another implementation of the same rule.

## Severity discipline

Rate by **reachability from input an attacker actually controls**, not by how bad the category sounds. State for each finding whether it is **exploitable** (name the concrete document or config value that triggers it) or **theoretical** (a defence-in-depth concern with no reachable trigger in the code today), and mark the latter explicitly. A ReDoS that needs a config the victim writes themselves is a different severity from one a committed Markdown file triggers — say which you have. Do not inflate a theoretical concern into a confirmed vulnerability to make the report look productive; an empty result on a genuinely hardened surface is a valid finding of its own.

{?review_path}

## Gaps to close on this pass

A coverage gate reviewed an earlier analysis round; its findings are at {review_path}. Close every gap it names that falls inside this remit — those files and properties first, ahead of anything else — and do not re-derive what the earlier round already covered.{/review_path}

Read only; do not edit code or write files. **Your report is your final message** — it is persisted as this node's output and is all that later nodes and the coverage gate receive, so it must carry the whole analysis plus a closing `## Coverage` section: what you enumerated, what you opened, what you deliberately skipped and why, and the traced property per subsystem.
