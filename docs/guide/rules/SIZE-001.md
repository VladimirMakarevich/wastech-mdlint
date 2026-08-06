# SIZE-001 — File byte / line / token budgets

> Category **SIZE** (size) · Scope **document** · Default severity **warning** · Fixable **no** · [Rules index](README.md) · [Configuration](../configuration.md)

## What it checks

Every Markdown file in scope is measured against up to three independent budgets — **bytes**, **lines**, and **tokens** — and SIZE-001 reports a finding whenever a measured value crosses a configured threshold.

This keeps individual documents from growing past a size that hurts review, diffing, or (for the token metric) the amount of context a file consumes when it is fed to an LLM. Each metric is opt-in: a metric you do not configure is simply not measured. Within a metric you may set a `warn` threshold, an `error` threshold, or both.

**At least one budget is required.** Every metric being optional does not extend to configuring none of them: `{ "rule": "SIZE-001" }` measures nothing, which would be an enabled rule that can never report, so it is rejected when the config loads rather than passing silently. Set `bytes`, `lines`, or `tokens` — at the top level or inside an `overrides` entry. This one check lives only in the config loader: "at least one of three" is not expressible in the generated [`schema.json`](../cli.md#schema), so an editor validating against the schema will accept a budget-less entry that the linter then rejects. Trust the run, not the editor, for this case.

The three metrics are measured as:

- **bytes** — the UTF-8 byte length of the file's content.
- **lines** — the number of newline (`\n`) characters in the content.
- **tokens** — an _estimate_ from the isolated token heuristic (see [Notes](#notes)).

A file-level finding has no single offending line, so it is anchored at line 0.

## Options

| Option | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `bytes` | `{ warn?, error? }` | one of these four | — | UTF-8 byte budget. Each threshold is a positive integer. |
| `lines` | `{ warn?, error? }` | one of these four | — | Newline-count budget. Each threshold is a positive integer. |
| `tokens` | `{ warn?, error? }` | one of these four | — | Estimated-token budget. Each threshold is a positive integer. |
| `overrides` | `Override[]` | one of these four | — | Per-glob threshold sets that replace the top-level budget for matching files. |

No single option is required, but the four cannot all be absent: a config must set at least one budget somewhere, either as a top-level metric or inside an `overrides` entry. Omitting all four fails config loading with:

```text
- config.rules[0].options: SIZE-001 measures nothing unless at least one budget is set: configure bytes, lines, or tokens (at the top level or in an overrides entry)
```

Each threshold object (`bytes`, `lines`, `tokens`) accepts an optional `warn` and an optional `error`, both positive integers, and must carry at least one of them — an empty `{}` is the same "measures nothing" case one level down and is rejected the same way. Omit a threshold to skip that severity; omit the whole metric to skip it entirely.

An `overrides` entry has the shape:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `pattern` | `string` (≥1 char) | **yes** | Glob matched against the file's repo-relative POSIX path. |
| `bytes` | `{ warn?, error? }` | no | Byte budget for matching files. |
| `lines` | `{ warn?, error? }` | no | Line budget for matching files. |
| `tokens` | `{ warn?, error? }` | no | Token budget for matching files. |

## Example

### Config

```jsonc
{
  "rules": [
    {
      "rule": "SIZE-001",
      "options": {
        "lines": { "warn": 5, "error": 10 },
        "tokens": { "warn": 2 },
      },
    },
  ],
}
```

### Passes

```md
alpha beta gamma
```

→ Three newlines and 17 characters (5 estimated tokens). This trips the `tokens` warn budget (5 > 2) but stays under both line thresholds — see below for how each metric fires on its own.

### Fails

```md
one two three four five six seven eight nine ten eleven
```

→ Exactly **two** findings at line 0: the file **exceeds the lines error budget** (11 lines > 10) and, separately, **exceeds the tokens warn budget**. The `lines` metric emits a single `error` finding — 11 lines is also over the `warn` threshold of 5, but the error breach supersedes it (see below) — while `tokens` emits a `warning`.

### One finding per metric; metrics stay independent

Each metric is evaluated on its own, so a file can produce a `lines` finding and a `tokens` finding at once. Within a single metric, though, only the **highest crossed threshold** is reported: a file over both the `warn` and the `error` line budget yields **one** `error` finding, not a warning and an error for the same metric. The surviving finding's `data` still names both thresholds (`warnAt`, `errorAt`), so nothing is lost.

This is why the finding's severity comes from _which threshold was crossed_, not from the rule's default severity.

### Different budgets for specific files

```jsonc
{
  "rule": "SIZE-001",
  "options": {
    "tokens": { "warn": 8000 },
    "overrides": [
      { "pattern": "CLAUDE.md", "tokens": { "warn": 20000 } },
      { "pattern": "docs/reference/**", "lines": { "error": 3000 } },
    ],
  },
}
```

→ The first `overrides` entry whose `pattern` matches a file supplies that file's thresholds. For `CLAUDE.md` the token warn budget becomes `20000`; for files under `docs/reference/` a line error budget of `3000` applies. Metrics not named in the matching override fall back to the top-level option (so `docs/reference/` files still use the top-level `tokens.warn` of `8000`). Files matching no override use the top-level budgets unchanged.

## Notes

- **Scope:** `document` — evaluated per file, independent of other files.
- **Severity is per finding.** The `warning`/`error` split comes from the highest threshold crossed for that metric, not from the rule's default severity. A configuration `severity` override still clamps the emitted severity through the runner — and because a metric emits at most one finding, the clamp can never turn one over-budget metric into two same-severity messages.
- **Metrics are opt-in, but the rule is not inert-able.** A metric with no configured thresholds is never measured; an `options` object that configures no metric at all is a config error rather than a rule that quietly reports nothing (see Options above).
- **Overrides are first-match.** Only the first `overrides` entry that matches a file applies; it does not merge with later matching entries.
- **Token estimation is isolated and replaceable.** The token count comes from a single heuristic — `ceil(characters / 4)` — deliberately kept behind one function so it can be swapped for a real tokenizer later without touching this rule. Treat token thresholds as approximate budgets, not exact counts. Note that `bytes` measures UTF-8 byte length while `tokens` is derived from character length, so the two diverge for multi-byte content.

## See also

- [LLM-001](LLM-001.md) — project-wide eager-import context budget per entrypoint (uses the same token heuristic)
- [Rules index](README.md) · [Configuration](../configuration.md)
