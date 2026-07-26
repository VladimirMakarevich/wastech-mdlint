# P11.02 · Stop `SEC-003` reading files outside the analyzed root

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Done**. Audit finding **H-2** (release-blocking, security,
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

- [x] `SEC-003` `template: "/etc/hosts"` reads nothing and emits a config-attributed diagnostic.
- [x] `SEC-003` `template: "../outside/x.md"` reads nothing and emits the same class of diagnostic.
- [x] An in-root template outside the `include` corpus still loads from disk (no regression).
- [x] No other rule/primitive can reach the filesystem outside the root from config or content; the
      sweep result is recorded in the task summary.
- [x] The MCP `lint` tool description matches the actual filesystem access.
- [x] Regression tests exist for both escape forms.
- [x] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.

## Implementation notes

- **New, additive helper — `resolvesOutsideRoot(rootDir, rawPath)` in `path-resolve.ts` — not a
  change to `escapesRoot`.** `escapesRoot` only ever sees already-POSIX-normalized,
  corpus-relative candidates that `resolveRelativeToSource`/`resolveTargetCandidates` build
  internally (`reference.ts`, `graph/coverage.ts`); by construction those can never be
  OS-absolute, so its bare `startsWith("../")` check is sufficient there and is left unchanged.
  `SEC-003`'s `template` is a different input shape: a raw, unprocessed config string handed
  straight to `path.resolve(rootDir, templatePath)`, which honors an absolute path verbatim
  (POSIX `/etc/hosts`, Windows `C:\...`/`\\server\share\...`) ignoring `rootDir` entirely (the
  H-2 repro), or a relative path whose `..` segments climb past it. Reusing/widening
  `escapesRoot` for this would either miss the absolute case or risk regressing
  REF-001/REF-003/G5 coverage for a class of input those call sites never actually produce, so
  the fix adds a second, distinctly-scoped function instead and wires only `sec.ts` to it.
- **Rejects before any filesystem access, unconditionally.** `sec003.check` now calls
  `resolvesOutsideRoot` first and reports
  `"… escapes the analyzed root; skipping conformance checks."` before `loadTemplate` (and
  therefore before any `existsSync`/`readFileSync`) ever runs. This eliminates the audit's third
  repro — `template: "/etc/definitely-not-here"` as a bare file-existence oracle for arbitrary
  host paths — not just the content-leak read. The "was not found" message, per-heading finding
  shape, and `defaultSeverity` are unchanged; only the new early-exit branch and its own message
  are new.
- **Review fix — Windows cross-drive escape.** The first version of `resolvesOutsideRoot` checked
  `path.isAbsolute(rawPath)` plus a `"../"`-prefix on `path.relative(rootDir, resolved)`, which
  missed a drive-relative path landing on a _different_ drive than `rootDir` — e.g. a `rootDir`
  under `C:\repo` with `template: "D:secret.md"`. There, `path.isAbsolute("D:secret.md")` is
  `false` (no separator after the colon), and `path.relative` cannot express "a different drive"
  as a `"../"`-prefixed string — it returns the absolute `to` path unchanged instead. Fixed by
  also treating an absolute `path.relative(...)` result as escaping; covered by a win32-gated case
  in `path-resolve.test.ts`.
- **Class sweep (deliverable 3).** Every `readFileSync`/`existsSync`/`readFile`/`writeFile` call
  in `packages/core/src` was located and classified:

  | Call site                                                              | Verdict                                                                                                                                                                                                                                                                                                                                                                              |
  | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `engine/rules/sec.ts:109` (SEC-003 `template`)                         | **Vulnerable — fixed by this task.** No containment check existed.                                                                                                                                                                                                                                                                                                                   |
  | `engine/primitives/reference.ts:36,142` (REF-001/REF-003 `existsSync`) | **Vulnerable — fixed by this task (review round).** Guarded only by `escapesRoot`'s literal `..`-prefix check; a plain `..`-cancelling relative link (e.g. `../c:/Windows/x.md`, no crafted absolute text needed) could still normalize to a drive-absolute remainder. Now also guarded by the new `candidateEscapesRoot`, which additionally rejects an absolute-looking candidate. |
  | `graph/coverage.ts:95` (G5 coverage `existsSync`)                      | **Vulnerable — fixed by this task (review round).** Same gap and same `candidateEscapesRoot` fix as `reference.ts`.                                                                                                                                                                                                                                                                  |
  | `markdown/load-documents.ts:75,207`                                    | Reads discovered during a recursive walk rooted at `cwd`; symlink targets are checked against the root via `isInsideRoot` (:32-38, :137-146) before being followed. Not reachable from an arbitrary config/content string.                                                                                                                                                           |
  | `config/load-config.ts:185`                                            | Reads the config file at a CLI-operator-resolved path, not a value from rule options or document content. The unrelated `findConfig` walk-up-to-filesystem-root issue is H-3, already scoped to a separate task (`P11.04`).                                                                                                                                                          |
  | `discovery/workspace-packages.ts:14,213`                               | Reads `package.json`/`pnpm-workspace.yaml` during `init`'s workspace scan, walked from the repo root — not attacker-suppliable.                                                                                                                                                                                                                                                      |
  | `discovery/rule-inference.ts:67`                                       | Reads `DocCluster.sampleFiles`, which are always a slice of `repo-scan.ts`'s own bounded in-root file list (`repo-scan.ts:241,261,359`) — never a raw config/content string.                                                                                                                                                                                                         |
  | `engine/fix.ts:90` (write, not read)                                   | Writes to `document.path`, which only ever comes from the already-loaded, in-root corpus. Bounded by construction.                                                                                                                                                                                                                                                                   |
  | `packages/cli/**`, `packages/mcp-server/src/index.ts` reads/writes     | All operate on CLI-operator-supplied paths or the package's own `package.json`, not rule-config/document-content-supplied paths. Out of this class entirely.                                                                                                                                                                                                                         |

  **Residual, updated after review — the gap above is now fixed, not left open.** The first
  version of this task left `reference.ts`/`graph/coverage.ts` on `escapesRoot`'s literal
  `..`-prefix check alone, reasoning that their candidates are internally-built and "can never be
  OS-absolute by construction." Review disproved that: a `..`-cancelling relative link (ordinary
  `../` segments, no crafted absolute text needed — e.g. `../c:/Windows/x.md` from `docs/a.md`)
  normalizes to a bare drive-absolute remainder (`c:/Windows/x.md`) that `escapesRoot` doesn't
  flag, and that `path.win32.resolve` then treats as absolute, ignoring `rootDir` entirely — the
  same class of bug as H-2, reachable from document content rather than config. `escapesRoot`
  itself is untouched; the new `candidateEscapesRoot` (`escapesRoot(...) || path.isAbsolute(...)`)
  is what `reference.ts`/`graph/coverage.ts` now call instead, closing this at all three
  `existsSync` call sites without changing behavior for any legitimate in-root candidate (a no-op
  on POSIX, where these candidates never carry a leading `/`).

  **Narrower residual, still out-of-scope:** `candidateEscapesRoot` does not repeat
  `resolvesOutsideRoot`'s deeper resolve-and-compare step (see the cross-drive fix above), so a
  candidate that normalizes to a bare drive-_relative_ remainder with no separator after the colon
  (e.g. `c:secret.md`) and lands on a drive different from `rootDir` still isn't caught at these
  three call sites — SEC-003's `template` is fully covered, since `resolvesOutsideRoot` does do
  that deeper check. Reaching this narrower form needs an attacker-authored document, a Windows
  host, and a `..`-cancellation that happens to leave a bare drive letter with no root separator;
  closing it would mean giving `reference.ts`/`graph/coverage.ts` the same
  `path.resolve`/`path.relative` round trip `resolvesOutsideRoot` does, for materially narrower
  gain than the fix above. Recorded here per "report the sweep honestly," left as-is, not fixed by
  this task.

  **Symlink residual, also unfixed and recorded honestly:** containment everywhere in this task is
  lexical only — a symlink that lives inside `rootDir` but resolves outside it still gets read by
  `loadTemplate`'s `readFileSync`, and the same gap applies to `reference.ts`/`graph/coverage.ts`'s
  `existsSync` calls (a symlink inside the root pointing outside it would report as "exists"
  without ever failing `candidateEscapesRoot`, which only inspects the lexical path string).
  `markdown/load-documents.ts` disagrees: it realpath-checks symlink targets against the root
  before following them (`:32-38`, `:137-146`). Exploiting any of this needs write access to the
  repository being linted (to plant the symlink), a materially different threat model than H-2's
  config/MCP-input vector. Left unfixed; making these call sites realpath-aware would mean
  matching `load-documents.ts`'s existing symlink containment rather than inventing another
  variant, a larger, separate change than this task's scope.

- **MCP `lint` tool description (deliverable 4)** now reads: paths are probed "inside the
  server's working directory" (not "relative to" it, which implied unchecked traversal), and an
  absolute or `..`-escaping relative path "is rejected rather than followed." The four substrings
  `packages/mcp-server/test/smoke.test.ts` asserts (`"Does not load project config"`,
  `"REF-001/REF-003"`, `"server's working directory"`) all remain intact, along with the absence
  of `"Reads no filesystem"`.
- **Tests** added: `packages/core/test/path-resolve.test.ts` (new — direct unit coverage of
  `resolvesOutsideRoot`, including Windows-only drive-absolute and cross-drive drive-relative
  cases gated with `it.runIf(process.platform === "win32")`; plus a new `candidateEscapesRoot`
  describe block covering the same shapes for the `reference.ts`/`graph/coverage.ts` guard);
  `packages/core/test/rules-sec.test.ts` (absolute escape, `..`-relative escape, and the
  in-root-but-excluded-from-corpus regression — each escape test plants a `## TopSecretSection`
  heading in the outside file and asserts it never appears in any finding, proving no content leak
  rather than only asserting an error message); `packages/core/test/primitives.test.ts` and
  `packages/core/test/graph-coverage.test.ts` (Windows-only regressions proving a `..`-cancelled
  drive-absolute link/image target is rejected by REF-001/REF-003/G5 instead of being treated as
  resolved, even when a real file exists at that host path — the same no-leak-style proof, applied
  to the review-round fix); `packages/mcp-server/test/lint.test.ts` (one absolute-path regression
  at the actual MCP attack surface the audit calls out, asserting the same no-leak property). No
  relative-`..`-escape test was added at the MCP layer: `handleLint` hard-codes
  `rootDir: process.cwd()` with no `cwd` override in `LintToolInput`, so that form isn't reachable
  there without adding new, unrequested MCP surface — the core-level test already covers it.
- **No CLI changes.** `packages/cli` never touches `template`/SEC-003 directly; `commands.ts`
  calls core's `lintFiles` unchanged, so the fix propagates automatically.
- **No config-schema/generated-docs regeneration.** `sec003`'s `optionsSchema` is unchanged, so
  `packages/cli/schema.json`, `schema-generation.test.ts`, and `docs-sync.test.ts` (which only
  checks `README.md`'s generated rule table, driven by rule metadata) are unaffected.
- **No glossary edit.** `template`'s public contract (repo-relative path to a reference file)
  doesn't change meaning — this is a containment bug fix, not a redefinition of a load-bearing
  term.
- **User guide updated alongside the fix**, per `AGENTS.md`'s hygiene rule — containment is now a
  documented part of the product's contract, not an undocumented internal check:
  - `docs/guide/rules/SEC-003.md` (`## Notes`) — a "Path containment" bullet stating the rejected
    forms plainly, including the two things a reader would otherwise be surprised by: _every_
    absolute path is rejected (even one pointing back inside the root — repo-relative is the
    contract), and a rejected path is indistinguishable from a nonexistent one on purpose, because
    a "was not found" answer for an out-of-root path is itself a host file-existence oracle. The
    symlink residual above is stated there too rather than left implied.
  - `docs/guide/mcp-server.md` (`## Boundaries`) — the bullet still said paths are probed
    "relative to the server's working directory", the exact pre-fix wording the audit flagged;
    it now matches the shipped tool description and names _why_ this boundary carries weight at
    the MCP surface specifically (the caller supplies the whole `rules` array).
  - `docs/guide/config-reference.md` — the `SEC-003.template` annotation now says repo-relative
    only, so the constraint is visible where a user actually writes the value.
  - `docs/guide/rules/REF-003.md` — gained the "targets that escape the repository root never
    resolve" note REF-001 already carried, since the class sweep extended the same guard to
    `imageResolves`.
