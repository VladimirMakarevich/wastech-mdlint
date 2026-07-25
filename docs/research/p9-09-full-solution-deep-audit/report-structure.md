# Report structure — P9.09 full-solution deep audit

_Structuring pass for the synthesis stage. This organizes the verified evidence from the
repository analysis (run-000076) and the external validation (run-000077) into the four-category,
severity-ordered shape the final audit needs, with every `path:line` anchor re-checked against the
tree on `feat/p9-remediation`. It is a blueprint for the writer, not the finished audit prose._

## How the report should open

- **Scope & method line:** plan of record (`docs/mdlint_v2/**` — requirements, decisions,
  glossary, guide) traced against shipped code across every subsystem; the frozen
  [P0–P8 audit](../../mdlint_v2/audit-2026-07-23-p0-p8.md) cross-referenced to separate residual
  problems from already-closed ones.
- **Bottom line the summary must land:** the solution is in good shape; the P9/P10 remediations
  have landed; **no HIGH / release-blocking defect** was found. The report carries **6 findings** —
  2 confirmed real defects (1 business/logic, 1 technical), 1 needs-confirmation gap, and 3
  shortcomings (2 confirmed, 1 needs-confirmation).
- **Confidence framing:** BL-1, TP-1, SC-1, SC-2 are confirmed against cited code/tests/spec;
  OG-1 and SC-3 are explicitly _needs confirmation_ and belong under Open questions, not asserted
  as defects.

Every code and doc citation below was re-opened and confirmed during this structuring pass.

---

## Category 1 — Business/logic defects

_Order: severity high → low. One finding._

### BL-1 · STR-001 only sees the Markdown corpus, and its guide overstates it — **Medium, confirmed**

- **Evidence (`path:line`):**
  - `packages/core/src/engine/rules/sec.ts:204-217` — `str001.check` reads `context.projectFiles`
    and satisfies each required entry with `matchesConfigGlob(filePath, [required])` over that
    corpus only; nothing touches the filesystem.
  - `packages/core/src/engine/lint-files.ts:87` — `projectFiles = [...documents.keys()]`, i.e. the
    `include`-matched (default `**/*.md`) Markdown corpus only.
  - `packages/core/src/discovery/globs.ts:7-15` — `normalizeConfigGlob` rewrites a bare
    `README.md` → `**/README.md`, so a required _root_ file is satisfied by any `docs/README.md`
    anywhere in the tree.
  - `packages/core/test/rules-str.test.ts:50-61` — tests only assert genuinely-absent `.md` names;
    the false-missing (present, non-`.md`) case is untested.
- **Standard it falls short of (with citation):**
  - Guide `docs/guide/rules/STR-001.md:11-13` motivates the rule with _"every project must ship a
    `README.md`, a `CONTRIBUTING.md`, a `LICENSE`"_ — `LICENSE` has no `.md` suffix and can never
    enter the corpus, so the guide's own example fails.
  - Guide `docs/guide/rules/STR-001.md:66` claims _"literal paths must match exactly,"_ which
    `normalizeConfigGlob` (`globs.ts:7-15`) directly contradicts — a bare literal is rewritten to
    match anywhere. Two distinct doc-vs-code mismatches in one guide.
  - Rule description `packages/core/src/engine/rules/sec.ts:196`: _"Required files exist in the
    project."_ — asserts a filesystem property the implementation does not check.
- **Why it matters:** **correctness** (a `LICENSE`, `package.json`, or any non-`.md` /
  out-of-`include` file present on disk is reported _missing_, a false positive on a real repo
  state) **+ documentation drift** (guide example is wrong; "literal paths match exactly" is
  false) **+ test-coverage gap** (no fixture with a present non-`.md` required file).
- **Recommended direction (subsystem/file):** in `sec.ts` STR-001, resolve required paths against
  the filesystem (e.g. `existsSync`) rather than only `projectFiles`; **and/or** narrow the
  contract in `docs/guide/rules/STR-001.md` + the STR requirement to "required Markdown files
  within `include`," drop the `LICENSE` example, and reconcile the "literal paths match exactly"
  claim with `normalizeConfigGlob`'s rewrite. Add a `rules-str.test.ts` case with a present
  non-`.md` required file.

---

## Category 2 — Technical problems

_Order: severity high → low. One finding._

### TP-1 · TBL-004 / `columnMatches` reuses a stateful `g`/`y` regex across rows → false findings — **Low–Medium, confirmed (incl. external spec)**

- **Evidence (`path:line`):**
  - `packages/core/src/engine/primitives/table.ts:137` — `const regex = compileRegex(options.pattern, options.flags)`
    compiled **once**, then `:147` — `regex.test(value)` called inside the per-row loop.
  - `packages/core/src/engine/regex.ts:25-29` — `regexFlagsSchema` validates only that flags are
    _legal_, so `g` and `y` pass unchecked.
  - Wired via TBL-004 (`packages/core/src/engine/rules/tbl.ts:207,219`) and the declarative
    `custom` `columnMatches` assertion (`packages/core/src/engine/primitives/assert.ts:66-73`).
  - No `g`/`y` test exists: `packages/core/test/primitives.test.ts:110-118` and
    `packages/core/test/rules-tbl.test.ts:80-88` use flag-less patterns.
- **Standard it violates (with citation):**
  - **External spec — MDN / ECMA-262 §22.2.6.16** (`RegExp.prototype.test`): a `g`/`y`-flagged
    `RegExp` is _stateful_, storing `lastIndex` between calls and **not resetting even across a
    different input string** while it keeps matching. Confirmed in external validation
    (run-000077, source 1). So `regex.test(cell)` over consecutive cells starts from a stale
    offset — an anchored `^REQ-\d+$` with `"flags":"g"` wrongly flags valid cells after the first
    match, order-dependently.
  - **Determinism invariant** — `.agents/rules/architecture.md` ("Generated output must be
    deterministic… deterministic findings") / AGENTS.md Architecture Invariants. Order-dependent
    findings violate it.
  - **The correct pattern is in-repo:** `packages/core/src/engine/primitives/content.ts:14-18`
    (`contentNotMatch`) force-adds `g` and consumes via `matchAll`, which per MDN / ECMA-262
    §22.1.3.12 requires `g` and manages state per call (external validation, source 2).
  - Guide `docs/guide/rules/TBL-004.md:25` suggests `flags` "e.g. `i`, `m`" with no note that
    `g`/`y` are unsafe.
- **Why it matters:** **correctness + determinism** — false positives/negatives that change with
  row order for any TBL-004 or custom `columnMatches` configured with a `g`/`y` flag;
  **test-coverage gap** — no regression guards the flag path.
- **Recommended direction (subsystem/file):** in `primitives/table.ts` `columnMatches`, reset
  `regex.lastIndex = 0` per row, **or** strip `g`/`y` before compiling a membership test, **or**
  reject `g`/`y` in the `flags` schema for this assertion (`engine/regex.ts` /
  `assert.ts`). Add a `g`/`y` regression to `rules-tbl.test.ts` / `primitives.test.ts`; note the
  restriction in `docs/guide/rules/TBL-004.md`.

---

## Category 3 — Omissions / gaps

_Order: severity high → low. One finding. This is also the report's flagged cross-subsystem /
cross-phase contract split._

### OG-1 · `lint` MCP tool cannot run declarative custom rules — **Low, needs confirmation**

- **Evidence (`path:line`):**
  - `packages/mcp-server/src/tools/lint.ts:42-45` — `lintInputShape.rules = z.array(ruleEntrySchema)`,
    the built-in-only entry; `customRuleEntrySchema` / the union entry is not accepted, and the
    tool description does not disclose the narrowing.
- **Standard it falls short of (with citation):**
  - Requirement **M8** (`docs/mdlint_v2/requirements/05-mcp-server.md:20`, detail at `:54-57`): the
    MCP server "runs declarative custom rules (data) but never Tier-2 code-plugins" — custom rules
    are explicitly in-scope for the server, referencing **R9** (`02-rules-engine.md`).
  - Architecture invariant (AGENTS.md; `core-hosts-the-pipeline`): CLI/MCP are thin adapters over
    one core pipeline. The contract is **split** — `lint-files` honors custom rules through loaded
    config, but the ad-hoc `lint` tool's input schema rejects a `{ "rule": "custom", … }` entry.
- **Why it matters:** **architectural drift / contract split across the MCP surface** — the same
  "run custom rules" capability is available through one MCP tool and silently absent from the
  other, with no description saying so. Likely an intentional narrowing (ad-hoc lint = built-ins),
  which is why it is _needs confirmation_, not asserted.
- **Cross-phase chain to state:** the custom-rule contract is exercised end-to-end by `lint-files`
  (P7 MCP wiring over P2/P3 engine) but the ad-hoc `lint` tool schema was left built-in-only and
  never revisited — an earlier-surface decision that the honesty-of-descriptions remediation
  (P9/P10 M-3) touched for REF/SEC probing but not for the custom-rule omission. **What remains
  open:** confirm whether narrowing is intended, then either widen the schema or document it.
- **Recommended direction (subsystem/file):** in `mcp-server/src/tools/lint.ts`, either accept the
  union rule-entry schema (`ruleEntryUnionSchema`) so ad-hoc `lint` runs custom rules, **or** state
  in the tool description that ad-hoc `lint` is built-in-rules-only and custom rules go through
  `lint-files`.

---

## Category 4 — Shortcomings

_Order: severity high → low. Three findings (all Low; SC-1/SC-2 confirmed, SC-3 needs
confirmation)._

### SC-1 · GRP-001 accepts `files`/`exclude`/`siteRouter` (and GRP-002 `siteRouter`) that are silently ignored — **Low, confirmed**

- **Evidence (`path:line`):**
  - `packages/core/src/engine/rules/grp.ts:32-37` — grp001 options schema declares `siteRouter` +
    `...fileScopeShape` (`files`/`exclude`); `:38-57` — `check: () => …` uses none of them (it reads
    only the shared corpus-wide `context.graph`).
  - `packages/core/src/engine/rules/grp.ts:71-77` — grp002 likewise declares `siteRouter`, unused.
- **Standard it falls short of:** config-surface honesty — a key that passes `.strict()` Zod
  validation yet has no effect. Documented as "forward-compat" in the P3.06 journal, but that is not
  a shipped contract.
- **Why it matters:** **user-facing correctness expectation** — a user who scopes GRP-001 with
  `files` gets a silent no-op (the corpus-wide graph is never re-scoped per rule), with no
  diagnostic.
- **Recommended direction (subsystem/file):** in `engine/rules/grp.ts`, either wire the scoping
  options into the graph query or remove them from the options schemas until they are honored;
  keep the generated `schema.json` / guide in sync with whichever way it goes.

### SC-2 · SIZE-001 can emit duplicate same-severity findings for one metric under a `severity` override — **Low, confirmed**

- **Evidence (`path:line`):**
  - `packages/core/src/engine/rules/size.ts:95-112` — a file over both thresholds fires an
    independent "warn budget" finding **and** an "error budget" finding for the same metric.
  - `packages/core/src/engine/run-rules.ts:42` — a config `severity` override wins over the
    per-finding severity hint, so both render at the overridden severity.
- **Standard it falls short of:** SIZE-001's "independent firing" is documented (P3.07 comment at
  `size.ts:94`), but the **override interaction** — override collapses the two into two
  near-duplicate same-severity messages — is not documented in the SIZE-001 guide.
- **Why it matters:** **UX / report clarity** — two near-duplicate findings for one metric on one
  file under a `severity:"error"` override; not a correctness bug but a noisy, unexplained output.
- **Recommended direction (subsystem/file):** in `engine/rules/size.ts` (or `run-rules.ts`),
  suppress the redundant lower-threshold finding when an override collapses severities, **or**
  document the behavior in `docs/guide/rules/SIZE-001.md`.

### SC-3 · Unbounded recursive DFS in cycle detection / import traversal — **Low, needs confirmation**

- **Evidence (`path:line`):**
  - `packages/core/src/graph/build-context-graph.ts:282` (`strongConnect`) and `:343` (`walk`).
  - `packages/core/src/engine/rules/llm.ts:66` (`visit`).
  - `packages/core/src/discovery/rule-inference.ts:284` (`visit`).
  - All four recurse with no explicit depth guard.
- **Standard it falls short of:** no upstream spec fixes a specific bound (external validation notes
  only the generic Node.js call-stack caveat); v2 rebuilds non-incrementally with no stated corpus
  bound.
- **Why it matters:** **robustness at scale** — a pathologically deep link/import chain (thousands
  of docs) could exceed the call stack. Almost certainly fine for realistic repos; unverified at
  scale, hence _needs confirmation_.
- **Recommended direction (subsystem/file):** document the practical corpus-size assumption in the
  graph subsystem, **or** convert the hottest traversal in `graph/build-context-graph.ts` to an
  explicit stack if very large repos are in scope.

---

## Subsystem coverage matrix

_Acceptance criterion: no subsystem silently skipped. Each row states finding-or-clean and how it
was covered._

| Subsystem                                                                                        | Coverage                                                    | Finding(s) / status                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core engine — rules & primitives (assert, checklist, content, reference, section, table)         | Deep-read                                                   | **TP-1** (`table.ts` `columnMatches`); primitives otherwise clean — `content.ts` `contentNotMatch` is the correct pattern                                                               |
| Core engine — orchestration (run-rules, suppression, fix, severity)                              | Deep-read                                                   | Clean; `run-rules.ts:42` override precedence is the mechanism behind **SC-2**, not itself a defect                                                                                      |
| Rules — STR/SEC family                                                                           | Deep-read                                                   | **BL-1** (`sec.ts` STR-001)                                                                                                                                                             |
| Rules — GRP family                                                                               | Deep-read                                                   | **SC-1** (`grp.ts` unused scoping options)                                                                                                                                              |
| Rules — SIZE family                                                                              | Deep-read                                                   | **SC-2** (`size.ts` dual firing under override)                                                                                                                                         |
| Graph subsystem (`build-context-graph`, query/BFS, slice, impact)                                | Deep-read                                                   | **SC-3** (recursive DFS); one shared `ContextGraph` + one `query()` confirmed, no parallel traversal                                                                                    |
| Compile (context, graph-analysis, skill-frontmatter, synthesize)                                 | Deep-read                                                   | **No findings**                                                                                                                                                                         |
| Discovery (globs, repo-scan, rule-inference, config-writer, package-manager, workspace-packages) | Mixed                                                       | `globs.ts` `normalizeConfigGlob` compounds **BL-1**; `rule-inference.ts` DFS in **SC-3**; repo-scan / package-manager / workspace-packages spot-checked at call sites — **no findings** |
| Config (config-schema, load-config)                                                              | Deep-read                                                   | **No findings**                                                                                                                                                                         |
| Generated schema (`engine/schema.ts` enum, committed `packages/cli/schema.json`)                 | Deep-read                                                   | **No findings**; registry inventory guard now asserts exactly 24 ids / 8 categories (remediated)                                                                                        |
| CLI + init (program wiring, commands, init flow, prompter)                                       | Spot-checked at call sites                                  | **No findings** surfaced through consumers                                                                                                                                              |
| MCP server (lint, lint-files, registry, graph/slice/impact/compile tool wrappers)                | Deep-read (lint/lint-files/registry); wrappers spot-checked | **OG-1** (`lint` tool custom-rule schema); 6 read-only stdio tools confirmed                                                                                                            |
| Docs — requirements / decisions / glossary                                                       | Cross-referenced                                            | Clean on audited terms; M-2 heading-target removal confirmed in `requirements/02-rules-engine.md:47` + `glossary.md:268-269`                                                            |
| Docs — guide (`docs/guide/**`)                                                                   | Cross-referenced                                            | **BL-1** (STR-001.md:11-13, :66) and **TP-1** (TBL-004.md:25) doc-vs-code mismatches                                                                                                    |
| Test suite (depth, meaningful vs shape-only, gaps)                                               | Deep-read                                                   | Coverage gaps feed **BL-1** (no present non-`.md` required-file test) and **TP-1** (no `g`/`y` flag test); registry inventory guard added                                               |

**Explicitly out of scope / not line-audited (named per acceptance criterion):** `graph-render`,
`doc-profile`, `describe-rules`, `repo-scan`, `package-manager`, `workspace-packages`, skills
parsing, `init-prompter`, and the MCP graph/slice/impact/compile tool wrappers were spot-checked at
their call sites, not line-by-line audited; no anomaly surfaced through their consumers.

---

## Confirmed vs. needs-confirmation (for the Open-questions section)

- **Confirmed defects/shortcomings** (cited code/tests/spec all check out): **BL-1**, **TP-1**
  (incl. external MDN/ECMA-262 validation), **SC-1**, **SC-2**.
- **Needs confirmation (do not assert as defects; carry under Open questions):**
  - **OG-1** — likely an intentional built-in-only narrowing of ad-hoc `lint`; open question is
    whether to widen the schema or document the limit.
  - **SC-3** — recursion almost certainly fine at realistic scale; open question is whether very
    large corpora are in v2 scope and whether to bound/rewrite the DFS.

---

## Cross-subsystem / cross-phase gap chains (keep identifiable in synthesis)

1. **Custom-rule contract split (OG-1)** — CLI/core honor declarative custom rules end-to-end and
   the MCP `lint-files` tool does too, but the ad-hoc MCP `lint` tool schema (P7 surface) was left
   built-in-only and never revisited; the P9/P10 MCP-honesty remediation (M-3) fixed REF/SEC probing
   disclosure but not this omission. Open: intended narrowing vs. gap.
2. **GRP scoping options (SC-1)** — introduced as "forward-compat" in P3.06 and still un-wired; a
   validated-but-inert config surface carried across phases without either landing the feature or
   removing the keys.
3. **STR-001 corpus reach vs. guide (BL-1)** — the rule's corpus-only implementation and the guide's
   filesystem-level promises (`LICENSE`, "literal paths match exactly") drifted apart across the
   P3 rule work and the guide-authoring pass; neither the requirement text nor the guide was
   reconciled to the shipped `projectFiles` reach.

---

## Verified-remediated (evidence the audit walked prior findings, not new problems)

Include a short "already closed" block so severity isn't inflated by re-listing fixed items. Every
MEDIUM and load-bearing LOW from the P0–P8 audit is closed on this branch:

- **M-1** multi-line `@import` positions → offset-based line/column in `parse-document.ts:220-256`,
  tested at `parse-document.test.ts:226-256`.
- **M-2** `custom target:"heading"` → removed from `requirements/02-rules-engine.md:47` and
  `glossary.md:268-269`; `ASSERTION_TARGETS` has no `heading`.
- **M-3** MCP `lint` honesty → description discloses REF/SEC file probing (`tools/lint.ts:194-197`).
- **M-4** determinism → `localeCompare` replaced by code-point `compareStrings` throughout.
- **M-5 / M-6** → CI matrix now ubuntu/windows/macos and runs `npm run format`
  (`.github/workflows/ci.yml:19-40`).
- **M-7/M-8, L-12** → governance/glossary status refreshed; registry inventory guard added
  (`test/registry-inventory.test.ts`: exactly 24 ids / 8 categories, no `CHK`).

**Architecture invariants confirmed intact:** CLI and MCP are thin adapters over
`@wastech-mdlint/core` (no forked `lintFiles`/config/formatting); one shared `ContextGraph` + one
`query()` BFS feed slice/impact/compile; output is deterministic repo-relative POSIX; config is
JSONC with a local `$schema`; MCP is stdio-only with 6 read-only tools.

---

## Closing summary the report must end on

| Category              | Count                | Highest severity         |
| --------------------- | -------------------- | ------------------------ |
| Business/logic defect | 1 (BL-1)             | Medium                   |
| Technical problem     | 1 (TP-1)             | Low–Medium               |
| Omission / gap        | 1 (OG-1)             | Low (needs confirmation) |
| Shortcoming           | 3 (SC-1, SC-2, SC-3) | Low                      |

**Address first:**

1. **BL-1** — STR-001's corpus-only reach silently fails to verify non-`.md` / out-of-`include`
   required files, and the guide's `LICENSE` example + "literal paths match exactly" claim are
   wrong. Real, user-visible correctness + documentation gap.
2. **TP-1** — the stateful `g`/`y` regex in `columnMatches` yields order-dependent false findings
   for any TBL-004 / custom `columnMatches` configured with those flags; confirmed against
   ECMA-262 semantics.

No HIGH / release-blocking defect. OG-1 and SC-3 stay under Open questions as needs-confirmation.
