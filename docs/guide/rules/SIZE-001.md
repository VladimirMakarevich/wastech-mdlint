# SIZE-001 — File byte / line / token budgets

> Category **SIZE** (size) · Scope **document** · Default severity **warning** · Fixable **no**
> · [Rules index](README.md) · [Configuration](../configuration.md)

## What it checks

Every Markdown file in scope is measured against up to three independent budgets — **bytes**,
**lines**, and **tokens** — and SIZE-001 reports a finding whenever a measured value crosses a
configured threshold.

This keeps individual documents from growing past a size that hurts review, diffing, or (for the
token metric) the amount of context a file consumes when it is fed to an LLM. Each metric is
opt-in: a metric you do not configure is simply not measured. Within a metric you may set a `warn`
threshold, an `error` threshold, or both.

The three metrics are measured as:

- **bytes** — the UTF-8 byte length of the file's content.
- **lines** — the number of newline (`\n`) characters in the content.
- **tokens** — an *estimate* from the isolated token heuristic (see [Notes](#notes)).

A file-level finding has no single offending line, so it is anchored at line 0.

## Options

| Option | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `bytes` | `{ warn?, error? }` | no | — | UTF-8 byte budget. Each threshold is a positive integer. |
| `lines` | `{ warn?, error? }` | no | — | Newline-count budget. Each threshold is a positive integer. |
| `tokens` | `{ warn?, error? }` | no | — | Estimated-token budget. Each threshold is a positive integer. |
| `overrides` | `Override[]` | no | — | Per-glob threshold sets that replace the top-level budget for matching files. |

Each threshold object (`bytes`, `lines`, `tokens`) accepts an optional `warn` and an optional
`error`, both positive integers. Omit a threshold to skip that severity; omit the whole metric to
skip it entirely.

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
        "tokens": { "warn": 2 }
      }
    }
  ]
}
```

### Passes

```md
alpha
beta
gamma
```

→ Two newlines and ~15 characters (~4 estimated tokens). This trips the `tokens` warn budget
(4 > 2) but stays under both line thresholds — see below for how each metric fires on its own.

### Fails

```md
one
two
three
four
five
six
seven
eight
nine
ten
eleven
```

→ SIZE-001 reports at line 0 that the file **exceeds the lines error budget** (11 lines > 10)
*and* separately that it **exceeds the tokens warn budget**. The `lines` metric emits an `error`
finding because the `error` threshold was crossed; `tokens` emits a `warning`.

### Per-metric, per-severity firing

Warn and error fire independently within a metric, and metrics are evaluated independently of one
another. A file that is over both the `warn` and the `error` line thresholds produces **two**
findings for the line metric — one `warning` and one `error` — because each threshold is checked
on its own. This is why the finding's severity comes from *which threshold was crossed*, not from
the rule's default severity.

### Different budgets for specific files

```jsonc
{
  "rule": "SIZE-001",
  "options": {
    "tokens": { "warn": 8000 },
    "overrides": [
      { "pattern": "CLAUDE.md", "tokens": { "warn": 20000 } },
      { "pattern": "docs/reference/**", "lines": { "error": 3000 } }
    ]
  }
}
```

→ The first `overrides` entry whose `pattern` matches a file supplies that file's thresholds. For
`CLAUDE.md` the token warn budget becomes `20000`; for files under `docs/reference/` a line error
budget of `3000` applies. Metrics not named in the matching override fall back to the top-level
option (so `docs/reference/` files still use the top-level `tokens.warn` of `8000`). Files matching
no override use the top-level budgets unchanged.

## Notes

- **Scope:** `document` — evaluated per file, independent of other files.
- **Severity is per finding.** The `warning`/`error` split comes from which threshold was crossed,
  not from the rule's default severity. A configuration `severity` override still clamps the
  emitted severity through the runner.
- **Metrics are opt-in.** A metric with no configured thresholds is never measured, so an empty
  `options` object reports nothing.
- **Overrides are first-match.** Only the first `overrides` entry that matches a file applies; it
  does not merge with later matching entries.
- **Token estimation is isolated and replaceable.** The token count comes from a single heuristic —
  `ceil(characters / 4)` — deliberately kept behind one function so it can be swapped for a real
  tokenizer later without touching this rule. Treat token thresholds as approximate budgets, not
  exact counts. Note that `bytes` measures UTF-8 byte length while `tokens` is derived from
  character length, so the two diverge for multi-byte content.

## See also

- [LLM-001](LLM-001.md) — project-wide eager-import context budget per entrypoint (uses the same
  token heuristic)
- [Rules index](README.md) · [Configuration](../configuration.md)
