---
name: "wastech-mdlint-init"
description: "Bootstrap wastech-mdlint in a repository: run the CLI init to scan and infer a config, install the CLI, lint once, then offer a CI workflow and a README section. Use when a repo has no wastech-mdlint.config.json yet or the user asks to set up, adopt, or onboard wastech-mdlint."
license: "MIT"
compatibility: "Version-coupled to @wastech-mdlint/cli: use the CLI release carrying the same version tag as this skill (both ship from one P9 single-tag release; do not mix tags)."
metadata:
  homepage: "https://github.com/VladimirMakarevich/wastech-mdlint"
  source: "https://github.com/VladimirMakarevich/wastech-mdlint"
---

# Bootstrap wastech-mdlint

This skill sets up wastech-mdlint in a repository. It **orchestrates** the CLI's
`init` command — it does **not** infer configuration itself. The CLI's `init`
already owns repository scanning, Markdown-cluster detection, file sampling,
rule-category suggestion, package-manager detection, and `$schema` wiring. Your
job is to drive that command, relay what it reports, and layer two things the CLI
does not decide on your behalf: an optional CI workflow and an optional README
section.

Run the steps in order. Running `init`, installing the CLI, and the first `lint` are the
mandatory bootstrap — carry them through once the user confirms the draft. Only the last two
steps are ask-first: the optional CI workflow and the README edit.

## 1. Check for an existing config

Mirror how `init` resolves a config: start from the requested target directory and
walk up its ancestors, since `init` may re-root to a config found above the target
(and a nested `docs/` or `packages/foo/` can carry its own `wastech-mdlint.config.json`).
Report the actual existing config path you find rather than assuming a root filename.
Tell the user what you found. Do **not** decide the disposition yourself: `init`
handles overwrite / merge / skip, and it is the single owner of that choice.

## 2. Run the CLI `init` transiently

Run `init` through a transient package runner **before** installing the CLI as a
dependency — this resolves the chicken-and-egg where the config should exist before you
commit to a persistent install. Because the CLI is not installed yet, use a runner that
downloads and runs it without a separate confirmation prompt.

**Pin the CLI to this skill's version.** The skill and CLI ship from one tag (see the
`compatibility` field), so a bare `@wastech-mdlint/cli` — which resolves to whatever is
latest at run time — can pull an incompatible newer CLI even from a pinned skill install.
In every command below, `<skill-version>` means the version tag of _this_ skill release
(the tag you installed it with); always request `@wastech-mdlint/cli@<skill-version>`:

- npm: `npx -y @wastech-mdlint/cli@<skill-version> init` (the `-y` skips npx's own install confirmation).
- pnpm: `pnpm dlx @wastech-mdlint/cli@<skill-version> init`
- yarn (Berry / 2+): `yarn dlx @wastech-mdlint/cli@<skill-version> init`
- bun: `bunx @wastech-mdlint/cli@<skill-version> init`

`init` only detects (or asks about) the package manager once it is already running, so for
this first invocation you must pick the runner yourself — using the _same_ lookup directory
and lockfile priority the CLI uses, so you never bootstrap with one manager and have `init`
later report another.

First determine the **effective init root** — the directory `init` will actually scan and
detect against, which is _not_ necessarily the repository root: it is the parent directory
of the existing config you found in step 1 (`init` re-roots there), or, when no config
exists, the target directory itself. Then choose the runner by checking lockfiles in **that
directory only**, in this priority order (the first match wins):

1. `bun.lock` or `bun.lockb` → bun
2. `pnpm-lock.yaml` → pnpm
3. `yarn.lock` → yarn
4. `package-lock.json` → npm

**Yarn classic (1.x) has no `yarn dlx`** — detection only tells `yarn` from `yarn.lock`,
not the major version, so if `yarn dlx` is unavailable use
`npx -y @wastech-mdlint/cli@<skill-version> init` for this transient step and keep the
persistent install (step 4) on Yarn. If that directory
has no lockfile, ask the user which manager to use; absent an answer, fall back to `npx -y`
(npm ships with Node, so it is the safe default). Carry that one choice through the install
(step 4) and lint (step 5) so the whole flow stays on one package manager.

**Run everything from the effective init root.** The effective init root you just computed is
also the correct package-manager root — a nested `packages/foo/` may have its own lockfile and
`package.json`, and installing/linting from the repository root instead would mutate or resolve
the wrong project. So `cd` into that directory once and run **every** command in steps 2–6 from
there: the transient `init`, the install, `lint`, and the CI rerun. This keeps the package
manager, the written config, and the lint scope all anchored to one directory.

Because that directory _is_ the target, `init` needs no `[path]` argument (its default is the
current directory), and the config `init` writes lands at this cwd, so `lint` finds it by its
normal walk-up with no `--config` flag. Only pass `--config "<path>"` (shell-quoted, since a
path may contain spaces) if you deliberately run from somewhere else.

`init` is interactive by default and prompts for its own decisions (existing-config
disposition, clusters, categories, package manager, draft confirmation). For a
non-interactive or CI environment, pass `--yes`; then `--on-existing <overwrite|merge|skip>`
selects how an existing config is handled and `--with-ci-workflow` writes the CI
workflow without prompting.

Do not re-implement any of this inference. If the user asks "what rules should we
use?", the answer is "whatever `init` infers from the repository" — let the command
decide.

## 3. Relay the draft and let the user confirm

`init` prints a deterministic draft summary (existing-config disposition, package
manager, include globs, and rules grouped by category with per-rule rationale).
Surface that summary to the user and let them confirm through the command's own
prompt (or via `--yes`). Do not paraphrase the rule set as if it were your own
recommendation.

## 4. Install the CLI as a dev dependency

**First check that `init` actually wrote a config** — it has two legitimate no-write
outcomes, and steps 4–6 assume a confirmed draft and a package-manager report that neither
produces:

- `skipped — existing config left untouched.` — the user chose `skip`, so `init` returned
  before it ever scanned or detected a package manager. Stop and ask the user whether to
  continue against the _existing_ config (if so, you have no `init` report, so pick and
  install the package manager from the step-2 lockfile check / their answer) or to rerun
  `init` with `overwrite`/`merge` first. Do not fabricate a draft.
- `Not written: ... could not be read, parsed, or validated` — a `merge` aborted, so there
  is still no valid config. Stop and tell the user to fix or remove the existing config, or
  rerun with `overwrite`, before continuing.

Once a config was written, install `@wastech-mdlint/cli` as a development dependency using
the package manager that `init` detected (reuse its report rather than detecting again).
Pin the same `<skill-version>` as step 2 so the installed CLI matches this skill release:

- npm: `npm install -D @wastech-mdlint/cli@<skill-version>`
- pnpm: `pnpm add -D @wastech-mdlint/cli@<skill-version>`
- yarn: `yarn add -D @wastech-mdlint/cli@<skill-version>`
- bun: `bun add -d @wastech-mdlint/cli@<skill-version>`

If `init` reports `Package manager: not detected.` (a repository with no lockfile — a
supported case), it has nothing to reuse. Use the same package manager you settled on in
step 2 (the user's answer, or the `npx`/npm fallback) for both this install and the lint
in step 5.

## 5. Lint once

Still in the effective init root from step 2, run the linter once to confirm the setup works
end-to-end. Invoke it through the same package manager so the installed CLI is resolved
portably — there is no reliable bare `wastech-mdlint` binary on `PATH`, and `npx` is
npm-specific:

- npm: `npx wastech-mdlint lint`
- pnpm: `pnpm exec wastech-mdlint lint`
- yarn: `yarn wastech-mdlint lint`
- bun: `bunx wastech-mdlint lint`

The config `init` wrote sits at this cwd, so `lint` finds it by its normal walk-up — no
`--config` flag needed as long as you stay in this directory.

Findings on real, not-yet-clean content are expected here — a non-empty result is a
working linter, not a failed setup. Only a crash or a config-load error indicates a
problem to fix.

## 6. Offer a CI workflow — ask first

The default flow leaves CI out of the initial `init`: on the interactive run in step 2,
decline its CI-workflow prompt, and on a non-interactive run omit `--with-ci-workflow`.
CI is offered here, after lint has proven the setup works.

Now ask whether the user wants a GitHub Actions workflow that runs `wastech-mdlint lint`
on push and pull request. If they accept, **route the workflow through the CLI** — do
not hand-author the workflow YAML. The CLI is the single source of truth for it, and it
will not overwrite an existing `.github/workflows/wastech-mdlint.yml`.

Because the config already exists by now, adding CI means rerunning `init` (from the same
effective init root) so its config-write branch runs — the workflow is only written on that
branch. Run it through the CLI **installed in step 4** — not a transient `dlx`/`npx` fetch,
which could pull a different build and rewrite the config/workflow with an unpinned version.

**How you rerun depends on how step 2 ran, because `--yes` is not workflow-only** — it
auto-selects _all_ detected clusters and _all_ inferred categories, so a `--yes` rerun would
append extra rules under `merge` or regenerate a broader config under `overwrite`, silently
undoing any narrowing the user did:

Whatever the rerun, **reuse the same existing-config disposition the first `init` used**
unless the user explicitly wants to change the config now. `merge` and `overwrite` are not
interchangeable: `merge` only appends new rules and leaves the existing `include` / `exclude`
/ `settings` and rule options untouched, while `overwrite` rebuilds the whole config from
inference and drops anything the earlier run preserved. So if the first run merged, rerun with
`merge`; switching to `overwrite` just to add CI would silently discard preserved config.
(When there was no existing config at all, the first run was a fresh write — treat a rerun the
same as `overwrite` since there is nothing to preserve.)

- **If step 2 used `--yes`** (or the user accepted the full default draft unchanged), a
  non-interactive rerun reproduces the same draft, so it is safe. Here `--on-existing`
  applies (the CLI only consults that flag under `--yes`) — pass the disposition the first
  run used:
  `npx wastech-mdlint init --yes --with-ci-workflow --on-existing <same disposition as step 2>`
  (or `pnpm exec` / `yarn` / `bunx` in place of `npx`).
- **If step 2 was interactive and the user customized the draft** (deselected clusters or
  categories), do **not** use `--yes` — and note `--on-existing` is _ignored_ without it. Rerun
  `init` interactively (`npx wastech-mdlint init`), repeat the _same_ cluster/category choices,
  and when it prompts for the existing config answer with that same first-run disposition (the
  interactive default is still `skip`, which writes no workflow), then accept the CI-workflow
  prompt. If you cannot faithfully reproduce those choices, stop and ask the user rather than
  risk regenerating a different config.

Either way, the rerun rewrites or merges the config before the workflow is written, so confirm
that disposition with the user first.

## 7. Offer a README section — ask first

Ask whether the user wants a short wastech-mdlint section added to their `README.md`.
If they accept, add a concise, host-neutral section documenting how to install this
skill and run the linter, for example:

```markdown
## Markdown linting

This repository uses [wastech-mdlint](https://github.com/VladimirMakarevich/wastech-mdlint)
to lint its Markdown.

- Install this bootstrap skill (pin to a release so the skill and CLI stay on one tag): `gh skill install VladimirMakarevich/wastech-mdlint wastech-mdlint-init --pin vX.Y.Z`.
- Lint: run via your package manager — `npx wastech-mdlint lint` (npm), `pnpm exec wastech-mdlint lint`, `yarn wastech-mdlint lint`, or `bunx wastech-mdlint lint`.
- Configuration lives in `<config path init reported>` (the repository-relative path from `init`'s write summary — often `wastech-mdlint.config.json` at the root, but a subdirectory target lands elsewhere, e.g. `docs/wastech-mdlint.config.json`).
```

If the user also wants the CLI-package install noted, keep it secondary and pinned to the
same release tag as the skill (`npm install -D @wastech-mdlint/cli@vX.Y.Z`, or the
equivalent for their package manager) so the CLI and skill stay on one version.

## Next steps to mention

Once the repo lints cleanly, point the user at the companion skills for day-to-day use:
`wastech-mdlint-impact` to scope the blast radius of a change, and `wastech-mdlint-fix`
to apply fixes. Keep these as pointers — this skill's job ends at a working `lint`.
