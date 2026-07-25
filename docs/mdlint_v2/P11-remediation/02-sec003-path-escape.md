# P11.02 · Stop `SEC-003` reading files outside the analyzed root

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Audit finding **H-2** (release-blocking, security,
> [post-P9 audit](../audit-2026-07-25-post-p9.md)). Staged as
> [`tasks/pending/p11-02-sec003-path-escape.md`](../../../tasks/pending/p11-02-sec003-path-escape.md).

## Goal

A lint run must stay bounded to the analyzed repository. `SEC-003`'s `template` option currently lets
a config — or an MCP caller — make the linter read any file on the host and surface its contents in
findings.

## Problem (from the audit)

`packages/core/src/engine/rules/sec.ts:99-114` loads the template, and `:109` is:

```ts
const content = readFileSync(path.resolve(rootDir, templatePath), "utf8");
```

There is **no containment check** — `sec.ts` does not import `escapesRoot`, while the sibling
reference primitive does guard (`packages/core/src/engine/primitives/reference.ts:30`, `:141`; helper
`packages/core/src/engine/path-resolve.ts:27-29`). And `path.resolve` ignores `rootDir` when the
second argument is absolute. Reproduced: `template: "../<outside>/secret.md"` quotes headings from
outside the project; `template: "/etc/hosts"` emits every `#`-line (covers shell scripts,
Dockerfiles, YAML, CI configs, `.env` comments); `template: "/etc/definitely-not-here"` yields
`template … was not found` — a clean existence oracle for arbitrary absolute paths.

Why it is more than a config footgun: the MCP `lint` tool takes the whole `rules` array from its
caller and sets `rootDir: process.cwd()` (`packages/mcp-server/src/tools/lint.ts:150`). An agent
under prompt injection turns a read-only linter into a host-read primitive. This violates
`.agents/rules/security.md` ("keep reports bounded to the analyzed repository state"; "do not dump …
unrelated local filesystem data into diagnostics"), and the tool description
(`packages/mcp-server/src/tools/lint.ts:194-197`) — the exact artifact the earlier M-3 honesty pass
touched — now misstates the access.

## Deliverables / steps

1. Reject an out-of-root `template` in `SEC-003` before reading. `escapesRoot` alone is
   **insufficient** — it catches `..`-relative escapes but not an absolute path. Reject **both**: an
   absolute `templatePath`, and a relative one that normalizes outside `rootDir`.
2. Prefer a **structured config-attributed finding** ("template path escapes the analyzed root") over
   silent `undefined`, so a bad path teaches the user why.
3. **Class sweep:** audit every other `readFileSync`/`existsSync` in rules and primitives for the
   same class. Any path reaching the filesystem from config or document content goes through one
   shared containment helper (extend `path-resolve.ts`; do not add a divergent second check). Record
   what was checked.
4. Re-check and, if needed, correct the MCP `lint` tool description against the fixed behavior.

## Out of scope

Do not narrow the legitimate capability: a `template` that exists on disk **inside** the root but
outside the Markdown corpus must keep loading from disk — that is why the on-disk read path exists.
Do not change the shape/severity of a normal `SEC-003` violation.

## Exit criteria

- [ ] `SEC-003` `template: "/etc/hosts"` reads nothing and emits a config-attributed diagnostic.
- [ ] `SEC-003` `template: "../outside/x.md"` reads nothing and emits the same class of diagnostic.
- [ ] An in-root template outside the `include` corpus still loads from disk (no regression).
- [ ] No other rule/primitive can reach the filesystem outside the root from config or content; the
      sweep result is recorded in the task summary.
- [ ] The MCP `lint` tool description matches the actual filesystem access.
- [ ] Regression tests exist for both escape forms.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
