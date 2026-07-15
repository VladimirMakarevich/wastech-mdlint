---
name: "wastech-mdlint-fix"
description: "Fix wastech-mdlint findings in a repository: run the CLI lint, apply the deterministic core --fix for the mechanically fixable rules, then handle the remaining findings by rule family with AI edits or user confirmation. Use when the user asks to fix, clean up, or resolve wastech-mdlint lint findings in their Markdown."
license: "MIT"
compatibility: "Version-coupled to @wastech-mdlint/cli: use the CLI release carrying the same version tag as this skill (both ship from one P9 single-tag release; do not mix tags)."
metadata:
  homepage: "https://github.com/VladimirMakarevich/wastech-mdlint"
  source: "https://github.com/VladimirMakarevich/wastech-mdlint"
---

# Fix wastech-mdlint findings

This skill resolves wastech-mdlint lint findings. It is a **policy layer** over the
CLI, not a second linter: mechanical, deterministic corrections are delegated to the
CLI's own `lint --fix`, and only the judgement calls the core engine deliberately does
**not** auto-fix are handled here — some by an AI edit, some only after the user
confirms. The dividing line between "core fixes it" and "you handle it" is not baked
into this skill; you **read it from the repository** (see step 3). This keeps the skill
correct as the rule set evolves.

Run the steps in order.

## 1. Verify setup

This skill assumes wastech-mdlint is already installed and configured. Confirm a
`wastech-mdlint.config.json` exists: start from the working directory and walk up its
ancestors (a nested `docs/` or `packages/foo/` can carry its own config, and `lint`
resolves the config by the same walk-up). If none exists, stop and point the user at the
`wastech-mdlint-init` skill to bootstrap first — do not hand-write a config here.

Run every command below from the directory that owns the config you found, so the lint
scope, the `--fix` writes, and the confirming re-lint all anchor to one project.

Invoke the CLI through the repository's package manager — there is no reliable bare
`wastech-mdlint` binary on `PATH`, and `npx` is npm-specific. Pick the form matching the
lockfile in the config's directory (`bun.lock`/`bun.lockb` → bun, `pnpm-lock.yaml` →
pnpm, `yarn.lock` → yarn, `package-lock.json` → npm):

- npm: `npx wastech-mdlint <args>`
- pnpm: `pnpm exec wastech-mdlint <args>`
- yarn: `yarn wastech-mdlint <args>`
- bun: `bunx wastech-mdlint <args>`

The examples below use the npm form; substitute your package manager's form throughout.

Then confirm both prerequisites before running the real flow, so a predictable setup gap
fails here with a clear message instead of as an opaque shell error mid-flow:

- **No lockfile in the config's directory.** The runner mapping above has nothing to key
  on, so do not silently assume one — ask the user which package manager should run the
  CLI, and carry that choice through every command below.
- **The CLI does not resolve.** Verify the chosen runner can actually execute the CLI
  (e.g. `npx wastech-mdlint --version`, or the `pnpm exec`/`yarn`/`bunx` equivalent). If
  it cannot — a missing or unbuilt install — stop and route the user to the
  `wastech-mdlint-init` skill; this fix skill does not install the CLI itself.

## 2. Assess the findings

Run the linter in JSON mode so you can reason about findings structurally rather than
scraping human-readable output:

```
npx wastech-mdlint lint --format json --fail-on off
```

`--fail-on off` matters throughout this flow: the linter's default is `--fail-on error`,
which makes it exit with code 1 whenever any error-severity finding remains — the normal
starting (and often ending) state of a fix session. A host that treats a non-zero shell
exit as a hard failure would otherwise abort before you parse the output or reach the
manual-fix steps. `off` forces exit code 0 so the run always completes and you judge
success from the findings, not the exit code. (If your host already continues on exit
code 1 and still captures stdout, the flag is harmless.)

The JSON payload has a `summary` (`files`, `errors`, `warnings`), a flat `messages`
array, and a `files` list. Every message carries `ruleId`, `severity` (`error` or
`warning`), `filePath` (repository-relative POSIX path), `line`, and `message`. Other
structured fields — `column`, `endLine`, `fixable`, `data`, `helpUri` — are optional and
appear only when relevant, so a file-level finding may omit `column` entirely; do not rely
on them always being present.
Group the messages by their `ruleId` **prefix** (the family before the number, e.g.
`SEC`, `REF`, `TBL`, `CTX`) — the fix policy is per family, so this grouping drives the
rest of the flow.

## 3. Apply the core `--fix` for mechanical findings

Let the CLI apply every deterministic fix it owns, and capture the result as JSON in the
same run:

```
npx wastech-mdlint lint --fix --format json --fail-on off
```

`--fix` writes corrected files in place and then re-lints, and with `--format json` that
re-lint is what the command prints. Treat this output as the **post-fix remainder** — the
authoritative "what is still wrong after core did its part" snapshot. It is a distinct
state from the step-2 baseline, and the difference is not cosmetic: a `--fix` can _surface
new findings_ that the baseline never had. For example, `SEC-001` fixes a missing section
by appending a `TODO` scaffold heading, which `CTX-001` then legitimately flags as a
placeholder-only section. Working from this post-fix snapshot (not the baseline) is what
keeps those newly surfaced findings from being missed in step 4.

`--fix` is deliberately narrow: it applies a fix **only** for rules that are
document-scope **and** ship a deterministic fix function. Project-scope rules never
contribute fixes (a fix edits one document's text), and document-scope rules without a fix
function are left untouched.

**Read which rules those are — do not assume or hardcode a list.** The authoritative
per-rule fix support is the generated rule table in the repository's `README.md`, between
the `<!-- BEGIN GENERATED RULES -->` and `<!-- END GENERATED RULES -->` markers. The
`Fixable` column is the source of truth: rows marked `yes` are exactly what `--fix`
resolves; everything else falls to step 4. That table is generated from rule metadata and
kept in sync by a docs test, so it stays honest as rules are added or change. No CLI or
MCP command prints it, so read the committed `README.md` file directly.

For orientation only — verify against the table, do not trust this as current — the
`yes` set has historically been `SEC-001` (insert a missing required-section heading
scaffold) and `TBL-002` (fill an empty target cell with a TODO marker).

## 4. Handle the remainder by rule family

Everything the `Fixable` column does **not** mark `yes` is this skill's own policy layer,
not core's job. Never route these through `--fix` (they are inert there anyway). Work from
the **step-3 post-fix remainder**, not the step-2 baseline — that snapshot already
excludes what core fixed and already includes anything `--fix` newly surfaced (e.g. the
`CTX-001` placeholder from a `SEC-001` scaffold), so it is the correct input to this
manual step. For each family still present in the post-fix remainder, apply the matching
policy:

- **SEC-002** (sections out of required order), **SEC-003** (headings diverge from a
  reference template): `Fixable: no`. Reordering sections or restructuring against a
  template is a judgement call — propose the specific edit and let the user confirm before
  applying it.
- **REF-001 / REF-002 / REF-003** (a relative link, link anchor, or image target that does
  not resolve): fix an obvious typo when the intended target is unambiguous. When the target
  is genuinely missing — no plausible file, heading, or slug to point at — **ask** the user
  rather than inventing one.
- **REF-004** (a cross-zone link not declared in the zone's `Dependencies` section): the
  link itself is usually correct; what's missing is the declaration. Propose adding the
  dependency to the `Dependencies` section and confirm with the user before editing — do
  not "fix" it by removing or rewriting the link.
- **REF-005** (IDs not traceable between definitions and references): distinguish the two
  cases. A dangling reference (points at an ID that has no definition) is a possible typo —
  fix it only if the intended ID is unambiguous, else **ask**. A missing or orphaned
  definition is a content gap, not a typo: **ask** the user what the definition should be
  rather than fabricating one.
- **REF-006** (a reference depends on a less-stable entity): this is a stability-tier
  judgement, not a broken target. Surface the mismatch and let the user decide whether to
  restructure the dependency or adjust the stability declaration; never treat it as a
  target-typo fix.
- **TBL-\*** other than TBL-002 (missing required columns, disallowed cell values, pattern
  mismatches, cross-column conditionals, duplicate IDs): **ask**. Only the empty-cell case
  (TBL-002) is a mechanical core fix; the correct value for a populated-but-wrong cell is
  a content decision.
- **CTX-\*** (non-empty/placeholder sections, checklist completeness `CTX-002`, canonical
  glossary terms), **GRP-\*** (cycles, orphan documents, ID carry-forward), **LLM-\***
  (token budget), **SIZE-\*** (byte/line/token budgets), **STR-\*** (required files exist):
  require user confirmation or are not auto-fixable — checking a checklist item, deleting
  content to fit a budget, or creating a required file all change meaning, so surface them
  and let the user decide. (Note: checklist completeness is `CTX-002`; there is no `CHK`
  family.)
- **Custom / unrecognized rule IDs** (a repo can define declarative custom rules with its
  own IDs, e.g. `REQ-OWNER`, that match none of the families above and won't appear in the
  README table): treat these as the default-deny case. Core never auto-fixes a custom rule,
  so never route them through `--fix`; surface the finding's `message` and let the user
  decide the correction as a judgement call.

Frame this as: consult the README `Fixable` column, and anything not `yes` follows this
escalation policy. If the table's `yes` set has grown, prefer the CLI's `--fix` for those
new rows too — the mechanism, not the illustrative list, is what governs.

## 5. Confirm and summarize

Re-run the linter to capture the final state, after your step-4 edits:

```
npx wastech-mdlint lint --format json --fail-on off
```

You now have three snapshots to reason from: the **baseline** (step 2), the **post-fix
remainder** (step 3), and this **final re-lint**. Build the summary from findings, not
from a claim about changed files — the `lint` JSON contract emits `summary`, `messages`,
and `files`, but no list of which files `--fix` rewrote (the CLI computes that internally
and does not surface it). Attribute each bucket to the right snapshot pair so core's work
and your manual work are not conflated:

- **Auto-fixed by core** — findings present in the **baseline** but gone from the
  **post-fix remainder**, grouped by rule family. That baseline→post-fix delta is exactly
  what `--fix` resolved. Their `filePath`s are the affected files, derived from the
  resolved findings rather than a separate changed-files list.
- **Fixed manually** — findings present in the **post-fix remainder** but gone from the
  **final re-lint**: what your step-4 edits resolved. Keeping this separate from the core
  bucket is why the post-fix snapshot is needed — without it, manual fixes would be
  miscredited to `--fix`.
- **Needs attention** — findings still present in the **final re-lint**, grouped by rule
  family, with your proposed edit or the question you need answered for each. This
  correctly includes anything `--fix` newly surfaced that you did not resolve.

Report counts honestly against these snapshots; do not claim a family is resolved if the
final re-lint still reports it.

## Next steps to mention

Point the user at the companion skills for day-to-day use: `wastech-mdlint-init` to set
up or reconfigure the linter, and `wastech-mdlint-impact` to scope the blast radius of a
change before editing. Keep these as pointers — this skill's job ends at a summarized,
re-linted result.
