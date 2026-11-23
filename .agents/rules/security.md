# Security Rules

The security model is a deterministic, local-first Markdown analysis tool. Keep new work inside that boundary unless the user explicitly expands scope.

## Runtime Boundaries

- Local filesystem analysis only.
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
- The shipped MCP surface is read-only across its six tools.
- Do not add mutating MCP tools, HTTP or SSE transports, or hidden side-channel behavior unless the user explicitly asks for that work.
- CLI and MCP reuse core behavior rather than implementing separate security-sensitive code paths for config, parsing, or rule execution — a second implementation is a second thing to get right and a second thing to forget to fix.

## Viewer Safety

The viewer is the only host with a network listener, and any open page can make the browser send it requests. Its boundary:

- Bound to `127.0.0.1` by default; another address only through an explicit `--host`, which it announces.
- Read-only unless asked: `GET` and `HEAD` only, but for the config page's `POST` preview (writes nothing), save and open. A save needs `--allow-config-writes`; save and open are refused with a non-loopback `--host`, as anyone reaching the port could then rewrite the config or start programs here.
- A request with a body needs this server's `Origin`, same-origin fetch metadata if any, an `application/json` type (no HTML form can send it; a cross-origin `fetch` needs a preflight never approved) and the per-process token only the config page carries; bodies stop at 256 KiB.
- A save writes only the config the corpus was loaded from, inside the repository, over the version the page edited, with text `parseConfiguration` accepts — atomically and read back; if another program wrote the file meanwhile, its newer version stays and the save reports a conflict.
- Open runs the system's file manager or default app on that config alone, from an argv list; a path with a `"` is refused.
- Every request's `Host` must be localhost, an IP literal or the configured host (DNS rebinding); one carrying another origin, or a non-navigation from another site, is refused.
- It serves corpus documents and only the non-Markdown files they link to or embed that no `exclude` pattern or `.gitignore` covers — every `.gitignore`, whatever `respectGitignore` says. A request path is decoded per segment and refused if it could leave the repository; every file read must really resolve inside it.
- Author HTML is sanitized before the viewer adds its own markup, `name` kept on `<a>` only so no author element shadows a member of `document`; pages carry a CSP allowing scripts from the viewer's origin only; SVG and other files served as-is are sandboxed.
- An `echarts` block is author data, parsed as JSON and never evaluated. ECharts would insert a tooltip's formatter and the data view's `title`/`lang` as `innerHTML` and open `link`/`sublink` with `window.open`, so every tooltip becomes `richText`, those labels are dropped and a link survives only as an http(s) URL.
- The graph's `folder` and `focus` and the prompts' `path` are only compared with the corpus's own paths, never joined onto a filesystem path; anything else is a 404.
- No CDN or network fetch: Mermaid, ECharts and every asset come from the installed packages.

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
