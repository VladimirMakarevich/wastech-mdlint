# P11.01 · Fix the CLI `bin` no-op through the npm symlink

> Phase: [P11 — Post-P9 remediation](index.md) · Roadmap: [v2 Index](../index.md) · Size **S–M** ·
> Status **Not started**. Audit finding **H-1** (release-blocking,
> [post-P9 audit](../audit-2026-07-25-post-p9.md)). Staged as
> [`tasks/pending/p11-01-cli-bin-noop.md`](../../../tasks/pending/p11-01-cli-bin-noop.md).

## Goal

`wastech-mdlint` must actually run when invoked the way users install it — `npx`, a local
`node_modules/.bin` shim, or a global `npm i -g`. Today it exits `0` having done nothing on
macOS/Linux.

## Problem (from the audit)

`packages/cli/src/index.ts:8-16` guards the entrypoint by comparing `path.resolve(process.argv[1])`
with `fileURLToPath(import.meta.url)`. `process.argv[1]` holds the **symlink** path; `import.meta.url`
resolves to the **realpath**; `path.resolve` does not dereference symlinks. npm/pnpm/yarn install a
`bin` as a symlink on POSIX, so the condition is never true and the process exits `0` without parsing
argv. Reproduced on the built `dist`:

```
$ ./node_modules/.bin/wastech-mdlint --version   → (no output)  exit=0
$ npx wastech-mdlint --version                    → (no output)  exit=0
$ node packages/cli/dist/index.js --version       → 0.0.0        exit=0
```

Blast radius: the CI workflow that `init` emits
(`packages/core/src/discovery/config-writer.ts:177` → `npx wastech-mdlint lint --fail-on error`)
passes green forever regardless of findings. Windows `.cmd` shims pass a real relative path and
likely work — a cross-platform divergence in a repo whose invariants mandate parity.
`packages/mcp-server/src/index.ts:52-57` has the same pattern. Root cause of it shipping: **no test
spawns the binary** — every test calls `runCli()` directly, so `src/index.ts` has 0% coverage while
130/130 CLI tests are green.

## Deliverables / steps

1. Fix the guard in `packages/cli/src/index.ts` to compare **realpaths** (e.g.
   `fs.realpathSync(invokedPath)`), keeping the `undefined`-argv guard and handling an
   `invokedPath` that does not exist on disk without throwing.
2. Apply the same fix to `packages/mcp-server/src/index.ts:52-57`, or document why it is unaffected.
3. Add the repository's **first process-level test**: spawn the installed bin through
   `node_modules/.bin/` (and the `.cmd` shim where the platform provides it) and assert real stdout
   and exit code for `--version` and a `lint` run with a known finding count. This is the regression
   guard — the fix without it re-opens the hole on the next refactor.
4. Confirm the still-correct behavior the guard exists for: importing `index.js` from a test must not
   execute the CLI as a side effect.

## Out of scope

Restructuring `program.ts` or the command surface. This task changes only the two entrypoint files
plus the new test, and adds no runtime dependency.

## Exit criteria

- [ ] `./node_modules/.bin/wastech-mdlint --version` prints the version and exits `0`.
- [ ] `npx wastech-mdlint lint <fixture-with-error>` exits non-zero and prints findings.
- [ ] `node packages/cli/dist/index.js --version` still works (no direct-path regression).
- [ ] Importing `packages/cli/dist/index.js` from a test does not run the CLI.
- [ ] A spawning test exists and fails if the guard regresses; it runs on `ubuntu`/`windows`/`macos`.
- [ ] `packages/mcp-server/src/index.ts` is fixed the same way or documented as unaffected.
- [ ] `npm run typecheck && npm run lint && npm run format && npm test && npm run build` green.
