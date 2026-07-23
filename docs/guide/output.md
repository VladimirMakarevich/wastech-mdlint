# Output & exit codes

> [Guide index](README.md) · [CLI reference](cli.md) · [Configuration](configuration.md)

## Text output

The default (`--format text`) groups findings by file, listing each rule ID, severity, message,
and location. It is meant for humans and terminals.

```bash
wastech-mdlint lint .
```

## JSON output

`--format json` emits a structured, deterministic `{ summary, messages, files }` document for
machine consumption (CI, dashboards, AI agents):

- `summary` — counts (errors/warnings) and pass/fail.
- `messages` — every finding with `ruleId`, `severity`, `message`, file, and line.
- `files` — the files analyzed.

```bash
wastech-mdlint lint . --format json > report.json
```

Output is sorted and uses repository-relative POSIX paths, so it is stable across runs and
operating systems (no timestamps, no host-dependent ordering).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Clean — no findings at or above the `--fail-on` threshold. |
| `1` | Findings at or above `--fail-on` (default `error`). |
| `2` | Operational/usage error (bad flag, missing config section, target outside the corpus, unreadable config). |

Control what fails CI with `--fail-on`:

```bash
wastech-mdlint lint .                      # fail only on errors (default)
wastech-mdlint lint . --fail-on warning    # fail on warnings too
wastech-mdlint lint . --fail-on off        # never fail; report only
```

## `--fix`

`lint --fix` applies deterministic fixes in place, then re-reports what remains. Only rules with a
fix hook change files — currently [SEC-001](rules/SEC-001.md) (scaffold missing sections) and
[TBL-002](rules/TBL-002.md) (empty target cell → ` TODO `). Everything else is reported, never
rewritten.

## Other commands

- `graph` / `slice` / `impact` are read-only and support `--format json` (and `graph` also
  `mermaid`/`dot`); they exit `0` on success, `2` on an operational error (e.g. `impact` on a file
  outside the corpus). See [Context graph](context-graph.md).
- `compile --dry-run` prints the generated `SKILL.md` to stdout. See [Compile](compile.md).
