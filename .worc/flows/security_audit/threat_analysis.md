From the repository analysis and the dependency-scan advisories, identify the concrete security threats
to **wastech-mdlint**.{?repository_analysis_path} Build on the surface mapped at {repository_analysis_path}.{/repository_analysis_path}{?scope_path} Stay inside the scope fixed at {scope_path}.{/scope_path}{?checks_path} Fold the dependency-scan advisories at {checks_path} into your analysis — for each advisory, judge whether the vulnerable code path is actually reached by this product rather than treating the advisory as a finding on its own.{/checks_path}

## Threat model for this product

wastech-mdlint's declared posture is deterministic, local-first, no network, no code execution, no
install-time side effects. Frame each threat against a real surface:

- **Config** (`wastech-mdlint.config.json`, JSONC → Zod): unsafe deserialization, prototype pollution
  through the parsed-object merge, and schema/validation **bypass** (an option reaching a rule
  unvalidated). Any code path that would resolve a **remote** `$schema`, load runtime `.ts`/`.cjs`/`.mjs`
  config, or execute user-authored rule code (Tier-2 code-plugins) is **out of scope by design — its
  presence in the code is itself a finding**, not a hardening task.
- **MCP server** (`@wastech-mdlint/mcp-server`, stdio, read-only): missing or weak input validation on
  tool arguments (each tool carries a Zod input schema — is it actually enforced?), path traversal
  through a file argument, and information disclosure in the structured output or the
  `{ code, message, hint }` error payload. Any **mutating** tool, or an **HTTP/SSE** transport, is out of
  scope — presence is a finding.
- **Filesystem & parsing**: path traversal outside `{repo}`, symlink escape during discovery, ReDoS in
  Markdown parsing or in a user-supplied rule regex (`columnMatches`, `contentNotMatch`), and
  non-deterministic or unbounded reads.
- **Child processes**: command injection wherever a process is spawned without an explicit argv list
  (i.e. through shell interpolation).
- **Install / side effects**: any install-time file write or `postinstall`-style config creation —
  presence is a finding.
- **Diagnostics / reports**: leakage of secrets, environment variables, or unrelated local filesystem
  data into an error, a finding, a generated doc, or a test artifact. The `INTERNAL_ERROR` wrap must stay
  sanitized and never leak a stack trace.

## For each threat

Give: the attack, the affected location as `path:line` (or the dependency + advisory id), the impact,
and a severity. **Distinguish exploitable from theoretical** — state the concrete precondition and input
that trigger the issue and whether an attacker actually controls them in the local-first model, versus a
defense-in-depth concern with no reachable trigger in the code today. Mark the latter explicitly so
verification and the report rank it below a reachable issue, and do not inflate a theoretical concern
into a confirmed vulnerability.

Use only the network access the flow grants, and only to confirm an **upstream advisory or CVE detail**
for a flagged dependency — not to fetch anything about this local repository. If network is unavailable,
say so and fall back to the advisory text. Read only; do not edit code or write files. Return the typed
structured result required by the output schema.
