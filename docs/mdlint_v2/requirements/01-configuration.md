# v2 Requirements — 01 · Configuration

> **Status:** Locked 2026-06-21 · Part of the [v2 roadmap](../index.md) (Phase **P2**).
>
> Locked v2 requirement for configuration; authoritative where the plan is otherwise ambiguous.

## Decisions

| # | Improvement | Status | Notes |
| --- | --- | --- | --- |
| **C1** | Top-level `exclude` | ✅ Accepted | `exclude` wins over `include`. |
| **C2** | Per-rule `severity` override (`error`/`warning`/`off`) | ✅ Accepted | Severity resolved at orchestration, not baked into the rule (see [Phase 2 / rule engine](02-rules-engine.md)). |
| **C3** | Single canonical rule ID (`REF-001`) in config and output | ✅ Accepted | Accept case-insensitive, dash-optional input; emit canonical. |
| **C4** | JSONC (comments + trailing commas), file stays `.json` | ✅ Accepted | Tolerant parser (e.g. `jsonc-parser`). No code execution → still honors D2 (JSON-only). |
| **C5** | Top-level `settings.siteRouter` inherited by rules | ✅ Accepted | Per-rule override allowed. DRY for SSG routing. |
| **C6** | Presets / `extends` | ⛔ Deferred | Revisit if `init` + manual config benefit from a shared preset source. |
| **C7** | Rich config diagnostics (did-you-mean, option path) | ✅ Accepted | Cheap DX win. |
| **C8** | `respectGitignore` flag | ✅ Accepted | Default `false`; opt-in to skip vendored/generated docs. |
| **C9** | Local, version-matched `$schema` — **no remote URL** | ✅ Accepted | Ship `schema.json` in the package; `$schema` is a relative path. Generated project-local schema covers custom rules. See [02-rules-engine.md](02-rules-engine.md). |

## Resulting config shape (annotated)

```jsonc
{
  "$schema": "./node_modules/@wastech-ctxlint/cli/schema.json",   // C9 — local, version-matched, offline; NO remote URL

  "include": ["**/*.md"],
  "exclude": ["node_modules/**", "dist/**", ".git/**"],   // C1 — exclude wins over include
  "respectGitignore": false,                              // C8 — opt-in

  "settings": {                                           // C5 — shared, rule-inheritable settings
    "siteRouter": {
      "preset": "starlight",
      "contentDir": "src/content/docs",
      "defaultLocale": "en"
    }
  },

  "rules": [
    // C3 — canonical ID; C2 — per-rule severity override
    { "rule": "REF-001", "severity": "warning", "options": { "exclude": ["legacy/**"] } },
    { "rule": "GRP-002" },                                // default severity from the rule
    { "rule": "GRP-003", "severity": "off" },             // documented but disabled
    { "rule": "REF-001", "options": { /* may override settings.siteRouter locally */ } }
  ],

  "compile": {
    "outdir": ".claude/skills/wastech-ctxlint",
    "skill": { "name": "...", "description": "..." }
  }
}
```

## Detail & rationale

- **C1 — top-level `exclude`.** A config with only `include` ("the world
  boundary"), forcing every cross-file rule to repeat its own `exclude`. A single
  global `exclude` removes duplication and matches ESLint/Prettier expectations.
  Resolution order: a path is in-scope if it matches `include` **and not** `exclude`.

- **C2 — per-rule severity.** The baseline engine bakes severity into the rule
  factory and cannot override it. v2 lets each rule entry set
  `severity: "error" | "warning" | "off"`. `"off"` keeps the rule documented but
  inactive (gradual rollout). The rule still declares a **default** severity;
  config overrides it. → engine change tracked in [02-rules-engine.md](02-rules-engine.md) (R1).

- **C3 — single rule ID.** Kill the `ref001` (config) vs `REF-001` (output) split the
  spec flags as a footgun. v2 accepts `REF-001`, `ref-001`, `ref001`
  (case-insensitive, dash optional) and always emits canonical `REF-001`. The
  `schema.json` sync test must normalize before comparing.

- **C4 — JSONC.** Hand-authoring a 21-rule config is painful; inline rationale
  comments and trailing commas are a big ergonomics win. File extension stays
  `.json`; a tolerant parser handles comments. Editor `$schema` validation must
  tolerate comments (most do).

- **C5 — shared `settings.siteRouter`.** The spec notes `siteRouter` is duplicated
  across `REF-001`/`GRP-002`/`GRP-003`. v2 lifts it to `settings.siteRouter`,
  inherited via `RuleContext`, with per-rule override. Single source of truth for
  SSG routing. → requires `RuleContext` to carry resolved `settings` (Phase 2).

- **C7 — diagnostics.** Unknown rule → `did you mean REF-001?`; bad options → exact
  path (`rules[3].options.idPattern: expected valid RegExp`). Turns the spec's
  "opaque options" into actionable errors.

- **C8 — `.gitignore`.** Real repos contain generated/vendored Markdown. Opt-in
  `respectGitignore: true` avoids scanning it without hand-listing in `exclude`.

- **C9 — schema delivery (no remote URL).** Pinning `$schema` to a raw GitHub URL on
  `main` is rejected: it floats off the installed version,
  breaks offline/air-gapped editors, and **cannot describe project-specific custom
  rules**. v2 instead:
  1. ships `schema.json` inside the published package (always matches the installed
     version);
  2. defaults `$schema` to a **relative local path**
     (`./node_modules/@wastech-ctxlint/cli/schema.json`) — offline + version-matched;
  3. provides a generator (`wastech-ctxlint schema`, also run by `init` when custom
     rules are present) that writes a **project-local** `schema.json` including the
     declarative custom-rule vocabulary, and repoints `$schema` to it.

  No remote URL is emitted anywhere — not even a versioned one.

## Downstream impact (for later phases)

- **Rule engine (P2):** severity must be resolved by the orchestrator (R1); a rule's
  declared severity becomes a *default*. `RuleContext` gains resolved `settings`.
- **schema.json sync test:** must handle canonical-ID normalization (C3) and the new
  top-level keys (`exclude`, `respectGitignore`, `settings`).
- **`init` (P6):** writes the new shape; emits canonical rule IDs; may add commented
  rationale lines (C4).
- **MCP / CLI:** unchanged contract, but `config` loading path now runs the JSONC
  parser and the richer diagnostics.

## Deferred / out of scope

- **C6 presets/`extends`** — revisit alongside `init`'s zero-config rule set.
