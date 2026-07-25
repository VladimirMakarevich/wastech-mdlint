# Deep audit of the full mdlint solution (`feat/p9-remediation`)

## Question and headline conclusion

**Question.** Walk the entire `wastech-mdlint` v2 solution as it stands on `feat/p9-remediation`
— core engine and its primitives, `compile/`, `discovery/`, `config/`, the generated
`engine/schema.ts` enum, the CLI and `init`, the MCP server, the committed
`packages/cli/schema.json`, and the requirements/glossary/guide docs plus the test suite — and
surface every real business/logic defect, technical problem, omission/gap, and shortcoming, each
tied to concrete `path:line` evidence measured against the plan of record. Fix nothing.

**Headline conclusion.** The solution is in good shape. The P9/P10 remediations that closed the
[P0–P8 audit](../../mdlint_v2/audit-2026-07-23-p0-p8.md) have landed, the architecture invariants
hold (core owns the pipeline; CLI and MCP are thin adapters; one `ContextGraph`; deterministic
repo-relative POSIX output; JSONC config with a local `$schema`; stdio-only read-only MCP), and
**no HIGH / release-blocking defect was found.** This pass identifies **6 findings** — 4 confirmed
and 2 that need confirmation — none higher than Medium. The two to address first are **BL-1**
(the `STR-001` rule can only see the Markdown corpus, so its guide's `LICENSE` example is
falsified and a present non-`.md` required file is reported missing) and **TP-1** (the
`columnMatches` primitive reuses a stateful `g`/`y` `RegExp` across table rows, producing
order-dependent false findings).

Every `path:line` below was re-opened and confirmed on `feat/p9-remediation` during this pass. The
one finding that rests on an external contract (TP-1) is validated against MDN/ECMA-262.

---

## Findings

### Category 1 — Business/logic defects

#### BL-1 · `STR-001` only sees the Markdown corpus, and its guide overstates it — *Medium, confirmed*

**What is wrong.** `STR-001` ("Required files exist in the project") decides whether each entry in
its `files` option is satisfied by scanning `context.projectFiles`
(`packages/core/src/engine/rules/sec.ts:205`, `check` at `:204`). That set is populated in
`lintFiles` from the loaded document map — `const projectFiles = [...documents.keys()]`
(`packages/core/src/engine/lint-files.ts:87`), whose keys come from
`loadDocuments(input.config.include ?? ["**/*.md"], …)` (`packages/core/src/engine/lint-files.ts:75`).
So the satisfaction set is the `include`-matched Markdown corpus (default `**/*.md`) — **never the
filesystem.** A required entry that is not a Markdown file within `include` — the guide's own
`LICENSE` example, or a `package.json` — is reported *missing even when it exists on disk*.

The membership test compounds it: `matchesConfigGlob` normalizes a bare required entry like
`README.md` to `**/README.md` (`packages/core/src/discovery/globs.ts:7`, the `**/${…}` rewrite),
so a required *root* file is satisfied by any `docs/**/README.md` anywhere in the tree — `STR-001`
cannot pin a required file to a location.

**Standard it falls short of.** The guide claims `STR-001` "scans the analyzed file corpus"
(`docs/guide/rules/STR-001.md:8`) yet motivates it with *"every project must ship a `README.md`, a
`CONTRIBUTING.md`, a `LICENSE`"* (`docs/guide/rules/STR-001.md:11`) and asserts "literal paths must
match exactly" (`docs/guide/rules/STR-001.md:66`). The `LICENSE` example and the "match exactly"
claim are both falsified by the code above. This is a documentation-vs-implementation mismatch of
the kind the audit's acceptance criteria require recording as a finding.

**Why it matters.** A user who follows the guide and requires `LICENSE` gets a false `error`
finding on a compliant repository — a real, user-visible correctness gap in a `project`-scope
structural rule, plus doc drift. The one relevant test never exercises the failure mode: it
requires `LICENSE.md` (a `.md` file) and only asserts genuinely-absent names
(`packages/core/test/rules-str.test.ts:54`), so the false-missing case for a present non-`.md`
file is untested.

**Recommended direction.** Resolve each required path against the filesystem (a bounded
`existsSync`-style probe from the analyzed root) rather than only the corpus, *or* narrow the guide
and the corresponding requirement wording to "required Markdown files within `include`" and drop
the `LICENSE` example and the "literal paths must match exactly" claim. Either way, add a
regression fixture with a present non-`.md` required file. If the location-pinning behavior is
intended, document that bare names are corpus-wide globs.

---

### Category 2 — Technical problems

#### TP-1 · `columnMatches` reuses a stateful `g`/`y` `RegExp` across rows → false findings — *Low–Medium, confirmed (incl. external)*

**What is wrong.** The `columnMatches` primitive compiles its pattern once
(`const regex = compileRegex(options.pattern, options.flags)`,
`packages/core/src/engine/primitives/table.ts:137`) and then calls `regex.test(value)` inside the
per-row loop (`packages/core/src/engine/primitives/table.ts:147`). When the configured `flags`
include `g` or `sticky` (`y`), a `RegExp` is stateful: `test()` advances and consults `lastIndex`
across calls, so consecutive tests over different cells start matching from a stale offset. The
flag validator only checks that flags are *legal* — `regexFlagsSchema` at
`packages/core/src/engine/regex.ts:25` refines on `isValidRegex(".", value)` — so `g`/`y` pass
untouched. On an anchored pattern like `^REQ-\d+$` with `"flags": "g"`, valid cells after the first
match are wrongly flagged, and the result is order-dependent.

Both the built-in rule and the declarative `custom` path are affected: `TBL-004` forwards `flags`
into `columnMatches` (`packages/core/src/engine/rules/tbl.ts:207` declares
`flags: regexFlagsSchema.optional()`), and the `custom` `columnMatches` assertion accepts the same
(`packages/core/src/engine/primitives/assert.ts:67`).

**Standard it violates.** `RegExp.prototype.test()` statefulness with `g`/`y` is authoritative
JavaScript semantics — MDN, reflecting ECMA-262 §22.2.6.16, states that `g`/`y` regexes store a
`lastIndex` and `test()` does not reset it even across different strings (see `sources.json`,
external). It breaks the architecture invariant that findings are *deterministic*. The correct
pattern sits right next door: `contentNotMatch` force-adds `g` and consumes state per-call via
`matchAll` (`packages/core/src/engine/primitives/content.ts:14` comment, `:22` the `matchAll`
call), which — per MDN — *requires* `g` and is not vulnerable to cross-call `lastIndex` bleed. The
`TBL-004` guide even lists `flags` as "e.g. `i`, `m`" without warning that `g`/`y` are unsafe
(`docs/guide/rules/TBL-004.md:25`).

**Why it matters.** A perfectly valid config (`flags: "g"` on a membership pattern) yields false
positives/negatives that shift with row order — a determinism regression that is hard to diagnose.
No test exercises a `g`/`y` flag; the `TBL-004` test uses a flag-less `^BUG-`
(`packages/core/test/rules-tbl.test.ts:80`).

**Recommended direction.** Make the per-row test stateless — reset `regex.lastIndex = 0` before
each `test()`, or strip `g`/`y` when compiling a membership check, or reject `g`/`y` in the
`columnMatches`/`TBL-004` `flags` schema (a membership test has no use for either). Add a
regression fixture with `"flags": "g"` over a multi-row column, and note the constraint in the
`TBL-004` guide.

---

### Category 3 — Omissions / gaps

#### OG-1 · The MCP `lint` tool cannot run declarative custom rules — *Low, needs confirmation*

**What is wrong.** The ad-hoc `lint` MCP tool validates its `rules` input as
`z.array(ruleEntrySchema)` (`packages/mcp-server/src/tools/lint.ts:44`) — the built-in-only entry.
A `{ "rule": "custom", … }` entry is rejected, so the tool cannot run a declarative `custom` rule,
and its description (`packages/mcp-server/src/tools/lint.ts:194`) does not disclose the limitation.

**Standard it falls short of.** Requirement M8 states the MCP server "executes **declarative custom
rules** (pure data) but never loads Tier-2 code-plugins" (`docs/mdlint_v2/requirements/05-mcp-server.md:55`;
summarized in the M8 table row at `:20`). The full `lint-files` path honors custom rules via loaded
config; only the ad-hoc `lint` tool narrows them out. This is the thin-adapter surface diverging
from what the requirement says the server supports.

**Why it matters.** An agent that composes a one-off `custom` assertion and calls `lint` gets a
schema-validation error with no explanation, and nothing tells it to route custom rules through
`lint-files`. Likely an intentional narrowing (ad-hoc lint takes an explicit built-in rule set),
but it is undocumented, which is why this is recorded as *needs confirmation* rather than asserted
as a defect.

**Recommended direction.** Either accept the custom-rule union in the `lint` input schema, or state
in the tool description that ad-hoc `lint` is built-in-rules-only and that declarative `custom`
rules run through `lint-files`. Whichever is chosen, make the requirement and the description agree.

---

### Category 4 — Shortcomings

#### SC-1 · `GRP-001`/`GRP-002` accept options that are silently ignored — *Low, confirmed*

**What is wrong.** `GRP-001`'s options schema declares `siteRouter` plus the shared file-scope
shape (`files`/`exclude`) (`packages/core/src/engine/rules/grp.ts:34` and the `...fileScopeShape`
at `:35`), but its `check` takes no options at all — `check: () => (context) => {…}`
(`packages/core/src/engine/rules/grp.ts:38`) — and reads only the shared corpus-wide
`ContextGraph`. So `files`/`exclude`/`siteRouter` validate but do nothing. `GRP-002` similarly
declares `siteRouter` (`packages/core/src/engine/rules/grp.ts:74`) which is never consulted (its
`files`/`exclude` *are* honored via `matchesFileScope`, and `entryPoints` is honored).

**Standard it falls short of.** This is acknowledged in the code as forward-compat — the comment at
`packages/core/src/engine/rules/grp.ts:21` says the options "are accepted for forward-compat but do
not re-scope the shared corpus-wide graph in P3." It is a shortcoming rather than a contract
violation, but a config key that passes strict validation yet has no effect is a footgun.

**Why it matters.** A user who scopes `GRP-001` with `files` expecting a per-rule cycle check gets
silent full-corpus behavior with no diagnostic — the strict schema actively signals the option is
supported.

**Recommended direction.** Either wire the options (re-scope the graph query per rule instance) or
remove them from the schema until they are honored, so validation stops advertising a no-op.

#### SC-2 · `SIZE-001` can emit duplicate same-severity findings under a `severity` override — *Low, confirmed*

**What is wrong.** `SIZE-001` fires the warn-budget and error-budget findings independently for one
metric (`packages/core/src/engine/rules/size.ts:94` comment, then the two `context.report` blocks).
Severity resolution lets a config override win over the per-finding hint —
`severity: severityOverride ?? finding.severity ?? rule.defaultSeverity`
(`packages/core/src/engine/run-rules.ts:42`). So a file over both thresholds with a config
`severity: "error"` override renders both findings as `error` — two near-duplicate messages for the
same metric on the same file.

**Standard it falls short of.** The independent-firing behavior is intentional (the code comment
cites P3.07), but the override interaction is undocumented — this is a rough edge, not a spec
violation.

**Why it matters.** Duplicate same-severity findings inflate counts and noise for one underlying
condition, which can mislead a user reading the report or wiring exit-code thresholds.

**Recommended direction.** Suppress the redundant lower-threshold finding when an override collapses
the two severities to the same value, or document the interaction in the `SIZE-001` guide.

#### SC-3 · Unbounded recursive DFS in cycle detection / import traversal — *Low, needs confirmation*

**What is wrong.** Four graph/import traversals recurse with no explicit depth guard:
`strongConnect` (`packages/core/src/graph/build-context-graph.ts:282`) and `walk`
(`packages/core/src/graph/build-context-graph.ts:343`) in graph construction, the eager-import
`visit` (`packages/core/src/engine/rules/llm.ts:66`, self-call at `:112`), and the rule-inference
cycle sampler `visit` (`packages/core/src/discovery/rule-inference.ts:284`).

**Standard it falls short of.** No documented corpus-size bound exists, and v2 rebuilds the graph
non-incrementally. A pathologically deep link/import chain (many thousands of documents in one
component) could exceed the Node call stack. This is the generic recursion caveat, not a specific
upstream contract — hence *needs confirmation*; it is almost certainly fine for realistic repos.

**Why it matters.** If very large corpora are ever in scope, an uncaught `RangeError: Maximum call
stack size exceeded` would surface as an opaque crash rather than a structured diagnostic.

**Recommended direction.** Document the practical corpus-size assumption, or convert the hottest
traversal (`strongConnect`) to an explicit worklist stack if very large repositories are a target.

---

## Recommended priorities and trade-offs

- **Address first: BL-1.** It is the only finding with a user-visible false result on a compliant
  repository *and* a falsified guide claim. The lowest-risk fix is documentation-only (narrow the
  guide/requirement to "Markdown within `include`"), which ships immediately; the higher-value fix
  (filesystem resolution) changes a `project`-scope rule's reach and needs a fixture for the
  present-non-`.md` case. Trade-off: doc-only is honest and cheap but leaves the rule unable to
  verify `LICENSE`; filesystem resolution restores the guide's promise but widens what the rule
  touches beyond the parsed corpus.
- **Then TP-1.** Resetting `lastIndex` per row is the minimal fix; rejecting `g`/`y` in the schema
  is stricter and self-documenting but is a (tiny) breaking change for any config that already sets
  a harmless `g`. Prefer schema rejection plus a guide note, since a membership test has no
  legitimate use for `g`/`y`.
- **OG-1** is a small schema-or-docs decision; resolving the intent unblocks a clean one-line fix
  either way.
- **SC-1/SC-2/SC-3** are low-cost hygiene: prefer removing the dead `GRP` options over wiring them
  (YAGNI until a phase needs per-rule graph scoping), and prefer documenting SC-2/SC-3 over
  restructuring, since both are working-as-designed with only a sharp edge.

---

## Open questions

These are unresolved or unverified and are **not** asserted as confirmed defects:

- **OG-1 (custom rules in MCP `lint`).** Confirmed that the schema rejects `custom` entries and the
  description is silent; *unconfirmed* whether that narrowing is intentional. Needs a maintainer
  decision (widen schema vs. document the limit) before it is a defect vs. an accepted boundary.
- **SC-3 (recursive DFS depth).** The four recursion sites are confirmed to lack a depth guard;
  *unverified* whether any realistic corpus can reach the stack limit. No upstream contract settles
  this beyond the generic Node recursion caveat, and no in-scope requirement states a corpus bound.
- **BL-1 filesystem-resolution intent.** Confirmed that `STR-001` reads only the corpus and that the
  `LICENSE` example is falsified; *unconfirmed* whether the maintainers intend `STR-001` to reach
  the filesystem or to be corpus-only-by-design (which would make it a docs-only fix).

---

## Subsystem coverage

Every subsystem named in the task Description was walked and is accounted for here, so coverage is
legible:

- **Core engine + primitives** — line-audited (`assert`, `content`, `table`, `section`,
  `reference`, `checklist` primitives; `regex`; `run-rules`; the rule families). Findings: TP-1,
  BL-1, SC-1, SC-2.
- **Compile** (`compile/` context, graph-analysis, skill-frontmatter, synthesize) — walked; **no
  findings**.
- **Discovery** (`repo-scan`, `globs`, `rule-inference`, `config-writer`, `package-manager`,
  `workspace-packages`) — `globs` and `rule-inference` line-audited (BL-1 glob rewrite, SC-3
  sampler); the rest spot-checked at call sites with **no findings surfaced**.
- **Config** (`config-schema`, `load-config`) — walked; **no findings**.
- **Generated schema** (`engine/schema.ts` enum surface, committed `packages/cli/schema.json`) —
  walked and cross-checked against the registry inventory guard; **no findings**.
- **CLI + init** (commands, `init` flow, program wiring) — walked; **no findings**.
- **MCP server** (tool registration, `lint`/`lint-files` contracts, descriptions) — line-audited;
  finding OG-1.
- **Requirements / glossary / guide docs** — cross-referenced against the engine; findings BL-1
  (guide) and OG-1 (requirement) record the doc-vs-code mismatches; the glossary and decisions were
  found consistent with shipped code (see Verified remediated).
- **Test suite** — reviewed for depth vs. shape-only checks; gaps recorded inline (BL-1's untested
  present-non-`.md` case at `packages/core/test/rules-str.test.ts:54`; TP-1's missing `g`/`y` case,
  `packages/core/test/rules-tbl.test.ts:80`).

**Named as spot-checked-only, not line-audited** (no anomaly surfaced through their consumers, but
they were not exhaustively read): `graph-render`, `doc-profile`, `describe-rules`, `repo-scan`,
`package-manager`, `workspace-packages`, skills front-matter parsing, the `init` prompter, and the
MCP `graph`/`slice`/`impact`/`compile` tool wrappers. These are flagged so their coverage is not
overstated.

## Cross-subsystem / cross-phase gaps

Three findings trace to earlier work left partial and never revisited:

- **OG-1** is a P7 (MCP) surface that diverges from the P3 rule-engine contract: `lint-files`
  learned custom rules, but the ad-hoc `lint` tool's input schema was never widened, and the M-3
  MCP-honesty remediation updated the description for REF/SEC file probing without covering the
  custom-rule limitation.
- **SC-1** is a P3.06 forward-compat decision (`GRP` options accepted but not honored) that no later
  phase wired or retired.
- **BL-1** is a P3.03/guide-authoring drift: the `STR-001` guide's `LICENSE` example was written
  against an idealized "whole project" reach that the corpus-only implementation never had.

## Verified remediated (so severity is not inflated by re-listing closed items)

The load-bearing P0–P8 audit findings are closed on this branch and were re-confirmed, not
re-counted as new problems:

- **M-1** multi-line `@import` positions — offset-based line/column tracking in
  `extractImports` (`packages/core/src/markdown/parse-document.ts:220`).
- **M-2** removal of the phantom `custom target: "heading"` — the glossary now states
  "No `heading` target exists" (`docs/mdlint_v2/glossary.md:268`).
- **M-3** MCP `lint` honesty — the description discloses REF/SEC path probing
  (`packages/mcp-server/src/tools/lint.ts:194`).
- **M-5 / M-6** CI — the OS matrix is `ubuntu`/`windows`/`macos`
  (`.github/workflows/ci.yml:25`) and the job runs `npm run format`
  (`.github/workflows/ci.yml:38`).
- **L-12** registry inventory guard — `registry-inventory.test.ts` asserts the exact shipped
  inventory against the real `BUILTIN_RULE_DEFINITIONS`
  (`packages/core/test/registry-inventory.test.ts:11`).

---

## Summary

| Category | Count | Highest severity |
|---|---|---|
| Business/logic defect | 1 (BL-1) | Medium |
| Technical problem | 1 (TP-1) | Low–Medium |
| Omission / gap | 1 (OG-1) | Low |
| Shortcoming | 3 (SC-1, SC-2, SC-3) | Low |

**Total: 6 findings (4 confirmed, 2 needs-confirmation). No HIGH / release-blocking defect.**

**Address first:**
1. **BL-1** — `STR-001`'s corpus-only reach silently fails to verify non-`.md` / out-of-`include`
   required files, and the guide's `LICENSE` example is wrong: a real correctness + documentation
   gap.
2. **TP-1** — the stateful-`g`/`y`-regex bug in `columnMatches` yields order-dependent false
   findings whenever a `g`/`y` flag is configured on `TBL-004` or a `custom` `columnMatches`.

**Confidence:** BL-1, TP-1, SC-1, SC-2 are confirmed against cited code, docs, and (for TP-1)
MDN/ECMA-262. OG-1 and SC-3 are recorded as *needs confirmation* and carried in Open questions
rather than asserted as defects.
