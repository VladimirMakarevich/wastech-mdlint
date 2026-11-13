# Changelog

All notable changes to this project are documented here. The three packages — `@wastech-mdlint/core`, `@wastech-mdlint/cli`, and `@wastech-mdlint/mcp-server` — are published together at one version from a single `vX.Y.Z` tag, and the Agent Skills are tagged with them, so one entry below describes all of them.

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `CTX-004` reports a link whose visible text does not describe its target, such as `[here](a.md)` or `[подробнее](a.md)`: an agent decides whether to follow a link from its text, and "here" carries nothing. Link text and phrases are compared after Unicode NFC normalisation, collapsing whitespace, trimming punctuation and symbols from both ends and lower-casing independently of the host locale, and the whole text must equal a phrase, so `[more about installation](a.md)` passes. The default list is English (`here`, `click here`, `click`, `link`, `this link`, `more`, `read more`, `learn more`, `this`, `this page`) and Russian (`здесь`, `тут`, `сюда`, `ссылка`, `по ссылке`, `эта ссылка`, `подробнее`, `читать далее`, `нажмите здесь`); `phrases` replaces it and `additionalPhrases` extends whichever list is in effect, and a phrase without a letter or digit is rejected. Only the link's own text is judged: autolinks and links whose text is the URL pass under the default list, since no default phrase is a URL, an image inside a link contributes no text (its alt text is not judged), inline code counts as text, and raw inline HTML is left out, so `[<em>here</em>](a.md)` is judged as `here` and `[click<br>here](a.md)` as `click here`. Default severity `warning`; not fixable. Parsed links gain a `visibleText` field, set when the label as a reader sees it (inline HTML left out, a hard line break or an inline `<br>` as whitespace) differs from `text`; `text` itself is unchanged.
- `REF-009` reports a link reference definition, such as `[old]: docs/legacy.md`, that no reference link or image in the same document uses. A definition renders nothing, so an unused one is invisible on the page and goes stale unnoticed. Labels match as CommonMark matches them (case-insensitive, whitespace collapsed); the `[//]: # (comment)` idiom is ignored through the `ignoredDefinitions` option (default `["//"]`). Default severity `warning`; `init` does not propose it. `--fix` deletes each unused definition with its lines and line ending, unless it sits inside a blockquote or list item or shares its line, in which case it is reported without `fixable`. Parsed documents gain a `referenceDefinitions` field (label, identifier, position, source offsets, whether it is top-level and whether it is referenced) a `textSpans` field (the source ranges of prose text, with the slug of the enclosing heading) and a `literalBrackets` field (the source offsets of `[` and `]` that render as plain text), and parsed inline links with a fragment carry a `fragmentRange` with the fragment's source offsets.
- `--fix` repairs two more rules. `REF-002` rewrites a fragment that differs from exactly one heading slug or HTML anchor of its target only by letter case to that anchor (`#Intro` → `#intro`); an ambiguous match, a reference-style link, or a fragment written with percent-encoding, escapes or entities is reported but not rewritten. `CTX-003` replaces a glossary alias with its canonical term in prose, and leaves it in code, link and definition targets, the label of a shortcut `[gql]` or collapsed `[gql][]` reference link, text between literal brackets, a word that could become an autolink, HTML, front matter, escaped text, and in headings of documents where a heading slug equals, ignoring case, the fragment of any link in the corpus; an alias or canonical term containing characters other than letters, digits, spaces and `.,'’-/+` (such as a `|` that would add a table column) is reported but not substituted, a run of text whose replacements together would contain an alias is left unchanged, and of overlapping aliases the one starting first wins, then the longer one at the same start. Each fixed finding is marked `fixable`, a fix touches only the bytes it replaces (CRLF files stay CRLF), and a second `--fix` run changes nothing. Project-scope rules can now contribute fixes: `--fix` hands each document to the rule's fix in turn, with the whole corpus beside it.
- `SEC-006` reports a paragraph made only of bold or italic text, such as `**Installation**`, standing in for a heading, which `section` options, `SEC-001`, `CTX-001` and `slice` cannot see. The semantics follow markdownlint MD036: only top-level paragraphs whose whole content is one bold or italic run of plain text on one line are reported, so emphasis inside a list item, blockquote or table cell, nested formatting, inline code or a link inside the run, and wrapped text are not. Text ending with a character from `punctuation` (default `.,;:!?` plus the full-width `。，；：！？`) is a sentence or lead-in and is not reported; `""` exempts nothing. A document opening with `**Title**` is also reported by `SEC-004`'s title check. Default severity `warning`; not fixable. Parsed documents gain an `emphasisParagraphs` field recording each such paragraph's text, kind and line.
- `SEC-005` reports a heading whose text repeats an earlier heading in the same document, at the repeat, naming the line of the first occurrence. Headings are compared by their rendered text exactly — inline formatting stripped, so `**Usage**` repeats `Usage`, but case-sensitive, matching what `section` options match — and empty headings are skipped. With `siblingsOnly` (default `false`) only headings with the same parent and the same depth are compared, so a changelog may repeat `### Added` under each release. Default severity `warning`; not fixable.
- `SEC-004` checks a document's outline: heading levels go deeper one at a time (`increment`), there is one top-level heading (`singleTitle`), and the document starts with a title (`title`) — the first block that renders is a heading at `level` (default `1`), or the front matter has the `titleKey` key (default `title`, any value, dot paths allowed). Each check can be turned off on its own. Front matter, HTML comments, inline-disable directives and link reference definitions are not counted as the first block; an HTML block with real markup is. A front matter title does not count toward `singleTitle`, and front matter that cannot be read is left to `FM-001` rather than reported again. Default severity `warning`; not fixable. Parsed documents gain a `firstBlock` field recording the type and line of the first block that renders.
- `FM-001` lets a repository pin the shape of its YAML front matter: `required` key paths, `allowed` value sets and `patterns`, each per document family through `files`/`exclude`. With no options it still reports front matter that is not valid YAML or not a mapping, since a broken block is invisible once rendered; such a block is always one finding, and its values are not checked. Values are read under YAML's failsafe schema, so every scalar stays a string — `1.10` is not the number `1.1` and `yes` is not a boolean — and checks compare against what YAML parsed rather than a coerced type. The parser never executes anything: tags, duplicate keys and multiple documents are invalid, `<<` is an ordinary key, and alias expansion is bounded. A document without front matter is reported only when `required` lists keys. The same checks are available to the `custom` rule as `frontmatterRequired`, `frontmatterInSet` and `frontmatterMatches` (target `frontmatter`), which report unreadable front matter instead of passing it. `FM` is now a reserved prefix, so a custom rule id starting `FM-` must be renamed. Parsed documents gain `frontmatter.parsed`, holding the parsed value or a structured error with its line. `@wastech-mdlint/core` now depends on `yaml`.
- `SEC-003` takes a `strict` option (default `false`) that checks a document's whole heading sequence against its template in one rule: every template heading present, in order, at the same depth, and no extra headings. Template headings whose text is exactly `?`, `*` or `+` are wildcards for one, zero-or-more and one-or-more headings at their depth or deeper, so a per-document `# ?` title or an open `## *` slot does not force every family member to share text. Each diverging document gets one finding at its first divergence, naming the expected and found headings, because once the outline breaks, which template heading later headings belong to is ambiguous. Without `strict` the rule's results are unchanged, and wildcards have no meaning there.
- `REF-002` takes two options. `ignoreCase` (default `false`) compares fragments with heading slugs and HTML anchors case-insensitively, so `#Demo` matches `# Demo`; the default stays case-sensitive because GitHub's fragment matching is. `ignoredPattern` is a regular expression, tested unanchored against the fragment without its `#`, whose matches are never reported; a pattern that does not compile is a config error naming `config.rules[i].options.ignoredPattern`.
- `TBL-007` reports a table row whose cell count differs from the header's, with both counts in the message and in `data` (`expected`, `actual`). Without it a malformed row went unreported: cells beyond the header vanish when the table renders, a short row renders blanks, and every other `TBL` rule checked the header-shaped table instead of what was written. Cells are counted the way GFM splits them, so `\|` never separates cells but an unescaped `|` inside backticks does — it splits the cell on GitHub too; escape it as `\|`. Default severity `error`; not fixable, because there is no safe way to choose which extra cell to drop. `init` proposes it wherever it proposes `TBL-002`.
- `REF-007` reports a reference-style link or image whose label has no definition, such as `[text][missing]` or `![alt][missing]` with no `[missing]: …` line. Without it such a reference went unreported: Markdown renders it as the literal brackets rather than a link, so no other rule ever saw it. Full (`[text][label]`) and collapsed (`[label][]`) references are reported; shortcut references (`[label]`) only with `includeShortcut: true`, because bracketed words in prose look the same. Labels match definitions case-insensitively, as CommonMark does; code, HTML, frontmatter, footnote calls (`[^1]`) and GitHub alert markers are never reported, while a full reference whose label merely starts with `^`, such as `[text][^missing]`, is not a footnote call and is reported. Default severity `error`; not fixable; `init` does not propose it. Parsed documents gain an `undefinedReferences` field recording each undefined label with its kind, form and position.
- `REF-008` reports a link or image with an empty target, such as `[text]()`, `[text](<>)` or `![alt]()`, a link whose target is a bare `#`, and reversed link syntax such as `(text)[https://example.com]` or `(text)[./a.md]`. Without it these went unreported: `REF-001`, `REF-002` and `REF-003` skip an empty target because there is nothing to resolve, and reversed syntax renders as literal text rather than a link. Reversed syntax is only reported when the bracket content looks like a link target (a URI scheme, a path, `www.` or a file extension), so `(see below)[1]` and `(see below) [1]` stay silent, and a parenthetical followed by a defined reference link is not reported. Code, HTML, frontmatter and escaped parentheses or brackets are never read. Default severity `error`; not fixable; `init` does not propose it. Parsed documents gain a `reversedLinks` field recording each reversed link with its text, target and position, and parsed images now carry a `column`.

### Fixed

- A regex `pattern` that is valid alone but does not compile with its `flags` (for example `\u{110000}` with `u`) is now a config error at `pattern` for `TBL-004` and the `columnMatches`, `contentNotMatch` and `frontmatterMatches` custom kinds. Before, the config loaded and the lint run then aborted.

- Skipping an existing config no longer ends `init`. The CI workflow and agent rule are still offered after a skip — prompted in an interactive run, and written under `--yes` when `--with-ci-workflow` or `--with-agent-rule` is passed, where both flags used to be ignored without a message. The config and its schema stay byte-unchanged and nothing is scanned. A requested workflow or agent rule that cannot be written after a skip exits `2`, as it does after a config write; a plain skip still prints the single skip line and exits `0`.

- `TBL-002` (and a custom `columnNotEmpty` assertion) no longer reports the cells missing from a row shorter than its header as empty cells, and `--fix` no longer writes `TODO` into them. The defect is the row, and reporting every padded cell as well raised several findings for one mistake while a `TODO` hid the short row instead of repairing it; `TBL-007` reports the row. A cell written empty is still reported. A config that enables `TBL-002` alone no longer flags short rows, so add `TBL-007` beside it.

- `REF-002` no longer reports anchors that GitHub renders correctly: a fragment naming an HTML anchor (`<a id="custom"></a>`, an `id` on any element, or `<a name="custom"></a>`), `#top`, and GitHub line fragments such as `#L5`, `#L10-L12` and `#L10C5-L12C3`. `#L`, `#Lx`, `#L0` and `#l5` are still reported. The context graph resolves fragments the same way, so a link to another file with one of these fragments now produces an `anchor` edge, which `graph`, `impact`, `slice`, `compile` and the graph rules (including cycle detection) can see where it was skipped before. `slice "#custom"` now also starts from the file declaring `<a id="custom">`. The rule's description is now "Link anchors match a heading or HTML anchor.", and its message reads `does not match any heading or HTML anchor`.

- A file that opens with YAML frontmatter — a `SKILL.md`, an agent file, a docs-site page — no longer gains a heading that does not exist. The block between the two `---` lines used to parse as a horizontal rule plus a heading made of the YAML text, so a file opening with `name: demo-skill` and `description: does a thing` had a heading whose slug was `name-demo-skilldescription-does-a-thing`, a link to that slug passed `REF-002`, and `SEC-*`, `CTX-001`, `slice`, `impact` and `compile` all treated it as real. Frontmatter is now recognised during parsing and kept out of the outline, so such a link is reported by `REF-002` as a broken anchor. Links, `@` imports and suppression directives written inside frontmatter are no longer picked up either. Size and token counts still include the frontmatter. A file whose first line is a `---` horizontal rule followed later by another `---` line is now read as frontmatter up to that line; use `***` or `___` for a horizontal rule on line 1.

## [0.2.2]

### Security

- `@wastech-mdlint/core` and `@wastech-mdlint/mcp-server` now require `zod` 4.6.6 or later. Earlier releases are affected by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (high severity: memory exhaustion while validating oversized constrained collections). The previous range, `^4`, already allowed the patched version, but a project whose lockfile resolved an older `zod` kept it through an upgrade of these packages and kept the `npm audit` finding.

### Fixed

- A malformed custom rule entry in the config is diagnosed again by what is actually wrong with it. Under `zod` 4.6, which a fresh install of `0.2.1` already resolves to, a typo inside an `assert` block — `"colums"` for `"columns"`, an array where an object belongs, an unknown `kind` — was reported as `Unrecognized key: "id"` plus a note that a `"custom"` entry requires `id` and `options.assert`, even though `id` was present and correct. The error now names the offending path inside `options.assert`, as it did with earlier `zod` releases. A custom entry missing `id` or `options` is now reported one missing key at a time, at its own path — `config.rules[0].options: …` — instead of the one summary line, which for `{ "rule": "custom", "id": "REQ-1" }` had also objected to `id`.
- A densely cross-linked set of documents no longer stalls every command that builds the context graph — `lint` (even with `"rules": []`), `graph`, `slice`, `impact`, `compile`, `init` and the MCP tools. To report a cycle, the graph extracts one concrete path through each group of mutually reachable documents, and that search retried every ordering of documents it had already ruled out, which grows factorially with the size of the group. A dozen pages that all link to one another, sorting ahead of the one page that links back, were enough to keep a ~170-document corpus at 100% CPU for hours. The search now visits each document once. The reported cycles are unchanged: it returns the same path as before, without re-exploring documents that cannot lead back.

## [0.2.1]

### Changed

- The default `exclude` gains `**/worktrees/**`, so every run — with or without a config — skips a directory named `worktrees` at any depth, and `init` no longer scans one for doc clusters. Agent tools such as Claude Code check out git worktrees inside the repository, under `.claude/worktrees/<name>/`, and each is a full second copy of every tracked document, so a lint reported every finding once more per worktree. Hand-written Markdown under a directory literally named `worktrees` is now skipped too; negate the default (`"!**/worktrees/**"`) in your own `exclude` to lint it.

## [0.2.0]

Breaking for anyone installing the Agent Skills by name, or relying on where `compile` writes by default — see Changed.

### Added

- `init` offers an agent rule: `.agents/rules/wastech-mdlint.md`, a page that tells coding agents how the repository's Markdown is linted, that an `error` is fixed rather than silenced, and that a `SIZE-001` or `LLM-001` budget is answered by splitting a document rather than by cutting its content — with a table of who decides on a split for each kind of file and the procedure for one. Interactive runs offer it with a default of no; `--with-agent-rule` writes it under `--yes`. Only the config's location and the CLI invocation are generated, so the page cannot go stale against the config; it is never overwritten once it exists, and it is not wired into `AGENTS.md` or `CLAUDE.md` for you — the write summary says where it went and how to reference it.
- A fourth Agent Skill, `mdlint-docs`, walks an agent through such a split: find the budget findings, decide who owns the split, plan it from the `impact` blast radius, split by meaning, and verify with `lint`.

### Changed

- The Agent Skills drop the `wastech-` prefix: `wastech-mdlint-init`, `wastech-mdlint-fix` and `wastech-mdlint-impact` are now `mdlint-init`, `mdlint-fix` and `mdlint-impact`, so a skill is shorter to install and to invoke. They keep the `mdlint-` part rather than becoming bare `init` or `fix`, which would collide with a host's own built-in commands and with other projects' skills. Install by the new name — `gh skill install VladimirMakarevich/wastech-mdlint mdlint-init --pin v0.2.0` — from this release on; tags up to `v0.1.3` still carry only the old names. The packages, the `wastech-mdlint` and `wastech-mdlint-mcp` binaries and the config file name are unchanged.
- `compile` writes to `.claude/skills/mdlint/` by default instead of `.claude/skills/wastech-mdlint/`, matching the shorter skill names. A config that sets `compile.outdir` is unaffected. One that relied on the default leaves the previous release's `SKILL.md` behind, and an agent host would load it as a second, stale copy of the same skill — so `compile` names that file in its output when it finds it, and leaves deleting it (or setting `compile.outdir` back to the old directory) to you.

## [0.1.3]

No functional changes: the published code is identical to `0.1.2`.

### Changed

- Every package now declares npm `keywords` and a description that names it as a Markdown linter. npm search matches a query against a package's name, description and keywords; the published manifests carried no keywords and descriptions without the words "lint" or "linter", so a search such as `markdown linter` or `md linter` did not return any of the three packages — only the literal `mdlint` did. Package metadata is read from the published manifest, so changing it takes a new version.

## [0.1.2]

### Security

- `@wastech-mdlint/core` now depends on `picomatch` directly instead of `micromatch`, which removes `braces` from every installation. `npm audit` reported `braces` as high severity ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): stack exhaustion on deeply nested brace patterns, no patched release), so every repository that installed the linter inherited five high-severity findings. The vulnerable code was never reachable from wastech-mdlint — the matching call it made into `micromatch` already went straight to `picomatch`, which compiles `{a,b}` itself — but the finding could not be cleared without dropping the dependency.

### Changed

- Glob matching keeps the same ordered semantics: a `!` entry subtracts what the entries before it selected, a later entry adds it back, and a list of nothing but negations starts from everything. The pattern compiler moves from `picomatch` 2 to `picomatch` 4, which changes two rare extglob forms: a repeated extglob whose branches are themselves `*(…)` sequences, such as `+(*(a)|*(b))`, now honors every branch instead of only the first; and a trailing `/**` inside an extglob group, such as `test(/utils/**)`, now also matches the directory itself.

## [0.1.1]

No functional changes: the published code is byte-identical to `0.1.0`.

What differs is how it was published. `0.1.0` was published by hand, because npm cannot register a trusted publisher for a package that does not yet exist in the registry — the first release of each package necessarily precedes the trust relationship that would authenticate a workflow to publish it. `0.1.1` is the first release published from CI, and therefore the first carrying a provenance attestation linking the tarball to the commit and workflow run that produced it. Prefer it over `0.1.0` for that reason alone.

## [0.1.0]

First public release. Published manually and carries no provenance attestation; see `0.1.1`.

### Linting

- A registry-driven rule engine over a single Markdown parse pass, with 22 built-in rules across `TBL` (tables), `SEC` and `STR` (sections and structure), `REF` (references), `CTX` (content quality), and `GRP` (graph integrity), plus `SIZE-001` (byte, line, and token budgets) and `LLM-001` (eager-import budget).
- A declarative `custom` rule that composes a closed vocabulary of assertion primitives from configuration — no rebuild and no code execution.
- Per-rule severity, inline-disable directives, `--fix` for the deterministic fixes, text or JSON output, and CI-friendly exit codes.

### Context graph

- `graph`, `slice`, and `impact` commands over one shared `ContextGraph`: semantic edges, cycle detection, connected components, a topological reading order with the nodes a cycle excluded from it, and a coverage signal for Markdown files linked to but outside the corpus.

### Compile

- `compile` renders a project-specific `SKILL.md` from the repository's own documentation, deterministically, so the artifact can be diffed and cached by content.

### Configuration

- JSONC `wastech-mdlint.config.json` with a local `$schema` that resolves offline against the installed package, so an editor validates against the version actually present.
- `init` scans a repository, infers a configuration, and discloses what it excluded and why — including the counts for directories it pruned, so a corpus smaller than the tracked file list is explained rather than silent.
- With no configuration file at all, the CLI lints every Markdown file outside the always-excluded dependency and build trees with an empty ruleset, which is a clean pass.

### MCP server

- A stdio-only Model Context Protocol host over the same core pipeline, with six read-only tools: `lint`, `lint-files`, `context-graph`, `context-slice`, `impact-analysis`, and `compile-context`. No HTTP or SSE transport, and no code-plugin execution.

### Agent skills

- Three host-neutral skills — `wastech-mdlint-init`, `wastech-mdlint-fix`, and `wastech-mdlint-impact` — carrying no host-specific command-injection syntax, with each one's `compatibility` field pinned to this CLI version.

### Platform

- Node.js `>=24.17.0`, with no upper bound.
- Windows, macOS, and Linux are all supported: paths in public output are normalized to repository-relative POSIX form, ordering uses a code-point comparator rather than locale collation, and every product file is written through an atomic temp-and-rename path so a failed write cannot truncate an existing file.
- All analysis is local. No external HTTP link checking, no link cache, no remote schema resolution, and no install-time file writes.

[unreleased]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/VladimirMakarevich/wastech-mdlint/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/VladimirMakarevich/wastech-mdlint/releases/tag/v0.1.0
