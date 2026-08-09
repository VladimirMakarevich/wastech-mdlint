# Field test results — packed CLI and MCP server against an external monorepo (2026-08-09)

> **Status:** Complete · **Ran:** 2026-08-09 · **Procedure:** [field-test playbook](field-test-playbook.md) · **Roadmap:** [v2 Index](index.md)
>
> This document is the definition site for the finding ids `F-01` … `F-14`. [Phase P19](P19-field-test-remediation/index.md) is written against them and nothing else defines them.

## What was run

The [playbook](field-test-playbook.md) end to end — sixteen phases, from packing the three tarballs to reducing every finding to a fixture. The target was a private Angular/.NET monorepo, referred to below as **the target**: 202 tracked Markdown documents, 1.96 MB, six documentation areas, 31% of its letters Cyrillic, six nested `.gitignore` files, and 3319 on-disk `.md` once its dependency trees are counted.

Two things separate this run from the [2026-08-05 one](field-test-2026-08-05-debates.md):

- **The tool was installed into the target**, as three packed tarballs added to its own `package.json`, rather than run from a sandbox beside it. That is the scenario under test, and it is what produced the correction to F-01 below: read from inside our own checkout, the advisory picture is the opposite of what a consumer gets.
- **Every zero was backed by a negative control.** Twenty rule configurations that reported nothing were re-run deliberately broken; each fired. That discipline is what caught [F-07](#f-07--ctx-003-is-silent-and-green-when-its-glossary-path-matches-no-file), whose zero survived a corpus with no matching glossary and then survived a glossary path pointing at a file that does not exist.

## Result

**No blockers.** Fourteen findings — 4 major, 7 minor, 3 polish — and nineteen observations. Twelve of the fourteen reproduce on throwaway trees built by a script the run leaves behind; the other two are command-level and named as such.

What the list does not show, and the run established: 39 rule findings judged by hand and **all true positives**; both hosts agreeing on 459 lint messages, an identical graph document and a byte-identical 46 KB compiled skill; every documented glob semantic, exit code, and suppression form reproducing exactly; and three payload findings from the 2026-08-05 run closed.

### Three seams account for eleven of the fourteen

**Inference is sampled, and the config it writes is not** — F-03, F-04, F-05, F-06, F-10. `init` reads three to five files per cluster and writes a config that runs against the whole corpus. A rationale measured on the sample becomes a permanent justification for a rule the corpus experiences very differently, and the disclosure block describes a scan whose boundaries are not the written config's boundaries.

**A surface states something the reader can disprove in one command** — F-06, F-08, F-12, F-14. Each is small. Together they are the class that costs trust fastest, because `grep` refutes them.

**Silence where the product is otherwise loud** — F-07, F-09. Both are configurations that cannot do what they claim, accepted without a word, in a product whose `SIZE-001` refinement, `init` disclosure block and bounded dependency section are all built on the opposite instinct.

## Findings

| Id | Severity | Finding | Surface |
| --- | --- | --- | --- |
| [F-01](#f-01--the-committed-lockfile-pins-an-sdk-with-open-advisories-while-consumers-resolve-clean) | minor | The committed lockfile pins an SDK with open advisories, while consumers resolve clean | release hygiene |
| [F-02](#f-02--files-on-ref-001ref-003-is-rejected-with-a-bare-unrecognized-key) | polish | `files` on REF-001/REF-003 is rejected with a bare `Unrecognized key` | config diagnostics |
| [F-03](#f-03--the-rule-set-init-proposes-makes-the-first-lint-report-459-findings) | major | The rule set `init` proposes makes the first `lint` report 459 findings, 94% from one rule | `init` inference |
| [F-04](#f-04--init-writes-mincyclelength-2-reinstating-the-class-the-default-excludes) | major | `init` writes `minCycleLength: 2`, reinstating at `error` the class the default excludes | `init` inference |
| [F-05](#f-05--the-scan-disclosure-counts-directories-and-lists-names) | polish | The scan disclosure counts directories and lists names, so two lines do not reconcile | `init` disclosure |
| [F-06](#f-06--the-scan-disclosure-reports-files-as-excluded-that-the-written-include-covers) | minor | The scan disclosure reports files as excluded that the written `include` covers | `init` disclosure |
| [F-07](#f-07--ctx-003-is-silent-and-green-when-its-glossary-path-matches-no-file) | major | `CTX-003` is silent and green when its glossary path matches no file | rule runtime |
| [F-08](#f-08--ref-005-says-never-referenced-when-it-means-not-in-the-id-column) | minor | `REF-005` says "never referenced" when it means "not in the ID column" | rule messages |
| [F-09](#f-09--two-custom-rules-may-share-an-id-and-both-run-under-it) | minor | Two custom rules may share an id, and both run under it | config validation |
| [F-10](#f-10--a-merge-appends-a-rule-justified-by-files-the-config-does-not-lint) | minor | A merge appends a rule justified by files the config does not lint | `init` merge |
| [F-11](#f-11--a-message-containing-a-newline-breaks-the-text-report-into-phantom-files) | major | A message containing a newline breaks the text report into phantom files | output rendering |
| [F-12](#f-12--graphs-top-hubs-ranks-by-total-degree-and-compile-disagrees-with-it) | minor | `graph`'s "top hubs" ranks by total degree, and `compile` disagrees with it | graph reporting |
| [F-13](#f-13--the-skillmd-sections-that-scale-with-the-corpus-are-the-ones-nobody-bounds) | minor | The `SKILL.md` sections that scale with the corpus are the ones nobody bounds | compile |
| [F-14](#f-14--the-two-hosts-name-the-impact-records-subject-differently) | polish | The two hosts name the impact record's subject differently | host contracts |

### F-01 — the committed lockfile pins an SDK with open advisories, while consumers resolve clean

`npm ci && npm audit --omit=dev` in this repository reports **five production-tree advisories** (2 high, 3 moderate), all arriving through `@modelcontextprotocol/sdk@1.29.0`, which the lockfile pins at the top of the vulnerable range `1.25.0 - 1.29.0`. Installing the packed artifacts into another repository resolves the declared `^1.29.0` to `1.30.0` and audits **zero**.

So "we ship known-vulnerable transitive dependencies" is false — the range we publish resolves clean. What is true is narrower and still worth fixing: CI runs `npm ci`, so every test, every packed artifact and every contributor's machine exercises the vulnerable versions while no user does. The declared range already admits the fixed version, so nothing about the published contract changes.

**This correction only exists because the install went into a real repository.** Reading `npm audit` from inside our own checkout gives the opposite conclusion.

### F-02 — `files` on REF-001/REF-003 is rejected with a bare `Unrecognized key`

`{"rule":"REF-001","options":{"files":["docs/**"]}}` fails with `config.rules[0].options: Unrecognized key: "files"` — correct, and unhelpful at exactly the moment the user's model is wrong. REF-001 and REF-003 are the two rules that take no file scope, and whose `exclude` filters **link and image targets** rather than source documents. That is documented in three places, so this is not a hidden trap; it is a diagnostic that knows the answer and does not give it, in a product that answers an unknown rule id with `Did you mean "REF-001"?`.

The two mistakes it fails to separate are not equivalent. `files` is a hard error, which is safe. `exclude` meaning "skip these source files" type-checks, runs, and quietly filters something else: on the target, excluding one path removed exactly the three of six findings whose _targets_ lived there, while both source documents stayed fully in scope.

### F-03 — the rule set `init` proposes makes the first `lint` report 459 findings

`init --yes` then `lint` on the target: 151 files, **24 errors and 435 warnings**, exit `1`.

| Rule | Findings | Verdict on reading them |
| --- | --- | --- |
| `CTX-002` | 433 across 42 files | true but unusable — 97 in one document literally named `03-checklist.md` |
| `GRP-001` | 8 errors | documentation cross-links, not defects — see F-04 |
| `REF-001` | 16 across 10 files | genuinely valuable, all true positives |
| `TBL-002` | 2 | true, low value |

Eighteen of 459 are worth acting on. The cause is structural rather than a bug: inference reads three to five sampled files, so its rationale for `CTX-002` was `Sampled files contain 29 checklist item(s)` — a number that reads as small and is fifteen times off the corpus total. The same sampling that makes inference cheap makes it blind to volume, and volume is the whole question for a rule like this one.

What makes it a finding rather than a preference is that this repository already holds the opposite position in writing, in its own config, and applies it by hand: start with rules that measure zero, and let the set grow as each is brought to zero. `init` is the surface where that policy should be automatic and is the one place it is not — and in the same run it offers a CI workflow that would be red on the first push.

### F-04 — `init` writes `minCycleLength: 2`, reinstating the class the default excludes

On a repository whose sampled files contain a two-document mutual link, `init` writes `{"rule":"GRP-001","options":{"minCycleLength":2}}`. On the target that turned 2 findings into 8, six of them ordinary index-and-member back-links at `error`.

This is deliberate: `rule-inference.ts` lowers the floor so the cycle its draft cites is one the proposed config would actually report, and the comment explains that. But the trade was made against a decision in the [accepted-behaviors register](accepted-behaviors.md), which raised the default floor to 3 for this precise reason — at `error` an ordinary documentation shape failed the build, and the likely response is disabling the rule and forfeiting the genuine multi-hop cycles too. `init` hands a new adopter the pre-decision behavior.

The disclosure-fidelity goal can be met without the option: cite the sampled cycle **and** say the proposed config will not report it below the floor — the same "state the decision rather than leave it latent" move the Not-proposed-by-init block already makes for `SIZE-001` and `LLM-001`.

### F-05 — the scan disclosure counts directories and lists names

```text
build and dependency directories: 3 directories skipped by name, contents not counted — .git, node_modules.
gitignored directories: 26 directories skipped, contents not counted — .angular, .worc, Pods, bin, capacitor-cordova-android-plugins, +6 more.
```

Three directories, two names. Twenty-six directories, eleven names. Both are internally correct — the target really has two `node_modules` trees plus one `.git` — but the sentence puts a count and a deduplicated list on either side of a dash and invites the reader to reconcile them. The hidden-directories line is exact and checkable by comparison, and is the shape the other two should follow.

Worth fixing precisely because the block exists to be trusted without verification.

### F-06 — the scan disclosure reports files as excluded that the written `include` covers

The block states `63 Markdown files in 4 directories whose name starts with a dot — .agents (23), .claude (28), backend/.rules (6), mobile/.rules (6). The scan never proposes a dot-directory as a doc cluster, so no include pattern above names one` — while the `include` two lines above contains `backend/**/*.{md,mdx}` and `mobile/**/*.{md,mdx}`, which match dotfiles. All 12 files under the two `.rules/` directories were in the resulting corpus.

The sentence is literally true and the inference it invites is false for 19% of its own count, and the advice compounds it: adding a pattern for a directory already covered. The consequence was visible on the same run — two of the eight cycles `GRP-001` reported were in files the user had just been told the scan excluded.

### F-07 — `CTX-003` is silent and green when its glossary path matches no file

`{"rule":"CTX-003","options":{"glossary":"nope.md","termColumn":"Term"}}` reports `No problems found.` and exits `0`. Nothing on stderr, nothing in the JSON, no diagnostic anywhere.

Three separate misconfigurations collapse into the same silent pass in `packages/core/src/engine/rules/ctx.ts`: a `glossary` glob matching no document, a glossary document whose tables carry no `termColumn`, and a missing `aliasColumn`. Each is a `continue`, and the check returns early on an empty alias map.

This is the failure mode the rest of the product is built against. A user configures glossary enforcement, sees green, and ships — while the rule has been inert since the day the glossary file was renamed. Nothing distinguishes "your corpus uses canonical terms" from "this rule never ran". It is easy to reach: the option takes a **path** and a **column name**, and either can drift while the config stays valid. The product has the right answer twice already — `SIZE-001`'s refinement rejects a configuration that would measure nothing, and `init`'s Not-proposed block states a decision rather than leaving it latent.

### F-08 — `REF-005` says "never referenced" when it means "not in the ID column"

Over a definitions table and reference documents that mention the ids in prose, REF-005 reports `Definition "TD-BE-001" is never referenced.` for five ids, four of which `grep` finds in reference documents — one of them in a filename.

The rule behaves as designed and as documented: its page says references are read from the `idColumn` of a table only. The correct conclusion is that REF-005 does not fit that corpus, and the message does not let a reader reach it. It states a fact about the world that the world contradicts, and the reader's next move is to distrust the tool rather than re-read the rule page. On the target, four of the five were also closed items, so the one finding that might have been actionable was buried in four that looked wrong.

### F-09 — two custom rules may share an id, and both run under it

Two `custom` entries with `id: "PROJ-DUP"` and different assertions both load and both execute; the report carried 21 findings, 16 from one and 5 from the other, all labelled `PROJ-DUP`.

The product validates ids carefully and says so well: a reserved built-in prefix is rejected with `use your own namespace, e.g. "REQ-100"`, and an unnamespaced id with `must be uppercase, dash-separated with at least one dash`. Duplication is the third way to end up with an id that does not identify one rule, and the only one that passes. Downstream, the report cannot say which rule fired, `severity` may differ between the two entries with no way to tell which applies, and an inline `wastech-mdlint-disable PROJ-DUP` silences both — including the one the author meant to keep. A config that grows by copy-paste is exactly how two entries end up sharing an id.

### F-10 — a merge appends a rule justified by files the config does not lint

`init --on-existing merge` over a config whose `include` is `docs/**/*.md`, in a repository whose only images and tables live outside `docs/`, appends `REF-003` and `TBL-002` with rationales measured on those outside files.

Two correct behaviors meeting. Inference samples the **repository scan**, which walks every non-ignored directory; a merge preserves the existing `include` exactly, and documents that it does. So on a merge the two disagree by construction: the scan sees a directory, infers a rule from it, and appends the rule to a config whose `include` will never select those files. The rationale comment then states a measurement that is true of the scan and false of the run — and it is written into the config as a permanent justification. Any repository whose `include` is narrower than its Markdown — a docs-only config in a monorepo, the common case — hits this on the first merge.

### F-11 — a message containing a newline breaks the text report into phantom files

The text report's grammar is that an unindented line is a file and an indented line is a finding. A checklist item wrapped across two source lines makes `CTX-002` quote a message containing a literal newline, and `format-lint-result.ts` interpolates it straight into its one-line template:

```text
  48  warning  Checklist item is not checked: "Invitation events (…)
delivered to the initiator (group user:{id}).".  CTX-002
```

The second line is not a file, and everything after it is attributed to it. On the target, 16 of 459 findings rendered this way; parsing the report back recovered 443 findings and produced **63 file names where the corpus has 54**.

JSON is unaffected — it escapes the newline — and the summary counts stay correct, which is why nothing looks wrong. The human report is the default output: a reader sees a filename that is really the tail of a sentence, and anything consuming the text (a CI annotator, an editor problem matcher, a per-file count) inherits the error silently. Any rule that quotes source text can produce this; `CTX-002` is simply the one a real corpus exercises.

This is the class the `host-parity` guard exists to catch, and it survived because the two sides of a parity comparison have to be **different formulations** of the run: recomputing the text with the renderer's own helper agrees with itself here.

### F-12 — `graph`'s "top hubs" ranks by total degree, and `compile` disagrees with it

| Listed as | Human number | In | Out | What it is |
| --- | --- | --- | --- | --- |
| a page-controls document | 290 | 18 | 272 | ranked first, 94% of its rank outgoing |
| an architecture document | 76 | 23 | 53 | genuinely central |
| a pre-implementation audit | 68 | **1** | 67 | an index referencing 67 documents, referenced by one |
| a conversation-thread page | 47 | 45 | 2 | the corpus's real hub, ranked fourth |

The number is documented — the context-graph guide says a `top hubs` item is `path (degree)`. What is not defensible is the word attached to it, because this product defines "hub" precisely and differently elsewhere: `compile`'s `hubMinInDegree` (default 3) classifies by **in-degree**, and it classified that third entry as `bridge`, printing `1 / 67` in its own `Refs (in/out)` column. Two shipped surfaces give a reader opposite answers about one document, and the one that gets it right is the one that shows both degrees.

The cost is a misdirected reader: a maintainer opening `graph` to find what must not break is handed the document that depends on everything else.

### F-13 — the `SKILL.md` sections that scale with the corpus are the ones nobody bounds

A compiled skill over 151 documents is 823 lines and ~11 600 estimated tokens:

| Section | Tokens | Share | Bounded? |
| --- | --- | --- | --- |
| `Document Dependencies` | 8 273 | 71% | **yes**, and it says so precisely |
| `Document Architecture` | 3 052 | 26% | no — one table row per document |
| Context Budget + Document Rules + Workflow + frontmatter | 275 | **2.4%** | n/a |

The bounding is inverted with respect to growth. `Document Dependencies` — capped at the 25 most-referenced documents and 10 references per direction, with the omission stated and `graph --format json` named as the full source — is **O(1)** in corpus size. `Document Architecture` and `Reading Order` carry no cap and no disclosure and are **O(n)**: 3 052 tokens here, roughly 20 000 on a 1000-document corpus, in a file whose whole purpose is to be loaded whole.

The caps that exist are excellent; they were placed on the section that does not grow. Separately, everything a reader would call orientation is 2.4% of the artifact, and the other 97% is two listings, one of which the artifact itself says is available on demand.

### F-14 — the two hosts name the impact record's subject differently

The MCP `impact-analysis` record calls its subject `file`; the CLI's `impact --format json` calls it `changedFile`. [Output & exit codes](../guide/output.md) states the CLI returns "the same record MCP returns, under a `lint` key, narrowed to the affected subgraph".

The `lint` half is exactly as documented and is a real difference in capability, not a defect. The rename is the part nothing accounts for, and a client generated from the MCP `outputSchema` will not find `file` in the CLI's JSON. Small, and worth fixing precisely because everything else about these two hosts lines up to the byte: 459 identical messages, an identical graph document, and a compiled skill identical across 46 397 characters.

## Observations kept out of the finding list

Recorded during the run and deliberately **not** filed as findings, because each is a documented decision, a measurement, or a property of the procedure rather than of the product:

- The zero-config corpus on the target was 1.6× the corpus anyone wants linted, because `respectGitignore` is off by default and 88 gitignored files were a tool's own run logs. The default is right and the reason is documented; the magnitude is what a fixture cannot show.
- `GRP-002` flagged 52% of the corpus, because half of it is entered by directory convention rather than by link. `entryPoints` accepts globs, and three of them removed 65 of 106 findings.
- The MCP error contract is **merged into** each tool's own output shape rather than replacing it, so a schema-generated client still receives a typable document on an error. The recorded wire-schema gap reproduces and reads acceptably; what it loses is machine-readability, not the message.
- The token estimate charges 2.04 tokens per word over a corpus whose letters are 31% Cyrillic. **No tokenizer was available offline**, so no ratio against a real one is claimed.
- Wall-clock figures taken as first-runs-of-session were cold-cache: warm, every command lands at 0.33 s regardless of 40, 151 or 325 files, which measures start-up rather than scaling.
- `mermaid` and `dot` emit the whole graph — 151 nodes, 744 edges — with no cap and no note, unlike `compile`'s dependency section. Whether the rendered diagram is usable at that size was **not measured**; no renderer was available.

## What the run could not reach

Stated so a later round does not read silence as coverage:

- **A second platform.** Windows path behavior is unverified here, which is the same gap the seven skipped Windows drive-path guards show from the suite's side.
- **`init`'s interactive branches** — deselecting every cluster, Ctrl+C, Enter-on-default — and the `npx` `$schema` fallback in a repository with nothing installed. The custom-rule path to a project-local `schema.json` _was_ reached.
- **A real MCP host.** The server was driven over raw stdio frames, which is what a host does on the wire, but nothing here judges how an agent reads the tool descriptions.
- **`settings.siteRouter` and `settings.idRef`**, and `slice` resolution by defined ID — the target has no site router and no tabular ID pipeline.
