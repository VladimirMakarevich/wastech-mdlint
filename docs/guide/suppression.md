# Inline suppression

> [Guide index](README.md) · [Configuration](configuration.md) · [Rules](rules/README.md)

Suppress findings inline with HTML-comment directives. Use this for intentional exceptions — a deliberately broken example link, a placeholder that is expected — without turning a rule `"off"` project-wide.

## Directives

<!-- prettier-ignore -->
```md
<!-- wastech-mdlint-disable REF-001 -->

[intentionally broken](does-not-exist.md)

<!-- wastech-mdlint-enable REF-001 -->

<!-- wastech-mdlint-disable-next-line REF-001 -->
[also intentionally broken](missing.md)
```

| Directive | Effect |
| --- | --- |
| `wastech-mdlint-disable [IDs]` | Disable the listed rules from here until a matching `enable`, a `restore` of a state captured before it, or end of file. |
| `wastech-mdlint-enable [IDs]` | Re-enable the listed rules. |
| `wastech-mdlint-disable-next-line [IDs]` | Disable the listed rules for the **next line only**. |
| `wastech-mdlint-disable-file [IDs]` | Disable the listed rules for the **whole file**, wherever the directive is written. |
| `wastech-mdlint-capture` | Save the current enable/disable state. |
| `wastech-mdlint-restore` | Return to the state saved by the most recent unmatched `capture`. |

## Rules

- **Rule IDs are optional.** A `disable`, `enable`, `disable-next-line` or `disable-file` directive with **no** IDs applies to **all** rules. `capture` and `restore` take no IDs at all.
- IDs are canonicalized like config (`ref-001` → `REF-001`) and can be space-separated.
- A built-in rule's **alias** works wherever its ID does, in any case, so a suppression can say what it silences: `<!-- wastech-mdlint-disable-next-line no-broken-anchors -->` is the same directive as one naming `REF-002`. Each rule's alias is in the [rules index](rules/README.md). Findings still report the ID.
- `disable` runs until a matching `enable`, a `restore` that returns to a state captured before it, or the end of the file.
- `disable-next-line` covers only the single line that follows it, so write the content directly below it: a blank line in between is the line it covers.
- Wherever an ID is accepted, a [category](#categories) such as `REF` can be written instead.
- Suppression is applied after rules run: a suppressed finding is dropped from the report.
- A directive comment written inside YAML frontmatter is frontmatter text, not a directive, and suppresses nothing.

## Whole-file suppression

```md
Text with a finding the file deliberately keeps.

<!-- wastech-mdlint-disable-file REF-001 -->
```

`disable-file` sets the file's starting state, so its position does not matter: one written at the end of the file suppresses findings on every line above it.

- It is the **only** directive that reaches whole-file findings — those reported at line `0`, such as [SIZE-001](rules/SIZE-001.md) or [LLM-001](rules/LLM-001.md). Every other directive starts at a real line, so it cannot cover line `0`.
- A later `enable` still re-enables the rule from its own line. "Wherever it is written" means its position is irrelevant, not that it is irrevocable.
- `restore` never undoes it: a captured state always includes it.
- With no IDs it disables every rule for the whole file.

## Capture and restore

`capture` saves the current state and `restore` returns to it exactly. A block that needs its own suppression — a pasted snippet, a generated section — can wrap itself in the pair without knowing what the surrounding file has disabled:

```md
<!-- wastech-mdlint-capture -->
<!-- wastech-mdlint-disable REF-001 -->

[intentionally broken](does-not-exist.md)

<!-- wastech-mdlint-restore -->
```

After `restore`, `REF-001` is disabled again if it was disabled before `capture`, and enabled again if it was enabled — a plain `enable REF-001` would have enabled it either way.

Pairs nest. Each `restore` returns to the state of the most recent `capture` not yet restored:

```md
<!-- wastech-mdlint-disable TBL-002 -->
<!-- wastech-mdlint-capture -->
<!-- wastech-mdlint-disable REF-001 -->
<!-- wastech-mdlint-capture -->
<!-- wastech-mdlint-enable -->
<!-- wastech-mdlint-restore -->
<!-- wastech-mdlint-restore -->
```

Here the `enable` turns every rule on; the first `restore` returns to `TBL-002` and `REF-001` disabled, and the second to `TBL-002` alone disabled.

- `capture` and `restore` take no IDs.
- A `capture` left open at the end of the file is harmless: the state simply continues, and nothing is reported.

## Categories

A rule category — the part of a built-in rule ID before the dash — selects every rule in that family. `REF` means every `REF-*` rule:

<!-- prettier-ignore -->
```md
<!-- wastech-mdlint-disable-next-line REF -->
[broken](missing.md#nope)
```

- Categories work in `disable`, `enable`, `disable-next-line` and `disable-file`, and can be mixed with IDs in one directive.
- They are case-insensitive like IDs (`ref` is `REF`).
- Only the built-in families are categories: `CTX`, `FM`, `GRP`, `LLM`, `REF`, `SEC`, `SIZE`, `STR`, `TBL`. A `custom` rule is not part of a family, so its IDs have to be listed one by one; a token such as `REQ` is reported as an unknown category even when a custom `REQ-OWNER` rule exists.
- IDs are canonicalized before anything else, so a built-in ID written without its dash (`REF001`) is still the rule ID `REF-001`. A token that has no dash _after_ canonicalization is always read as a category, never as a rule ID — built-in IDs are `PREFIX-DIGITS`, custom IDs must contain a dash, and every alias contains a dash too.
- A custom rule ID can never be an alias written in uppercase (`NO-BROKEN-ANCHORS`): the config rejects it, because a directive resolves that token to the built-in rule (`REF-002`) in any case, so the custom rule's ID would be ambiguous and the rule could never be suppressed by it.

## Directive diagnostics

A directive that cannot mean what it says is reported rather than ignored, because a typo can leave a range disabled that was meant to be enabled, and the report would come out clean while hiding findings. Each problem is a finding with:

- `ruleId` `DIRECTIVE`, severity `error`, at the directive's line, with `helpUri` pointing at this page;
- `data.directive` naming the directive kind.

It is reported for:

- **an unknown category** — a token without a dash that is not one of the built-in families. The message lists the known ones and `data.token` holds the token. The token suppresses nothing.
- **a `restore` with no open `capture`** — the `restore` is ignored and the state does not change.
- **IDs written on `capture` or `restore`** — the IDs are ignored (`data.tokens` lists them) and the directive still acts.

A `DIRECTIVE` finding cannot itself be suppressed by a directive. It counts towards the error total and exit code like any other error, and it appears only when at least one rule runs: with no rules there is no finding a directive could hide, so a run with an empty rule set stays a clean pass.

A dashed ID that names no rule, such as `REF-999`, matches nothing and is not reported, because whether a dashed ID exists depends on the custom rules in the config.

## Scope note

Inline suppression is line-anchored, so it naturally fits document-scope findings. Project-scope findings (e.g. [GRP-001](rules/GRP-001.md)) are anchored to a file/line too and can be suppressed where they are reported; prefer configuring the rule's options (entry points, excludes) for structural exceptions rather than scattering suppressions.
