import { compareStrings } from "../deterministic-sort.js";
import { LINTED_MARKDOWN_EXTENSIONS } from "../discovery/markdown-extensions.js";
import { DEFAULT_NOISE_DIR_NAMES } from "../discovery/repo-scan-constants.js";
import type { LintConfig } from "./config-schema.js";

// Corpus scope (P13.02 / W-02): the defaults that decide which files a run reads when the config is
// silent about it. Every corpus-consuming entry point — `lintFiles`, `applyFixes`, `loadContext` —
// resolves them here instead of spelling `config.include ?? [...]` a third time.
//
// These deliberately do NOT live in `loadDocuments`. That loader is public API whose contract is
// "what you pass is what I walk", and `test/gitignore-layers.test.ts` relies on it: that suite hands
// in an explicit `exclude` and compares the resulting corpus against real `git ls-files`, so a loader
// that silently added a dozen patterns of its own would make the oracle compare two different trees.
// The config layer is also where a user's own `exclude` arrives, which is what the extend rule on
// `resolveCorpusScope` has to reason about.
//
// Every comment here uses `//` rather than a `/** */` block on purpose: a glob such as the
// depth-agnostic prefix below contains `*` `*` `/`, which would close a block comment early.

// The default `exclude` — the scanner's own pruned noise directories as globs, and nothing else.
// One list with two consumers, deliberately: it is both what a fresh `init` writes (C1) and, since
// P13.02, what a run with **no config at all** excludes. Two lists that must agree is the shape of
// the next drift, so `discovery/config-writer.ts` imports this one.
//
// W-15, decided in P14.03: the scan's *other* prune — every dot-prefixed directory, by shape
// (`classifyPrunedDirName`, audit L-7) — is deliberately NOT mirrored here. The two questions have
// inverted failure modes. Over-pruning the scan is cheap: an unproposed cluster is one `include`
// edit away. Over-excluding the lint corpus is silent under-reporting — exit `0`, a plausible file
// count, and the documents most likely to matter never read. Measured on the field-test target,
// `**/.*/**` put 31% of the tracked corpus (`.claude/skills/`, `.agents/rules/`, two `.rules/`
// sets) outside a zero-config run; this repository has the same shape. What genuinely belongs in a
// lint-time default is the dependency and build trees that happen to be hidden — `.venv`, `.yarn`,
// `.git`, `.next`, `.cache` — and those are named in `DEFAULT_NOISE_DIR_NAMES`, which states the
// rule for future additions. `init` discloses the scan-only prune instead of encoding it
// (`formatScanExclusions`, W-14).
//
// The leading `**/` is load-bearing: `collectMarkdownFiles` prunes these by *basename at every
// depth* (`repo-scan.ts`), so only a depth-agnostic glob faithfully mirrors what the scan skipped —
// and on the lint path a root-anchored `<name>/**` default would reproduce the very monorepo
// under-exclusion this default exists to close (a nested `mobile/node_modules/` was 2740 of the
// field test's 3063 parsed files). The root-anchored form silently under-delivered on the same
// promise inside `init` already (audit M-4). A leading `**/` matches zero leading segments in
// picomatch, so a root-level `node_modules/` stays pruned too.
//
// Accepted tradeoff, now on every run rather than only after `init`: hand-written docs under a
// nested directory literally named `build`/`out`/`vendor`/… are pruned as well, and `exclude` wins
// over `include` (C1). The escape hatch is a negated entry naming the *directory* — see
// `resolveCorpusScope`.
//
// Sorted for a deterministic, set-like array (order is not meaningful among positive patterns).
export const DEFAULT_EXCLUDE_GLOBS: readonly string[] =
  DEFAULT_NOISE_DIR_NAMES.map((name) => `**/${name}/**`).sort(compareStrings);

// The zero-config `include` (C1): every linted Markdown file at any depth. Derived rather than
// spelled, so this and the repo scan cannot drift on what a Markdown file is (P13.05 / W-09) — the
// gap between the two is `LINTED_MARKDOWN_EXTENSIONS` being a declared subset of
// `MARKDOWN_EXTENSIONS`, i.e. `.mdx` is discovered by the scan and never linted by default.
export const DEFAULT_INCLUDE_GLOBS: readonly string[] =
  LINTED_MARKDOWN_EXTENSIONS.map((extension) => `**/*${extension}`);

// C8 keeps `respectGitignore` opt-in, and P13.02 re-decided it rather than inheriting it: a
// `.gitignore` is a commit-time statement, not a "do not lint this" one. Flipping it would put a
// *second* silent corpus-shrink mechanism on the zero-config path, days after P13.03 changed layer
// precedence — and the measured blow-up W-02 exists to close is already fully closed by the
// `exclude` default above. A fresh `init` still writes an explicit `true`, because its own scan
// really did skip those trees.
export const DEFAULT_RESPECT_GITIGNORE = false;

export type CorpusScope = {
  include: string[];
  exclude: string[];
  respectGitignore: boolean;
};

// Resolve the corpus scope a run walks: the config's own values where it has them, the defaults
// above where it does not.
//
// **A user `exclude` extends the default; it does not replace it.** Under replace, a config as
// ordinary as `"exclude": ["drafts/**"]` silently re-opens every `node_modules` tree — W-02 unfixed
// for exactly the users who engaged with the key, and silent in every direction (exit `0`, a
// plausible file count). Under extend the blocker cannot come back, and the escape hatch already
// exists: `matchesConfigGlob` evaluates the list **in order** and a leading `!` subtracts (P13.01),
// so a user entry can negate any default. The cost, documented in `docs/guide/configuration.md`:
// *deleting* a default entry from your config has no effect — negate it instead, and `"!**"`
// disables the default wholesale, while `"exclude": []` is not an opt-out.
//
// Default-first order is what makes that work: a negation only subtracts from what precedes it.
//
// Deduped by first occurrence so an `init`-written config — whose `exclude` *is* this list — still
// resolves to exactly these patterns rather than each one twice. `Set` keeps the first insertion,
// and a duplicate here is an identical positive pattern, so which copy survives is immaterial.
//
// Returns fresh mutable arrays: callers pass them straight into `loadDocuments`'s `string[]`
// parameters, and a shared constant must not be reachable for mutation from there.
export function resolveCorpusScope(config: LintConfig): CorpusScope {
  return {
    include: [...(config.include ?? DEFAULT_INCLUDE_GLOBS)],
    exclude: [
      ...new Set([...DEFAULT_EXCLUDE_GLOBS, ...(config.exclude ?? [])]),
    ],
    respectGitignore: config.respectGitignore ?? DEFAULT_RESPECT_GITIGNORE,
  };
}
