# Ideas from markdown lint — context and document-pattern rules

> Status **Backlog**. Ideas collected by comparing markdown lint's rule catalog with this tool's 24 built-in rules. This is task documentation: it is deleted once its items have landed or been rejected, and nothing outside it may depend on it. Rule IDs below are proposals, not reservations.

## Scope decision

The product's focus is context: how documents link to each other, and the patterns that specific document types follow and keep following as they are maintained. Ideas are judged against that focus, not against markdown lint's coverage.

Deliberately out of scope:

- **Formatting.** 34 of markdown lint's 53 rules are whitespace, indentation, list markers, heading and emphasis style, table pipes and line length. Prettier or markdown lint itself already enforce them with autofix; duplicating them here would double every finding and start arguments about style. MD013 (line length) also contradicts `proseWrap: "never"`, and the context-relevant size measure already exists as SIZE-001.
- **Executable custom rules.** markdown lint's `customRules` loads user JavaScript. Here, extending the closed `custom` assertion vocabulary is the answer.
- **Inline configuration.** `markdown lint-configure-file` puts rule config inside a document, so the resolved config would depend on document content and would be invisible in `wastech-mdlint.config.json` and to the MCP tools.
- **Banning inline HTML (MD033).** HTML is legitimate in this corpus: suppression directives, generated-section markers, `<details>`, `<a id>` anchors.

## Defects found while comparing

Probing the built v0.1.2 CLI on small fixtures showed five places where an existing rule is wrong or silent. These are the P1 evidence.

| # | Input | What happens today | Why it matters |
| --- | --- | --- | --- |
| 1 | A file opening with a YAML front matter block (`name:` / `description:` between `---` fences) | Parsed as a setext H2 heading with slug `name-demo-skilldescription-does-a-thing`; a link to that slug passes REF-002 | `SKILL.md`, agent files and docs-site pages all carry front matter, so SEC-\*, CTX-001, slugs and `slice` by `#slug` see a heading that does not exist |
| 2 | `<a id="custom"></a>` with a link to `#custom`; links to `#top` and `#L5` | REF-002 reports all three as broken | False errors on anchors GitHub renders correctly; a case-only mismatch (`#Demo` for `# Demo`) is reported too, which is correct by default but fixable |
| 3 | A table row with more cells than the header, and one with fewer | The extra cell is dropped, the short row is padded with `""`, nothing is reported | TBL rules check a table that is not what the author wrote; TBL-002 calls a malformed row an empty cell |
| 4 | `[text][missing]` with no `[missing]: …` definition | The node is skipped during parsing and never reaches `links` | No rule and no graph edge ever sees the broken reference |
| 5 | `[text]()` | Recorded with an empty target, which REF-001 ignores | A broken link passes the link check |

## P1 — make the existing rules trustworthy

S is up to a day, M is two to four days; both include tests, the rule page, `schema.json` and the generated README table.

| Item | From markdown lint | Size | Depends on |
| --- | --- | --- | --- |
| Parse front matter in the single parse pass (`remark-frontmatter`), expose it as a `ParsedDocument` field, and keep it out of headings and sections | `frontMatter`, `front_matter_title` | M | — |
| REF-002 accepts HTML `id` / `name` anchors, `#top` and GitHub line fragments (`#L10`, `#L10C5-L12C3`); add `ignoreCase` and `ignoredPattern` options | MD051 | S | — |
| TBL-007 — every row has exactly as many cells as the header | MD056 | S | — |
| REF-007 — reference links and images use a defined label; the parser stops dropping undefined ones | MD052 | S | — |
| REF-008 — no empty link targets (`()`, `(#)`) and no reversed `(text)[url]` syntax | MD042, MD011 | S | — |

## P2 — document structure and per-type patterns

These rules protect the outline that SEC, TBL, CTX and `slice` already rely on, and let a repository pin the shape of a document type.

| Item | From markdown lint | Size | Depends on |
| --- | --- | --- | --- |
| FM-001 — front matter schema: required keys, allowed values, patterns; the same checks as new `custom` kinds. Needs a YAML parser dependency, which core does not have today | builds on `front_matter_title` | M | Front matter parsing |
| SEC-003 `strict` mode — exact outline from the template file with `*` (zero or more), `+` (one or more) and `?` (exactly one) wildcards: presence, order and no extra sections in one rule | MD043 | M | — |
| SEC-004 — heading levels increment by one, a single top-level heading, a title at the start of the file (front matter `title` counts) | MD001, MD025, MD041 | M | Front matter parsing |
| SEC-005 — no duplicate headings, optionally only among siblings; duplicates make a `section` option ambiguous and turn anchors into order-dependent `-1` slugs | MD024 | S | — |
| SEC-006 — no bold or italic paragraph standing in for a heading; such a "section" is invisible to SEC-001, CTX-001, `section` options and `slice` | MD036 | S | — |
| More deterministic `--fix`: anchor case in REF-002, removal of unused reference definitions, alias to canonical term in CTX-003. markdown lint marks 33 of 53 rules fixable; this tool has 2 of 24 | MD051, MD053, MD044 | M | REF-002, REF-007 |

## P3 — context quality and ergonomics

| Item | From markdown lint | Size | Depends on |
| --- | --- | --- | --- |
| CTX-004 — descriptive link text; an agent decides whether to follow a link from its text, and "here" carries nothing. Default list in English and Russian | MD059 | S | — |
| CTX-005 — images have alt text; a model does not see the image, so alt is all that reaches the context. `ParsedImage` has to start keeping it | MD045 | S | — |
| CTX-006 — fenced code blocks declare a language, which tells an agent whether a block is a command, a config or output | MD040 | S | — |
| Directives `disable-file`, `capture` / `restore`, and a category (`REF`) in place of a rule ID | inline directives, tags | S–M | — |
| Human-readable rule aliases in the registry, accepted in config and directives, so a suppression explains itself | aliases | S | — |
| A guide page on running alongside markdown lint, with a ready config that turns MD051 off in favour of REF-002 | — | S | — |

## Notes for whoever picks an item up

- A new document-scope rule that should be narrowable mixes in the shared `files` / `exclude` shape. The registry inventory test pins exactly which rules carry it, so adding one means updating that list and giving the rule's family test an `exclude` case.
- Where a new rule is a reusable check, expose it as a `custom` assertion kind too, so a repository can apply it per document family under its own ID.
- Parser changes stay inside the one parse pass that produces `ParsedDocument`. The items above need four new pieces of data there: front matter, undefined reference labels, image alt text and fenced code blocks.