# v2 Requirements — 02 · Rules & Rule Engine

> **Status:** Locked 2026-06-21 · Part of the [v2 roadmap](../index.md)
> (Phases **P2** engine, **P3** rules).
>
> Locked v2 requirement; authoritative where the plan is otherwise ambiguous.

## Decisions

| # | Improvement | Status | Notes |
| --- | --- | --- | --- |
| **R1** | Severity resolved by the orchestrator, not baked into the rule | ✅ Accepted | Rule declares `defaultSeverity`; config overrides; `"off"` filters. Engine side of [C2](01-configuration.md). |
| **R2** | Auto-fix hook (`fix?`) + CLI `--fix` | ✅ Accepted | Design the hook now; implement for a safe rule subset incrementally. |
| **R3** | Structured findings | ✅ Accepted | `column?`, `endLine?`, `fixable?`, `data?`, `helpUri?` on `LintMessage`. Enables SARIF + machine action. |
| **R4** | Fail-fast instead of silent no-op when `documents` missing | ✅ Accepted | Core always passes `documents`; absence is a programming error. |
| **R5** | One `ContextGraph` for all graph rules | ✅ Accepted | `GRP-001/002` + `REF-003` consume `buildContextGraph` extended with `exclude`/`entryPoints`/`siteRouter`. Ties to [C5](01-configuration.md). |
| **R6** | Single source of rule metadata | ✅ Accepted | `category`, `defaultSeverity`, `fixable`, `docsUrl`, messages → generates `schema.json`, README, `describeRules`, `init` categories. |
| **R7** | Shared `files`/`exclude` options base for every rule | ✅ Accepted | Uniform scoping across all rules. |
| **R8** | Inline suppression directives | ✅ Accepted | `<!-- wastech-mdlint-disable[-next-line] RULE-ID -->`. Parser captures comments + positions. |
| **R9** | **Custom rules without rebuild/publish** | ✅ Accepted (declarative) | Declarative `custom` rule composes a fixed primitive vocabulary. Code-plugins **deferred** (interface kept open). |

## R9 — Custom rules (the headline change)

A static registry means a new rule requires editing code + registry +
tests + docs and publishing a new version. v2 must let teams add custom invariants
**instantly, from config, with no rebuild and no publish.** Three flexibility tiers:

### Tier 0 — built-ins as templates (already true)
Most of the 22 rules are parameterized engines (`TBL-003` allowed values, `TBL-004`
regex, `SEC-001` required sections). Users already "author rules" via options — but
cannot express a *new kind* of invariant.

### Tier 1 — declarative custom rules ✅ (primary mechanism)
A `custom` rule composes a **closed, Zod-validated vocabulary of assertion
primitives** over `ParsedDocument`. No code, no rebuild, pure JSON(C), and **safe to
run inside the MCP server** (which executes in an agent context where running
arbitrary user code would be dangerous).

```jsonc
{
  "rule": "custom",
  "id": "REQ-OWNER",                 // user ID, namespaced; must not collide with built-ins
  "description": "Each requirement row must have an Owner",
  "severity": "error",
  "target": "table",                 // table | section | content | checklist | link | heading
  "options": {
    "files": ["docs/requirements/**/*.md"],
    "assert": { "kind": "columnNotEmpty", "column": "Owner" }
  }
}
```

**Primitive vocabulary** (discriminated union on `kind`, validated like any rule):
- **table:** `requiredColumns`, `columnNotEmpty`, `columnInSet`, `columnMatches`,
  `columnUnique`, `crossColumn` (when→then)
- **section:** `sectionPresent`, `sectionOrder`
- **content:** `contentNotMatch`, `noPlaceholders`
- **checklist:** `allChecked`
- **link/image:** `linkResolves`, `imageResolves`

**Key consequence:** the **22 built-in rules are re-expressed as named presets over
these same primitives.** Built-ins and custom rules share one execution engine.
Because the vocabulary is closed, the published `schema.json` can validate the
`custom` shape generically (see C9).

### Tier 2 — local code-plugins ⛔ deferred (interface kept open)
For logic the primitives can't express (`plugins: ["./rules/my-rule.mjs"]`).
**Deferred from v2** because it means executing user code — an explicit exception to
[D2](../index.md) (JSON-only / no code execution) and a security risk inside the MCP
server. The `Rule`/registry interfaces stay clean enough to add this later; no
`plugins` config key ships in v2 (its presence would imply it works).

## Engine contract changes

`Rule` (additions): `defaultSeverity` (replaces hard-coded `severity`, R1),
`category` + `docsUrl` + `fixable` metadata (R6), optional
`fix?(context): TextEdit[]` (R2).

`RuleContext` (additions): resolved `settings` (e.g. inherited `siteRouter`, C5/R5),
access to the shared `ContextGraph` (R5). Absence of `documents` for a project rule
throws rather than no-ops (R4).

`LintMessage` (additions): `column?`, `endLine?`, `fixable?`, `data?` (offending /
expected value, column), `helpUri?` (R3). Existing fields unchanged → JSON output is
a superset, safe for current consumers.

`runRules` / `lintFiles`: severity override + `"off"` filtering applied here (R1);
inline-disable directives consulted before reporting (R8); one `buildContextGraph`
built once and shared (R5).

## Schema generation (cross-ref C9)

`schema.json` is generated from the rule-metadata source (R6) and includes the
declarative-rule vocabulary (R9 Tier 1). `init`/`wastech-mdlint schema` writes a
project-local copy when custom rules are present so editors validate custom IDs.
**No remote `$schema` URL.**

## Deferred / out of scope for v2

- **Tier 2 code-plugins** (above) — interface-ready, not shipped.
- **Async rules / external HTTP checks** — conflicts with the core-hosts-the-pipeline decision (sync pipeline)
  and determinism.
- **`info`/`hint` severity** — keep two actionable levels + `"off"` (C2).

## Downstream impact

- **Parser (P1):** must capture HTML comments + positions for inline-disable (R8),
  and expose everything the primitive vocabulary needs (tables/sections/checklist/
  links — already planned).
- **Graph (P4):** `buildContextGraph` gains `exclude`/`entryPoints`/`siteRouter`
  inputs so graph rules reuse it (R5).
- **Compile (P5):** `describeRules` reads the rule-metadata source (R6) and must
  describe custom rules too.
- **CLI (P6+):** `--fix` flag (R2); `wastech-mdlint schema` command (C9).
- **MCP (P7):** never loads code-plugins; declarative custom rules work unchanged.
- **Skill `-fix` (P8):** delegates mechanical fixes to deterministic core `--fix`;
  keeps only judgement calls for the AI.
