# P6.03 · Interactive prompts + `--yes`

> Phase: [P6 — init](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Drive the init flow interactively (and non-interactively for CI), confirming the inferred
config before writing.

## Sequence

- **Previous:** [P6.02 — Rule inference](02-rule-inference.md) (draft rule set + rationale).
- **Next:** [P6.04 — Config writer](04-config-writer-schema.md).
- **Depends on:** P6.02. **This task adds `@inquirer/prompts`** to `@wastech-mdlint/cli` —
  [P0.05](../P0-foundations/05-cli-package-commander.md) only *reserved* it for P6 and never
  installed it (the CLI currently depends on `commander` alone), so add the dependency here.
  · **Blocks:** P6.04.

## Deliverables / steps

1. Prompts (via `@inquirer/prompts` — add it to the `cli` package here, [D5](../index.md)):
   include patterns (pre-filled from clusters), rule categories (pre-checked from inference),
   and confirmation of the draft with per-rule rationale. (The "language" prompt named in this
   task's original wording and the phase-index exit criteria is confirmed dead text — no
   locale/site-router concept exists to prompt for; not implemented.)
2. `--yes` non-interactive mode: accept the inferred draft without prompts (for CI / the
   `-init` skill orchestration).
3. Handle existing config: **overwrite / merge / skip** (semantics decided 2026-07-02, audit —
   P6 merge gap):
   - **overwrite** — replace with the freshly inferred config (after confirmation);
   - **merge** — *additive, existing-wins*: keep every existing `rules[]` entry verbatim
     (severity/options preserved), append only inferred rules whose canonical ID is absent;
     leave `include`/`exclude`/`settings` untouched (optionally offer to add newly-detected
     clusters not already covered). **Never modify or drop an existing entry.**
   - **skip** — write nothing.
4. Ctrl+C exits gracefully with code 0.

## Decisions applied

- [D5](../index.md) inquirer · [I2](../requirements/06-installation.md) confirm-with-rationale.

## Implementation notes

- `runInitCommand` returns the draft as `output` only on the `--yes` path; a confirmed interactive
  run returns `""`. `confirmDraft` is the one place the draft is shown interactively (it writes the
  summary, then prompts), so echoing it again from the return value would print it twice — the
  asymmetry is deliberate, not an oversight.
- When `[path]` resolves to a subdirectory of a repo whose config lives at an ancestor directory,
  the whole flow — scan, inference, existing-rule diffing, and the config path in the printed
  summary — re-roots to that config's own directory rather than the originally-passed path. Without
  this, the preview would show a `../`-relative config path, miss a lockfile that only exists at
  the real root, and infer include globs/rule scopes relative to the wrong directory even though
  the config being overwritten/merged governs the whole repo.
- Every interactive prompt's own default (what pressing Enter without choosing resolves to) mirrors
  the matching `--yes` default: `resolveExistingConfigAction` defaults to
  `DEFAULT_EXISTING_CONFIG_ACTION` (`"skip"`, the same constant `--yes`'s fallback uses), and
  `choosePackageManager` defaults to the `undefined` / "none of these" choice. `@inquirer/select`
  otherwise silently defaults to the first listed choice, which would make a blind Enter resolve to
  the destructive `"overwrite"` or invent a package manager the scan never detected. The exit
  criteria's "`--yes` produces the same ... without prompts" reads as a statement about explicit
  answers; it applies just as much to a prompt's own unchosen default.
- The non-interactive-terminal guard checks both `stdin` and `stdout`, not just `stdin`:
  `@inquirer/prompts` reads keystrokes from one and renders to the other, so a piped/redirected
  `stdout` paired with a TTY `stdin` is exactly as unusable interactively as neither being a TTY.
- A `merge` preview never renders an `Include (...)` section, even when clusters were scanned —
  merge is additive/existing-wins and must never touch `include`/`exclude`/`settings` (see
  Deliverables #3 above), so showing scanned clusters there would incorrectly imply `include` is
  part of the change. The preview instead states those keys are left unchanged.
- `readExistingRuleIds` treats an existing config's `rules` key as three distinct cases: absent
  (a known fact — zero existing rules, `parsed: true`), present but not an array (structurally
  invalid, `parsed: false`), and unreadable/unparsable (`parsed: false`). Collapsing the first two
  would let a merge preview present a diff against a malformed config as if it were verified.
- `createInquirerPrompter` renders every prompt — not only the final confirmation — through the
  CLI's own injected `stdout`, wrapped in a `node:stream` `Writable`: `@inquirer/prompts`' context
  argument wants a full `NodeJS.WritableStream`, while the CLI's own IO seam is deliberately
  narrowed to just `write()` (mirroring `CliIo.stdout`), so the wrapper bridges the gap without a
  cast.

## Exit criteria

- [x] Interactive flow works; `--yes` produces the same draft preview without prompts.
- [x] Existing-config handling + graceful Ctrl+C verified.

## Hand-off to next

P6.03 never writes a file — its only output is a deterministic preview string (`init`'s
`ConfirmedInitSelections`, formatted by `formatDraftSummary`). P6.04 serializes the confirmed
selections into `wastech-mdlint.config.json` and wires the local schema.
