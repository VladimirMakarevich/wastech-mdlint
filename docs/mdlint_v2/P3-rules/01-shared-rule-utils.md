# P3.01 · Shared rule utils

> Phase: [P3 — Rules](index.md) · Roadmap: [v2 Index](../index.md) · Size **M** · Status **Done**.

## Goal

Build the shared utilities every rule reuses, so the rule tasks (P3.02–P3.07) stay thin.

## Sequence

- **Previous:** [P2.07 — First rules + `lint`](../P2-rule-engine/07-first-rules-lint-command.md)
  proved the engine path on a couple of rules.
- **Next:** [P3.02–P3.07](index.md) — the rule families, all of which import these utils.
- **Depends on:** P2 complete · **Blocks:** every rule task in P3.

## Inputs (from previous work)

- Primitives (P2.02), registry/metadata (P2.03), `settings` plumbing (P2.04/C5).

## Deliverables / steps

1. `glob-match` — picomatch matcher with `{ dot: true }` (so `.claude/` etc. are matched);
   the shared `files`/`exclude` scoping helper ([R7](../requirements/02-rules-engine.md)).
2. `find-line-number(content, index)` — offset → 1-based line.
3. `extract-section-body(content, headings, heading)` — heading to next same/higher level.
4. `regex-string` — Zod validator ensuring an options string is a valid `RegExp`.
5. `site-router` — `resolveRoutedUrl(url, router)` with the Starlight preset; fed by
   `settings.siteRouter` ([C5](../requirements/01-configuration.md)) with per-rule override.

## Decisions applied

- [R7](../requirements/02-rules-engine.md) shared scoping · [C5](../requirements/01-configuration.md)
  site-router from settings.

## Exit criteria

- [ ] Each util has unit tests.
- [ ] `site-router` resolves Starlight routes (locales, urlPrefix, indexFile) to file paths.
- [ ] `glob-match` honors `dot: true` and the shared scoping semantics.

## Hand-off to next

P3.02–P3.07 compose rules from primitives + these utils with no duplicated glob/line/regex
logic.
