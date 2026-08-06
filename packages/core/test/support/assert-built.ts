import { existsSync, statSync } from "node:fs";

// The shared build precondition for every suite that spawns a built entrypoint: the three
// `installed-bin-spawn` guards (`packages/cli/test/bin.e2e.test.ts`,
// `packages/mcp-server/test/bin-entrypoint.test.ts`, `packages/mcp-server/test/stdio-integration.test.ts`)
// and the `host-parity` cross-host guard (`packages/mcp-server/test/host-parity.test.ts`, which spawns
// both). On a checkout whose source moved since the last build a stale artifact would otherwise
// surface as a confusing behavioral diff instead of "you did not build".
//
// W-56 (P16.01) is why the two near-identical copies became one helper. The defect was in the
// *message*, not the check: both told the reader to run `npm run build` / `npm run typecheck`, and
// both of those are `tsc -b`, whose up-to-date decision is content-aware. So when a source file's
// timestamp moved but its content did not — `git checkout --`, a stash pop, a copy that resets
// mtimes — `tsc -b` exits `0` without re-emitting, this comparison still fails, and the message
// names the command just run. Verified in this tree: touching `packages/cli/src/index.ts` forward
// left `npm run build` a no-op and the guard red; `npx tsc -b --force` re-emitted and cleared it.
//
// The check itself stays a modification-time comparison: comparing real build state would mean
// re-deriving `tsc -b`'s own `.tsbuildinfo` bookkeeping, which is a second implementation of the
// thing being verified. Naming the forced build as the fallback closes the harmful half — a message
// that names a command which does not fix the problem is worse than no message. Registered in
// `docs/mdlint_v2/accepted-behaviors.md`, and the remedy is stated for readers in
// `.agents/rules/testing.md` ("Build before test").
//
// Lives in core's test support directory for the same reason `large-corpus.ts` does: it is imported
// across the workspace, so it must import nothing from any package's `src`.

// One string, so the two suites cannot drift on the remedy again.
const REMEDY =
  "This suite spawns the compiled output, not the TypeScript source — run `npm run build` first. " +
  "If that does not clear this message, run `npx tsc -b --force`: `tsc -b` decides up-to-dateness " +
  "from content, so a source file whose timestamp moved without its content changing leaves " +
  "`dist/` untouched and this check still failing.";

/**
 * Throw unless `distPath` exists and is at least as new as `srcPath`.
 *
 * Called at module scope by both spawn suites so the failure arrives before any test runs, rather
 * than as a per-test spawn error.
 */
export function assertBuilt(distPath: string, srcPath: string): void {
  if (!existsSync(distPath)) {
    throw new Error(`Expected ${distPath} to exist. ${REMEDY}`);
  }

  if (statSync(srcPath).mtimeMs > statSync(distPath).mtimeMs) {
    throw new Error(`${distPath} is older than ${srcPath}. ${REMEDY}`);
  }
}
