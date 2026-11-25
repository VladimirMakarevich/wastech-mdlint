# Security Rules

The security model is a deterministic, local-first Markdown analysis tool. Keep new work inside that boundary unless the user explicitly expands scope.

## Runtime Boundaries

- Local filesystem analysis only, plus read-only `git` through core's runner (see Command Execution).
- No external HTTP link checks and no external link caches.
- No remote `$schema` URLs. Schema resolution stays local and version-matched: config points at a relative path into the installed package, so an editor validates against the version actually present rather than whatever a network host serves, and an offline checkout behaves identically to an online one.
- No runtime TypeScript config loading, no config code execution, no user-code plugin execution.

## Config And Validation Safety

- Config is JSONC `wastech-mdlint.config.json`.
- Validate config and rule options structurally before execution.
- Declarative custom rules stay data-driven and closed over a fixed primitive vocabulary. The closure is the security property: a rule is data the engine interprets, never code the engine runs.
- If a feature would require loading arbitrary user code, treat it as out of scope.

## MCP And Host Safety

- MCP stays stdio-only.
- The shipped MCP surface is read-only across its six tools; `since` reads git, it never writes.
- Do not add mutating MCP tools, HTTP or SSE transports, or hidden side-channel behavior unless the user explicitly asks for that work.
- CLI and MCP reuse core behavior rather than implementing separate security-sensitive code paths for config, parsing, or rule execution - a second implementation is a second thing to get right and a second thing to forget to fix.

## Viewer Safety

The viewer is the only host with a network listener and the only one that writes outside the repository (its review marks). Its full boundary - binding, which requests may write, tokens, served files, sanitizing, its use of git - is in [`viewer.md`](viewer.md); read it before changing the viewer.

## Installation And File Writes

- No install-time file writes. `postinstall`-style config creation is not acceptable: installing a package must not modify the repository installing it.
- Repository initialization happens through an explicit command (`init`), never as a package installation side effect.
- Documentation-only work must not modify product code or package behavior.

## Reporting And Diagnostics

- Keep reports deterministic and bounded to the analyzed repository state.
- Do not put secrets, environment variables, or unrelated local filesystem data into diagnostics, reports, generated docs, or test artifacts.
- Absolute host paths do not belong in user-visible output: they leak the checkout location and break the repository-relative POSIX path convention. Two deliberate exceptions: a file a command has written outside the working directory, which has to be named by a path the user can actually open, and the viewer's copy-path button on a loopback binding.
- When surfacing errors, prefer structured diagnostics that identify the failing config path or rule without exposing irrelevant system state.

## Command Execution

- If a test, script, or wrapper needs to spawn a child process, pass an explicit argv list rather than interpolating a shell command line. A path containing a space or an ampersand is the ordinary case, not the exotic one, and command-line interpolation turns it into an injection.
- Do not build features that depend on unrestricted command execution inside the analyzer or the MCP server.
- `git` is the one program core runs, and only through its runner in `packages/core/src/git/`, which is how every host starts it - the viewer's review, `lint --since` and `impact --since`, the MCP `since`. It is started from an argv list by the absolute path found on `PATH`'s absolute entries, never by bare name, which Windows looks up in the repository first. It runs only to read: it never writes under `.git` (the work tree is compared through `status`, since a porcelain `diff` rewrites the index), never fetches a partial clone's missing object (`GIT_NO_LAZY_FETCH`, plus every protocol refused for gits before 2.45), and repository config cannot make it start a program - fsmonitor emptied (before git 2.36 `false` is a hook path), every filter driver emptied, signatures not shown in `log` and `blame`, `--no-ext-diff --no-textconv`. Those settings travel as environment config, not `-c`, which cannot override a driver whose name contains `=`; inherited `GIT_*` variables are dropped but the user's config-file selectors, a ref starting with `-` is refused, and errors never carry git's stderr, which quotes absolute paths.
