# Security Rules

The v2 security model is a deterministic, local-first Markdown analysis tool. Keep new work
inside that boundary unless the roadmap or the user explicitly expands scope.

## Runtime Boundaries

- Prefer local filesystem analysis only.
- Do not add external HTTP link checks or external link caches in v2 work.
- Do not introduce remote `$schema` URLs. Schema resolution stays local and version-matched.
- Do not introduce runtime TypeScript config loading, config code execution, or user-code plugin
  execution in v2 paths.

## Config And Validation Safety

- v2 config targets JSONC `wastech-ctxlint.config.json`.
- Validate config and rule options structurally before execution.
- For declarative custom rules, keep the execution model data-driven and closed over a fixed
  primitive vocabulary.
- If a feature would require loading arbitrary user code, treat it as out of scope unless the
  roadmap explicitly adds it.

## MCP And Host Safety

- v2 MCP stays stdio-only.
- The shipped v2 MCP surface is read-only for its six tools.
- Do not add mutating MCP tools, HTTP/SSE transports, or hidden side-channel behavior unless the
  user explicitly asks for that work.
- CLI and MCP must reuse core behavior rather than implementing separate security-sensitive code
  paths for config, parsing, or rule execution.

## Installation And File Writes

- Do not add install-time file writes. `postinstall`-style config creation is not acceptable in
  v2.
- Repository initialization should happen through explicit commands such as `init`, not package
  installation side effects.
- Documentation-only work must not modify product code or package behavior.

## Reporting And Diagnostics

- Keep reports deterministic and bounded to the analyzed repository state.
- Do not dump secrets, environment variables, or unrelated local filesystem data into diagnostics,
  reports, generated docs, or test artifacts.
- When surfacing errors, prefer structured diagnostics that identify the failing config path or
  rule without exposing irrelevant system state.

## Command Execution

- If a test, script, or wrapper needs to spawn a child process, use explicit argv lists rather
  than shell interpolation.
- Do not build features that depend on unrestricted command execution inside the analyzer or MCP
  server.
