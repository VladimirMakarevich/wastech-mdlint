# P18.04 — Host and packaging pins, and three stale test names

> Phase: [P18 — Follow-up burn-down](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Not started**. Depends on [P18.02](02-code-fixes.md) (FU-24 pins a branch that task also touches).
>
> Ten items in the CLI and MCP test suites, plus the packaging guard. Four are missing coverage, three are guards weaker than they read, three are names that describe a contract that has moved.

## Problem

**FU-24 — the `ENOTDIR` branch has no test.** In `resolveToolCwd`'s `stat(resolved).catch(...)` handler, the stdio and unit "exists but is a file" cases pass the file itself, which `stat`s successfully and is caught by `!stats.isDirectory()`. Nothing exercises a path **under** a file, the only way the errno arises.

**FU-25 — two host-parity guards are untagged and their file is uninventoried.** `it("reports the same nested coverage section in the human and JSON formats")` in `packages/cli/test/graph.e2e.test.ts` is new, and the widened `it("reports the same top-level path sections in the human and JSON formats")` sits beside it. Both match the `host-parity` definition exactly, but the file appears in neither `BOUNDARY_GUARDS["host-parity"]` in `packages/core/test/boundary-guards.test.ts` nor the `host-parity` row of `.agents/rules/testing.md`, so deleting them fails nothing — the drift the inventory exists to catch, and a miss against [P16.01](../P16-release-readiness/01-test-debt.md)'s exit criterion that every boundary guard is tagged.

**FU-26 — a step-order guard reads the whole module including comments.** In `describe("the ad-hoc lint step order lives in core, not in this handler")` (`packages/mcp-server/test/lint.test.ts`), the guard asserts `source.includes(step)` is `false` for `parseDocument`, `runRules` and `createSuppressionChecker` against the full file text. A future comment naming any of the three fails the suite with a message that reads like a step-order regression when nothing regressed — which is why the handler's current comment paraphrases them instead.

**FU-27 — a test title names a superseded four-key contract.** `it("prints { nodes, edges, components, readingOrder } as JSON to stdout")` in `packages/cli/test/cli.test.ts` — the graph JSON contract has six keys since [P15.02](../P15-output-contracts/02-graph-output-contract.md), which unified that key list across five documentation surfaces. The body still passes because it asserts individual fields.

**FU-28 — the completion-surface `STATUS` regex is not anchored.** `const STATUS = /Status \*\*([^*]+)\*\*/;` in `packages/core/test/plan-completion-surface.test.ts` matches the first occurrence anywhere in a file, prose included. Three plan files already quote a status in prose, one of them quoting `Status **Done**` while its own header reads `Not started`. Today every header comes first so the suite is green, but a file that loses its header status silently inherits a prose one — defeating the "declares a status on every index and task file" assertion and able to flip a derived index status without failing anything.

**FU-29 — the doc-URL guard pins only the path half.** The "resolves to a real page" test in `packages/core/test/registry-inventory.test.ts` strips `RULE_DOCS_BASE_URL` and checks the filename on disk, leaving the owner/repo/branch half of the constant unpinned. That half duplicates the root `package.json`'s `repository.url`, so a repository rename turns every finding's `helpUri` and all 24 README table links into 404s with the suite green.

**FU-30 — `readTarball` is untested binary parsing.** `packages/core/test/support/read-tarball.ts` is roughly 90 lines of hand-rolled ustar parsing, exercised only indirectly through `package-payload.test.ts`. Its dangerous failure is a **partial** map, not an empty one: a mid-walk header misread drops every later entry, and each dropped entry surfaces as `"<pkg> ships no <entry>"` — the reader's bug reported as a packaging defect. The positive control (`expect(payload().size).toBeGreaterThan(0)`) only catches a fully empty map. The whole guard's credibility rests on this reader, and it is the one artifact that could not be executed in review.

**FU-31 — cleanup can mask the real failure.** `afterAll(async () => { await rm(packDir, …) })` in `packages/core/test/package-payload.test.ts` runs unconditionally, but `packDir` is assigned by the first statement of `beforeAll`; if `mkdtemp` fails, `rm` throws a `TypeError` over the actual error.

**FU-32 — fifteen published README links resolve to nothing on disk.** The three package READMEs carry absolute `blob/main/<path>` links to guide pages and to each other. Because they are absolute URLs the REF rules skip them, so a renamed guide page rots them silently — on the npm page, the surface [P16.02](../P16-release-readiness/02-package-metadata.md) exists to make readable. `registry-inventory.test.ts` already guards this class for rule doc pages.

**FU-33 — a derivation keyed on a metavar can silently drop a handler.** `commandsAcceptingConfig()` in `packages/cli/test/config-resolution-base.test.ts` probes each command's help for the literal `"--config <file>"`. A future command declared `--config <path>` is dropped from the derived set, the equality assertion against the hand-written `ROWS` still passes, and the new handler is never parametrized — the silent uncoverage [P14.04](../P14-host-boundary/04-config-resolution-base.md)'s criterion 6 exists to prevent. Root help also hides hidden commands, so a future hidden command with `--config` is invisible to the derivation too.

## Deliverables / steps

- [ ] **FU-24:** in `packages/mcp-server/test/tool-context.test.ts`, write a file then call `resolveToolCwd({ cwd: path.join(filePath, "sub") })`, asserting `code === "INVALID_INPUT"` plus the path in the message. That file already has the `posix()` helper [P18.02](02-code-fixes.md) added, so compare through it. Assert only code, hint and path — Windows reports `ENOENT` for this shape, so both branches must satisfy one assertion.
- [ ] **FU-25:** add `// @boundary-guard host-parity` above the coverage-parity test in `packages/cli/test/graph.e2e.test.ts`, then add that file to the `"host-parity"` array in `packages/core/test/boundary-guards.test.ts` (sorted, before `packages/cli/test/lint.e2e.test.ts`) and to the `host-parity` row of `.agents/rules/testing.md`. If the renderer-level twin in `graph-render.test.ts` is deliberately untagged because it is not a host surface, leave it and say so.
- [ ] **FU-26:** narrow the haystack to the module's import block before the three `includes` checks, leaving `expect(source).toContain("lintContent")` as is.
- [ ] **FU-27:** rename to the shipped six-key set. No body change — the exhaustive pin lives in `packages/core/test/graph-render.test.ts`.
- [ ] **FU-28:** anchor to the header line: `const STATUS = /^> .*Status \*\*([^*]+)\*\*/m;`. All plan files carry their status on a `> …` header line, so this matches everything today and rejects prose mentions.
- [ ] **FU-29:** assert `RULE_DOCS_BASE_URL` starts with the GitHub origin derived from the root `package.json`'s `repository.url`, read with the same repo-root derivation the file already uses for `RULE_DOCS_DIR`.
- [ ] **FU-30:** add `packages/core/test/read-tarball.test.ts` assembling a small archive in memory dependency-free — 512-byte headers written by hand plus `gzipSync` from `node:zlib` — asserting: `prefix` + `/` + `name` joined for a split long path; the leading `package/` stripped; a directory entry (typeflag `5`) and a pax header (typeflag `x`) skipped while the next ordinary entry is still read; a body whose size is not a block multiple advancing correctly; and a non-octal size field throwing rather than returning a truncated map.
- [ ] **FU-31:** guard the cleanup with `if (packDir !== undefined)`.
- [ ] **FU-32:** scan each packed `README.md` for `blob/main/<path>` occurrences and assert each `<path>` exists under the repository root, reusing `RULE_DOCS_BASE_URL`'s repository prefix rather than re-spelling the URL.
- [ ] **FU-33:** match the flag independently of its metavar — `/--config\b/.test(await help([name, "--help"]))`. Verified safe: no other command's help text contains the token `--config`. Note in the comment that a hidden command must be added to `ROWS` by hand, since root help cannot surface it.
- [ ] **FU-75:** name what distinguishes the standalone `schema.json` suite in `packages/core/test/package-payload.test.ts`. Its title, `published payload of @wastech-mdlint/cli`, is no longer byte-identical to the `(W-29)`-suffixed one `describe.each` generates for the same package, so a failure is attributable — but it is still a prefix of it, so `-t` cannot select one alone. Rename it to state its subject, e.g. `published payload of @wastech-mdlint/cli — allowlist-only files (W-29)`.

## Exit criteria

- [ ] Every branch of `resolveToolCwd`'s rejection path has a test, portable across hosts.
- [ ] Deleting either graph host-parity assertion fails the boundary-guard inventory.
- [ ] Adding a comment that names a pipeline step does not fail the MCP step-order guard.
- [ ] No test title in the changed files names a contract that has moved.
- [ ] A plan file that loses its header status fails `plan-completion-surface.test.ts`.
- [ ] Renaming the repository fails a test rather than shipping 404s.
- [ ] `readTarball` has direct coverage for a partial-map failure, and `package-payload.test.ts` cleanup cannot mask a setup error.
- [ ] Adding a `--config` command with any metavar parametrizes the resolution-base suite or fails it.
