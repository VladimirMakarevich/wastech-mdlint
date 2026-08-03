# P9.06 · Fix and enforce the Prettier format gate

> Phase: [P9 — Post-audit remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S** · Status **Done**. Audit finding **M-6** ([report](../audit-2026-07-23-p0-p8.md)).

## Goal

Make `npm run format` meaningful: either green and enforced, or explicitly retired — not a documented gate that is silently red across the repository.

## Problem (from the audit)

`npm run format` (`prettier --check .`) reports **~203 files** with style issues, while `.github/workflows/ci.yml`'s `verify` job runs `typecheck`/`lint`/`test`/`build` but **not** `format`. So the gate documented in `AGENTS.md` and `.agents/rules/testing.md` is red repo-wide and unenforced.

## Deliverables / steps

1. Run `npx prettier --write .` to normalize the tree (review the diff — it should be pure formatting; no behavioral changes).
2. Confirm `.prettierignore` covers generated/vendored artifacts that should not be formatted (currently `dist`, `coverage`, `.vitest`, `packages/**/dist`); extend if the write touches files that should be excluded (e.g. committed generated `schema.json`, if intentionally raw).
3. Add `npm run format` to the CI `verify` job so drift fails fast.
4. Alternative (if the team decides formatting is not a gate): remove the `format` expectation from `AGENTS.md`/`.agents/rules/testing.md` so docs and reality agree. Do **not** leave it documented-but-unenforced.

## Exit criteria

- [x] `npm run format` exits 0 on a clean checkout, **or** the format gate is explicitly removed from the rules docs.
- [x] If kept: CI enforces `format`; the normalizing commit is formatting-only.
- [x] No behavioral change from the reformat (tests still green).

## Implementation notes

- **Enforced, not retired.** `npm run format` (`prettier --check .`) now exits 0, and the CI `verify` job runs it alongside `typecheck`/`lint`/`test`/`build` (`.github/workflows/ci.yml`), so drift fails fast on every OS in the matrix.
- **`packages/cli/schema.json` stays raw.** It's `JSON.stringify(schema, null, 2)` output (`packages/core/src/engine/schema.ts`), byte-compared against the shipped file by a dedicated test (`schema-generation.test.ts`, R6). Prettier's JSON printer collapses short arrays onto one line, which would desync the two — so the file is excluded via `.prettierignore` rather than reformatted.
- **The two generated README tables (rule table, MCP tool inventory) needed the same treatment, one level down.** `generateRuleDocs()`/`generateToolInventory()` return raw, unpadded Markdown-table strings that two more byte-sync tests (`packages/core/test/docs-sync.test.ts`, `packages/mcp-server/test/docs-sync.test.ts`) compare against the README verbatim; Prettier's Markdown printer pads table columns for readability, which would desync those tables the same way full-file exclusion would have desynced `schema.json`. Excluding all of `README.md` would have thrown out formatting for the file's mostly hand-written prose, so instead `scripts/generate-docs.mjs` now wraps each generated block in a `<!-- prettier-ignore -->` comment (with a trailing blank line before the `END` marker), and the two tests' extraction regexes skip over that wrapper when pulling out the byte-compared table. This keeps the wrapper self-reproducing: a future `npm run generate:docs` regenerates the same Prettier-safe shape, so the gate does not go red again the next time the tables change.
- **Agent/orchestrator tooling excluded, not reformatted.** `.worc/`, `.claude/`, and `AGENTS.md` are outside this change's write access (orchestrator-managed paths for the session that made this change); they're excluded via `.prettierignore` rather than left silently failing the gate. `AGENTS.md` needs only a trailing newline — worth fixing in a follow-up once something with write access to it runs `prettier --write`, at which point that ignore line can be dropped.
- **Added `.gitattributes` (`* text=auto eol=lf`).** Prettier's `endOfLine` default is `"lf"`, and `--check` compares against the file as actually checked out; Git for Windows' default `core.autocrlf=true` would otherwise convert the checkout to CRLF, making the new CI step spuriously red on `windows-latest` over a checkout artifact rather than real style drift. All tracked files were already LF, so this changes no committed bytes.
- **Reformat commit is `prettier --write .` plus the wrapper/config changes above; no logic changed.** `npm run typecheck`, `npm test` (587 tests), `npm run build`, and `npm run lint` all stay green.
