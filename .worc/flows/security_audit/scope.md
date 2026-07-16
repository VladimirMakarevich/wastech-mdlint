Establish the scope of the security audit for the **wastech-mdlint** repository at `{repo}` before
any investigation begins: which components and trust boundaries are in scope, which classes of issue
to look for, and which surfaces are out of scope by design.

## Project grounding

wastech-mdlint is a deterministic, **local-first** Markdown analysis tool being re-platformed into a
v2 npm-workspaces monorepo. Shipped code lives under `{repo}/packages/`:

- `{repo}/packages/core/` — `@wastech-mdlint/core`, the single owner of parsing, config loading, lint
  orchestration, the context graph, compile, and formatting.
- `{repo}/packages/cli/` — `@wastech-mdlint/cli`, a thin host over core.
- `{repo}/packages/mcp-server/` — `@wastech-mdlint/mcp-server`, the stdio MCP host over core.

If any legacy single-package code is still present in `{repo}/src/` or `{repo}/test/`, treat it as in
scope alongside the packages. The plan of record is `{repo}/docs/mdlint_v2/`; the canonical vocabulary
is `{repo}/docs/mdlint_v2/glossary.md` — use its exact terms, do not coin synonyms. The security model
this audit measures against is stated in `{repo}/.agents/rules/security.md`: read it first, because the
audit's job is to check that the code actually holds that line.

## The trust boundary (what is in scope)

The declared posture is a deterministic, local-first analyzer with **no network, no code execution, and
no install-time side effects**. The audit surface is exactly the places where that posture could be
violated:

- **Config loading** — the JSONC `wastech-mdlint.config.json` parsed and Zod-validated
  (`loadConfiguration` / `findConfig` / the schemas in `config/`), resolving a **local** `$schema` only.
- **MCP server** — `@wastech-mdlint/mcp-server`: whatever tool registration, transport, and
  input-handling code is present, plus the shape of its structured output and errors.
- **Filesystem & parsing** — document discovery (`loadDocuments`, glob handling), path normalization
  (`normalizeRelativePath`), and Markdown/rule parsing (remark/GFM, the assertion primitives).
- **Child-process execution** — any place `core`, `cli`, or a `.worc/tools/` executable spawns a process.
- **Install & packaging** — each package's `package.json` scripts and any `postinstall`-style hook.
- **Diagnostics & reports** — anything that renders errors, findings, or generated docs.

Anything the security rules put **out of v2 scope** — remote `$schema` URLs, runtime `.ts`/`.cjs`/`.mjs`
config, user-code plugins (Tier-2 code-plugins), external HTTP link checking, mutating or HTTP/SSE MCP
surfaces, install-time file writes — is not a feature to harden but a **boundary whose mere presence in
the code is itself a finding**. Record which of these you will treat that way.

## Your job

State the scope precisely: the components and trust boundaries above that apply to the code actually in
the working tree, the classes of issue to look for in each, and what a complete audit must cover. Do not
widen scope beyond a security audit of this repository, and do not invent surfaces the roadmap excludes
— there is no HTTP server, no auth layer, and no secret store here; say so rather than inventing one to
audit.

This is a read-only scoping pass. Do not edit code or write files anywhere — you only return the typed
structured result required by the output schema. Set `human_input` **only** for a genuine scoping
decision that cannot be made safely from repository evidence (e.g. whether not-yet-shipped MCP code in
the tree is in scope, or whether a legacy `src/` tree is included alongside `packages/`); if a
`human_input` context file is already present, apply that answer and do not repeat the question.
