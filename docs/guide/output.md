# Output & exit codes

> [Guide index](README.md) · [CLI reference](cli.md) · [Configuration](configuration.md)

## Text output

The default (`--format text`) groups findings by file, listing each rule ID, severity, message, and location. It is meant for humans and terminals.

```bash
wastech-mdlint lint .
```

## JSON output

`lint --format json` emits a structured, deterministic `{ summary, messages, files }` document for machine consumption (CI, dashboards, AI agents):

- `summary` — exactly three counts: `files` (how many were analyzed), `errors`, and `warnings`. There is **no** pass/fail field: the [exit code](#exit-codes) is that signal, and it depends on `--fail-on`, which `summary` knows nothing about.
- `messages` — every finding, as the table below.
- `files` — the files analyzed, so a consumer can tell "no findings" from "nothing was linted".

```bash
wastech-mdlint lint . --format json > report.json
```

Output is sorted and uses repository-relative POSIX paths, so it is stable across runs and operating systems (no timestamps, no host-dependent ordering).

### Message keys

Every key a finding can carry. Absent keys are omitted, not `null`, so read the optional ones defensively:

| Key | Always present | What it holds |
| --- | --- | --- |
| `ruleId` | yes | The canonical rule ID (`REF-001`), or the user-chosen ID of a `custom` rule. |
| `severity` | yes | `"error"` or `"warning"` — the resolved severity, after any config override. Never `"off"`: a disabled rule does not run. |
| `message` | yes | The human sentence. |
| `filePath` | yes | Repository-relative POSIX path. For the few findings attributed to a config entry rather than a location — a missing [STR-001](rules/STR-001.md) required file, an unresolvable [SEC-003](rules/SEC-003.md) template — this is the value you wrote in config, unnormalized. |
| `line` | yes | 1-based. A whole-file finding ([SIZE-001](rules/SIZE-001.md), [LLM-001](rules/LLM-001.md), a missing section) reports `0`, which the text format renders as `-`. |
| `helpUri` | yes | The reporting rule's documentation page on GitHub, on the **`blob/main`** branch — so a pinned older install links to the current page for its rule rather than to the one that shipped with it (nothing at runtime knows which version is installed, and the guide pages are in no published tarball, so there is no version-matched page to link; `ruleId` is there for a reader who wants their own copy). A `custom` rule points at [the custom-rules page](rules/custom.md), since a user-chosen ID has no page of its own. It stays _declared_ optional on the finding type and in the MCP `outputSchema` — a rule may in principle carry no documentation page — so a client generated from that schema will type it as nullable even though every shipped rule populates it. |
| `data` | in practice | The machine-readable half of the message: the offending value, the expected set, the cycle path, the crossed thresholds. Its keys are per rule. Every built-in and `custom` rule sets it, but it is optional by contract. |
| `column` | no | 1-based, and present only when the finding has a position within the line. |
| `fixable` | no | `true` only on a finding [`--fix`](#--fix) can repair — currently [SEC-001](rules/SEC-001.md) and [TBL-002](rules/TBL-002.md). Never serialized as `false`. |
| `endLine` | no | Declared on the finding contract for multi-line spans, and set by no rule that ships today, so it does not currently appear in output. |

`data` is what makes the output actionable beyond re-printing `message` — it is why the finding contract is structured at all. If you are converting to SARIF, `helpUri` is the field that carries the rule's documentation link.

### Where each host puts the findings

Four commands and tools report lint findings, and they do **not** all return the same document. This is deliberate — a human-facing report gets a summary, a typed client gets the record it types against — so read the fields the surface you called actually returns:

| Surface | Top-level shape | Finding counts |
| --- | --- | --- |
| CLI `lint --format json` | `{ summary, messages, files }` | `summary.errors`, `summary.warnings` |
| CLI [`impact <file> --format json`](context-graph.md#impact-file) | the same record MCP returns, under a `lint` key, narrowed to the affected subgraph | `lint.errorCount`, `lint.warningCount` |
| MCP [`lint-files`](mcp-server.md#the-6-tools) | `{ messages, files, errorCount, warningCount }` | `errorCount`, `warningCount` |
| MCP [`lint`](mcp-server.md#the-6-tools) | `{ messages, errorCount, warningCount }` | `errorCount`, `warningCount` |

`messages` is the same array of the shape above on all four. The differences are the wrapper and the counts: only the CLI's `lint` wraps the record in a `summary`, and only the ad-hoc MCP `lint` tool omits `files` — it lints one caller-supplied string, which is not a corpus, so there is no file list to report.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Clean — no findings at or above the `--fail-on` threshold. |
| `1` | Findings at or above `--fail-on` (default `error`). Reserved exclusively for findings. |
| `2` | Operational/usage error (unknown subcommand, bad flag, a nonexistent target path, missing config section, target outside the corpus, unreadable config, an unwritable file). |

An operational error goes to stderr, naming its path `/`-separated and relative to the directory the command works in (see [the CLI reference](cli.md#exit-codes) for the two cases that are named differently — an argument echoed back as you typed it, and a file written outside that directory, which is named absolutely rather than through a chain of `../` hops), so `1` always means "the linter found problems" and never "the command could not run". The one exception to the stream is `init`: its report stays on stdout even when the command exits `2` — a file it could not write is listed there alongside the files it did write, and so is the `--on-existing merge` refusal to write over a config it cannot load — since an init that half-happened, or deliberately did not, is more useful read as one summary.

Control what fails CI with `--fail-on`:

```bash
wastech-mdlint lint .                      # fail only on errors (default)
wastech-mdlint lint . --fail-on warning    # fail on warnings too
wastech-mdlint lint . --fail-on off        # never fail; report only
```

### Operational failures on both hosts

An unreadable directory, an unreadable config, a file that vanished mid-run — the environment failing rather than the input being wrong — reads the same on the CLI and on the [MCP server](mcp-server.md), because both name the errno and the path instead of dropping them:

| Host | What you get |
| --- | --- |
| CLI | `Operational error: EACCES on docs/locked` on **stderr**, exit `2`. |
| MCP | `isError: true` plus `{ "code": "OPERATIONAL_ERROR", "message": "Operational error: EACCES on docs/locked" }` in `structuredContent`, and the same sentence in the text block. |

The path is relative to the directory being analyzed — the command's working directory for the CLI, the tool's `cwd` for MCP — and `/`-separated on every platform. It is `.` when that directory is itself the thing that could not be read. Neither host attaches a `hint` here: the errno and the path are the whole remedy.

MCP is stricter than the CLI about what it will name. A failure whose path falls **outside** the analyzed directory, or that reports no path at all (`ENOSPC: no space left on device, write`), comes back as `INTERNAL_ERROR` with a fixed sanitized message instead, while the CLI, writing to your own terminal, keeps the `../` form and the original message. The property that buys is that no MCP payload names a host path outside the directory being analyzed. That directory itself is the one absolute path a payload can carry, and only in the [`INVALID_INPUT` rejection](mcp-server.md#error-contract) that echoes back a `cwd` which does not exist or is not a directory.

## `--fix`

`lint --fix` applies deterministic fixes in place, then re-reports what remains. Only rules with a fix hook change files — currently [SEC-001](rules/SEC-001.md) (scaffold missing sections) and [TBL-002](rules/TBL-002.md) (empty target cell → `TODO`). Everything else is reported, never rewritten.

Two properties hold for every file `--fix` touches:

- **Line endings are preserved.** Each document's own style is detected from its bytes (whatever terminates its first line wins; a file with none, or with lone classic-Mac `\r`, is treated as LF), and inserted content adopts it. A CRLF file stays CRLF on a Linux runner, and no fix ever leaves a file with mixed endings.
- **A failed write never damages the file.** Each document is written to a temp file beside it and then renamed into place, so the file on disk is either the old content or the new content, never a truncated mix. If a write fails, `--fix` stops at that file and exits `2`, naming the file it could not write (with its errno), stating that it is unchanged on disk, and listing the files it had already fixed. Durability across a power loss is not claimed — the guarantee is against truncation, not an un-`fsync`ed page cache.

Replacing a file by rename has one visible consequence: on Linux/macOS a **read-only document no longer blocks a fix**, because `rename` checks write permission on the containing directory, not on the file (the replacement does inherit the original's mode). Keep a file out of `--fix` with [`exclude`](configuration.md#top-level-shape) rather than with its file mode.

## Other commands

- `graph` / `slice` / `impact` are read-only and support `--format json` (and `graph` also `mermaid`/`dot`); they exit `0` on success, `2` on an operational error (e.g. `impact` on a file outside the corpus). See [Context graph](context-graph.md).
- `compile --dry-run` prints the generated `SKILL.md` to stdout. See [Compile](compile.md).
