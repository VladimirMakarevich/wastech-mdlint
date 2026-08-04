Investigate the **filesystem and configuration surface** of the project at `{repo}`: how it decides which files to read, how it resolves and normalises paths, how it writes the files it emits, and how it loads the user's configuration.{?scope_path} Stay inside the scope fixed at {scope_path}.{/scope_path}

This is the **second of four** analysis passes over disjoint attack surfaces: untrusted input → filesystem and configuration (yours) → interfaces (CLI, MCP) → supply chain.{?analysis_untrusted_input_path} The input pass reported at {analysis_untrusted_input_path} — read it and build on it rather than repeating it.{/analysis_untrusted_input_path} The remit is mandatory and narrow: **do not** re-audit regex safety or document parsing, and do not audit the CLI argument surface, the MCP tools, or dependencies. A later pass owns each.

## Why this surface matters here

A linter is pointed at a directory and told to read everything under it, then to write output back. Two boundaries have to hold: **nothing outside the target tree gets read**, and **nothing outside the intended output path gets written**. Both are pure path-handling problems, and both are cross-platform problems — the project's own rules require correct behaviour on Windows, macOS and Linux, where the path semantics differ in exactly the ways that break containment checks.

## What to look for

- **Escape from the target tree.** In `packages/core/src/discovery/` (globbing, target resolution) and `packages/core/src/engine/path-resolve.ts`, establish how a path is confined. Then test the confinement mentally against: an absolute path in a config `files`/`exclude` entry, a `..` segment, a `..` that only appears after normalisation, a symlink pointing outside the tree, a symlinked *directory* traversed during discovery, and a path that differs from its target only by case or by Unicode normalisation. Confirm whether containment is checked before or after resolution — a check on the pre-resolution string is not a check.
- **Symlinks specifically, in both directions.** Reading through a symlink discloses a file outside the tree; writing through one *overwrites* a file outside the tree. `packages/core/src/atomic-write.ts` resolves `realpath` before committing a rename, which is the right shape — verify what it does when the target does **not** yet exist, when the resolved parent is a symlink, and when the path is replaced between the check and the rename. State whether the window is real or closed, and do not report a TOCTOU race as exploitable without naming who could win it in this product's trust model.
- **The atomic-write contract.** A write that fails partway must leave neither a temp file nor a half-written target — the project asserts this as a boundary guard. Check where the temp file is created (same directory as the target, or a shared temp dir a second process can reach?), what its permissions are, and whether a crash between write and rename can leave readable content somewhere unintended.
- **Config loading.** `packages/core/src/config/` loads JSONC with a local `$schema`. Establish: whether the schema reference can be made remote (the project forbids that by design, so a code path that would fetch one is a **presence finding**, not a hardening gap); whether unknown keys are rejected or silently kept; whether a config value can redirect where output is written; whether `__proto__` / `constructor` / `prototype` keys in the parsed object can reach a merge or an assignment and pollute a prototype; and how deep or how large a config the loader will accept.
- **Config discovery and trust.** Determine which directories are searched for a config and in what order. A tool that walks upward from the target and loads the first config it finds will load a config the user never inspected when run inside an untrusted checkout — establish whether that is the behaviour, and whether a config file inside the *analysed* tree can influence the run.
- **What ends up in output.** Reports and generated files must carry repository-relative POSIX paths. Look for a code path that leaks an absolute path, a home directory, a username, or an environment value into a report, an error message, or a generated skill/document. That is information disclosure, and it also breaks the project's determinism rule.
- **Delivery evidence.** Where the history is reachable **with the tools you were actually granted** (`git log` / `git show` need a shell), a containment guard that was added and later weakened, or a boundary-guard test that was deleted along with the behaviour it protected, is a prime finding. With no shell, say so and drop the claim.

## Coverage is measured, not assumed

A gate downstream re-derives this remit's file list from the repository and compares it against your report, so:

1. **Enumerate first.** `Glob` the remit's files before reading any of them, and keep that list — it is your denominator.
2. **Open what you enumerated**, largest and least familiar first. A file you never opened supports no finding — and it supports no "no findings" either. Skipping one is allowed; skipping it silently is not.
3. **One traced property per subsystem.** Follow a path from the boundary where it enters to the syscall that uses it, and state where containment is enforced along that route. A bare "walked, no findings" label is an unfinished pass, not a result.

Record an exact `path:line` for every observation you intend to make a claim about, and quote the text you are citing.

**Every finding is a pattern, not an instance.** Before you record one, grep the corpus for the whole class and record every site — the same missing check on a sibling code path, a second writer that does not use the atomic helper, another resolver that normalises differently.

## Severity discipline

Rate by **reachability from input an attacker actually controls**. Be explicit about the trust model you are assuming, because it decides the severity: a developer running this tool on their own repository controls the config, so a config-only escape is low severity — while the same escape reachable from a *committed file in an untrusted pull request*, linted by CI, is not. State which of the two each finding is. Mark **exploitable** (name the concrete path, symlink or config value) versus **theoretical** explicitly, and do not inflate the latter.

{?review_path}

## Gaps to close on this pass

A coverage gate reviewed an earlier analysis round; its findings are at {review_path}. Close every gap it names that falls inside this remit — those files and properties first — and do not re-derive what the earlier round already covered.{/review_path}

Read only; do not edit code or write files. **Your report is your final message** — it is persisted as this node's output and is all that later nodes and the coverage gate receive, so it must carry the whole analysis plus a closing `## Coverage` section: what you enumerated, what you opened, what you deliberately skipped and why, and the traced property per subsystem.
