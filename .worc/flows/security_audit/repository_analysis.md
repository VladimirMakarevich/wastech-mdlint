Analyze the **wastech-mdlint** repository at `{repo}` for security-relevant surface, within the agreed
scope.{?scope_path} Work within the scope fixed at {scope_path} — cover every component and issue class
it lists, and honor anything it marked out of scope.{/scope_path}

## Where the security-relevant surface lives

- **Config loading** — `{repo}/packages/core/src/config/`. Trace how JSONC is parsed into an object,
  how that object is merged and Zod-validated, how per-rule options are validated before they reach a
  rule, and how `$schema` is resolved and written (the `init` config-writer path). Note any place a
  value flows into behavior without passing validation.
- **MCP server** — `{repo}/packages/mcp-server/src/` (`tools/`, `shared/`). Record which tools are
  registered, what transport is wired, how each tool validates its arguments, and what the structured
  output and `{ code, message, hint }` error payload expose.
- **Filesystem & parsing** — `{repo}/packages/core/src/discovery/` and `{repo}/packages/core/src/markdown/`,
  plus the glob helpers. Trace how a path from config or a tool argument flows to a file read, and how
  globs, links, imports, and anchors are resolved and normalized.
- **Child processes** — grep `core`, `cli`, and any `.worc/tools/` executable for process spawning; note
  argv-list vs shell interpolation at each call site.
- **Install & packaging** — each package's `package.json` scripts; look for `postinstall` or any other
  install-time write.
- **Diagnostics & reports** — error rendering, `LintMessage` formatting, the `INTERNAL_ERROR` wrap in
  `{repo}/packages/core/src/errors.ts`, and generated docs/schema output.

## Delivery evidence (always-available)

Git history is always present and authoritative: `git log` / `git show` reveal what each task actually
changed and can surface a risky pattern introduced in a specific commit. If a `{repo}/.worc/logs/<task-id>/`
directory happens to be present in the working tree it is a supplement only — `.worc/` (except `flows/`)
is gitignored, so treat its absence as normal, never as a finding.

## What to record

Record the exact `path:line` for every security-relevant observation — these anchor the later threat
findings and must point at text that is really there. For each surface note: the untrusted input, where
it enters, what validation or normalization it passes through, and where it reaches a sink (a file read,
a process spawn, an object merge, a rendered diagnostic). Note also the **absence** of an expected
control — a path used without `normalizeRelativePath`, a user-supplied regex option with no bound, an
error path that could echo a filesystem path or environment value, a tool argument that skips its Zod
schema.

Do not assess exploitability yet — that is the threat step's job; here you map the surface and the
evidence for it. Read only; do not edit code or write files. Return the typed structured result required
by the output schema.
