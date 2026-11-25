# Running alongside markdownlint

> [Guide index](README.md) · [Rules](rules/README.md) · [Configuration](configuration.md) · [Inline suppression](suppression.md)

`wastech-mdlint` is not a replacement for markdownlint. The two tools check different things, and most repositories that care about their Markdown benefit from running both. This page explains which tool owns which concern, lists the rules where the two overlap, and gives a markdownlint config that hands broken anchors to one tool, so they are not reported twice. The other overlaps are left on deliberately, for reasons given below.

## Who owns what

**markdownlint owns formatting and style**: whitespace, indentation, list markers, heading and emphasis style, table pipes, line length and the like. Many of those checks can be fixed automatically. `wastech-mdlint` deliberately ships no formatting rules, so there is nothing to reconcile here - keep markdownlint for all of it.

**`wastech-mdlint` owns what a formatter cannot see**, because it needs more than one file or a model of what the document is for:

- **Links, anchors and images that resolve across files** - [REF-001](rules/REF-001.md), [REF-002](rules/REF-002.md) and [REF-003](rules/REF-003.md) check that a relative link reaches a file, that its `#fragment` matches a heading or HTML anchor in that file, and that an image target exists.
- **Structure and document-type patterns** - required sections, section order and templates ([SEC-001](rules/SEC-001.md), [SEC-002](rules/SEC-002.md), [SEC-003](rules/SEC-003.md)), table schemas ([TBL-001](rules/TBL-001.md) to [TBL-006](rules/TBL-006.md)), front matter ([FM-001](rules/FM-001.md)) and required files ([STR-001](rules/STR-001.md)).
- **The reference graph** - no cycles, no orphans, IDs carried forward between stages ([GRP-001](rules/GRP-001.md) to [GRP-003](rules/GRP-003.md)).
- **Context budgets** - per-file size and per-entrypoint eager-import token budgets ([SIZE-001](rules/SIZE-001.md) and [LLM-001](rules/LLM-001.md)).

The two tools read the same files independently. Neither sees the other's findings, config or inline directives.

## Rules that overlap

A handful of `wastech-mdlint` rules check the same defect as a markdownlint rule. The markdownlint column names each rule by its number and purpose only; every note describes the `wastech-mdlint` side, as documented on that rule's page. The table is maintained by hand rather than generated from the registry, so a rule's own page is the authority when the two disagree.

| markdownlint | wastech-mdlint | Notes |
| --- | --- | --- |
| MD042 - no empty links; MD011 - reversed link syntax | [REF-008](rules/REF-008.md) `no-malformed-links` | One rule for both defects. Also reports an image with an empty target and a reference whose definition is empty. Reversed syntax is reported only when the bracket content looks like a link target, so `(see below)[1]` is not. |
| MD052 - reference links and images use a defined label | [REF-007](rules/REF-007.md) `no-undefined-references` | Full and collapsed references always; shortcut references (`[label]`) only with `includeShortcut: true`. |
| MD053 - reference definitions are needed | [REF-009](rules/REF-009.md) `no-unused-definitions` | Ignores the `//` label by default; a duplicate definition of a used label is not reported; `lint --fix` deletes unused definitions. |
| MD056 - table column count | [TBL-007](rules/TBL-007.md) `table-row-cell-count` | The `section` option narrows the check to tables under one heading. |
| MD024 - multiple headings with the same content | [SEC-005](rules/SEC-005.md) `no-duplicate-headings` | Compares rendered text, case-sensitively; `siblingsOnly: true` compares only headings with the same parent. Empty headings are skipped. |
| MD036 - emphasis used instead of a heading | [SEC-006](rules/SEC-006.md) `no-emphasis-as-heading` | Follows MD036's semantics; the exempting trailing characters are set with `punctuation`. |
| MD040 - fenced code blocks have a language | [CTX-006](rules/CTX-006.md) `code-block-language` | The `allowed` option restricts the language to a list, compared ignoring letter case. Indented code blocks and raw HTML `<pre>` are not checked. |
| MD045 - images have alt text | [CTX-005](rules/CTX-005.md) `image-alt-text` | Markdown images only: raw HTML `<img>` is not read at all. Alt text that is present but only punctuation or a filename is not reported. |
| MD059 - link text is descriptive | [CTX-004](rules/CTX-004.md) `descriptive-link-text` | Default phrase list in English and Russian; `phrases` replaces it and `additionalPhrases` extends it. |
| MD051 - link fragments are valid | [REF-002](rules/REF-002.md) `no-broken-anchors` | Also checks fragments of links to other files (`guide.md#setup`); `ignoreCase` and `ignoredPattern` options; `lint --fix` repairs a case-only mismatch. |
| MD001 - heading increment; MD025 - single top-level heading; MD041 - first line is a top-level heading | [SEC-004](rules/SEC-004.md) `heading-increment` | One rule with three checks, each switchable: `increment`, `singleTitle` and `title`. A front matter title satisfies `title` but does not count toward `singleTitle`. |
| MD043 - required heading structure | [SEC-003](rules/SEC-003.md) `section-template` | Only with `strict: true`, which compares each file's full heading sequence against a template file. |

Everything markdownlint checks that is not in this table - trailing punctuation in headings, line length, inline HTML, bare URLs, spacing and list style among them - has no `wastech-mdlint` counterpart.

## A ready markdownlint config

Turn **MD051 off** and let REF-002 own link fragments. With both enabled, a broken same-file anchor is reported twice for one defect, and REF-002 does more: it also checks a fragment against the heading slugs and HTML anchors of the file a link points to, and `lint --fix` rewrites a fragment that is wrong only in letter case.

A `.markdownlint.json` that keeps every other markdownlint rule at its default:

```json
{
  "default": true,
  "MD051": false
}
```

Turn MD051 off only when REF-002 is enabled over the same files. markdownlint checks whatever its own globs cover, while a `wastech-mdlint` rule checks only the files in the config's `include`. Most rules narrow that further with the entry's own `files` and `exclude`; [REF-001](rules/REF-001.md) and [REF-003](rules/REF-003.md) are the exception, as they take no `files` option and their `exclude` skips link or image _targets_, not the documents being checked. A file outside REF-002's scope loses fragment checking entirely once MD051 is off.

### Why the other overlaps stay on

Leave the other markdownlint counterparts enabled, and accept that some defects are reported by both tools. Each `wastech-mdlint` rule in the table above draws its edges differently from the markdownlint rule beside it, and the notes list the cases our side deliberately does not report - reversed link syntax whose brackets do not look like a target, empty headings, duplicate definitions of a used label, raw HTML `<img>`. Turning a markdownlint rule off would silently drop whatever it catches beyond those edges, and this guide cannot keep track of markdownlint's behaviour from release to release.

A `wastech-mdlint.config.json` that enables the link rules and the counterparts in the table that need no options of your own:

```jsonc
{
  "$schema": "./node_modules/@wastech-mdlint/cli/schema.json",
  "include": ["**/*.md"],
  "rules": [
    { "rule": "REF-001" },
    { "rule": "REF-002" },
    { "rule": "REF-003" },
    { "rule": "REF-007" },
    { "rule": "REF-008" },
    { "rule": "REF-009" },
    { "rule": "TBL-007" },
    { "rule": "SEC-004" },
    { "rule": "SEC-005" },
    { "rule": "SEC-006" },
    { "rule": "CTX-004" },
    { "rule": "CTX-005" },
    { "rule": "CTX-006" },
  ],
}
```

Each `rule` may be written as its alias instead - `"no-broken-anchors"` for REF-002, for example - but pick one spelling per rule throughout a config. See [rule entries](configuration.md#rule-entries) for the options each entry accepts.

## Inline directives

The two tools' inline directives are independent HTML comments, and neither tool reads the other's. A `markdownlint-disable` comment does not silence a `wastech-mdlint` finding, and a `wastech-mdlint-disable` comment does not silence a markdownlint one, so silencing the same block in both tools takes a directive for each:

```md
<!-- markdownlint-disable MD040 -->
<!-- wastech-mdlint-disable CTX-006 -->

...the block both tools should skip...

<!-- wastech-mdlint-enable CTX-006 -->
<!-- markdownlint-enable MD040 -->
```

See [Inline suppression](suppression.md) for every `wastech-mdlint` directive form, including suppression by alias and by category.
