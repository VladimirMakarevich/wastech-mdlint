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

| Code | Meaning                                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Clean — no findings at or above the `--fail-on` threshold.                                                                                                                   |
| `1`  | Findings at or above `--fail-on` (default `error`). Reserved exclusively for findings.                                                                                       |
| `2`  | Operational/usage error (unknown subcommand, bad flag, a nonexistent target path, missing config section, target outside the corpus, unreadable config, an unwritable file). |

An operational error goes to stderr, naming its path `/`-separated and relative to the directory the
command works in (see [the CLI reference](cli.md#exit-codes) for the two cases that cannot be), so
`1` always means "the linter found problems" and never "the command could not run". The one
exception to the stream is `init`: a file it could not write is listed in its own report on stdout,
alongside the files it did write, since a partial init is more useful read as one summary — the
exit code is still `2`.

Control what fails CI with `--fail-on`:

```bash
wastech-mdlint lint .                      # fail only on errors (default)
wastech-mdlint lint . --fail-on warning    # fail on warnings too
wastech-mdlint lint . --fail-on off        # never fail; report only
```

## `--fix`

`lint --fix` applies deterministic fixes in place, then re-reports what remains. Only rules with a
fix hook change files — currently [SEC-001](rules/SEC-001.md) (scaffold missing sections) and
[TBL-002](rules/TBL-002.md) (empty target cell → `TODO`). Everything else is reported, never
rewritten.

Two properties hold for every file `--fix` touches:

- **Line endings are preserved.** Each document's own style is detected from its bytes (whatever
  terminates its first line wins; a file with none, or with lone classic-Mac `\r`, is treated as
  LF), and inserted content adopts it. A CRLF file stays CRLF on a Linux runner, and no fix ever
  leaves a file with mixed endings.
- **A failed write never damages the file.** Each document is written to a temp file beside it and
  then renamed into place, so the file on disk is either the old content or the new content, never a
  truncated mix. If a write fails, `--fix` stops at that file and exits `2`, naming the file it
  could not write (with its errno), stating that it is unchanged on disk, and listing the files it
  had already fixed. Durability across a power loss is not claimed — the guarantee is against
  truncation, not an un-`fsync`ed page cache.

Replacing a file by rename has one visible consequence: on Linux/macOS a **read-only document no
longer blocks a fix**, because `rename` checks write permission on the containing directory, not on
the file (the replacement does inherit the original's mode). Keep a file out of `--fix` with
[`exclude`](configuration.md#top-level-shape) rather than with its file mode.

## Other commands

- `graph` / `slice` / `impact` are read-only and support `--format json` (and `graph` also
  `mermaid`/`dot`); they exit `0` on success, `2` on an operational error (e.g. `impact` on a file
  outside the corpus). See [Context graph](context-graph.md).
- `compile --dry-run` prints the generated `SKILL.md` to stdout. See [Compile](compile.md).
