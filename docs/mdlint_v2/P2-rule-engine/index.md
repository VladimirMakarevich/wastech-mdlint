# Phase P2 — Rule engine & new config model

> Roadmap: [v2 Index](../index.md) · Phase **P2** · Size **L** · Status **Not started** ·
> Depends on [D2](../index.md), [D3](../index.md).
>
> **Goal:** build the central computational layer (rule engine + assertion primitives +
> registry + orchestration) and the new config model that drives it. This is the engine the
> 22 built-in rules ([P3](../index.md)) and the agent hosts ([P4–P7](../index.md)) all run on.

## Why this phase exists

The current implementation has three hardcoded rule functions and a sectioned config. The target is a
schema-validated registry over a closed **assertion-primitive vocabulary**, where the 22
built-ins are *presets* and users add **declarative custom rules** with no rebuild
([R9](../requirements/02-rules-engine.md)). Severity resolution ([R1](../requirements/02-rules-engine.md)/[C2](../requirements/01-configuration.md)),
inline-disable ([R8](../requirements/02-rules-engine.md)), structured findings
([R3](../requirements/02-rules-engine.md)), the new config
([C1–C9](../requirements/01-configuration.md)), and schema generation
([R6](../requirements/02-rules-engine.md)/[C9](../requirements/01-configuration.md)) all live here.

## Tasks

| # | Task | Size | Depends on |
| --- | --- | --- | --- |
| [P2.01](01-engine-core-types.md) | Engine core types: `Rule`/`RuleContext`/`LintMessage`/`runRules` | M | P1 done |
| [P2.02](02-assertion-primitives.md) | Assertion primitive vocabulary (executors over `ParsedDocument`) | L | P2.01 |
| [P2.03](03-registry-metadata.md) | Rule registry + single metadata source + canonical IDs | M | P2.02 |
| [P2.04](04-config-model-loader.md) | New config model + JSONC loader + `findConfig` | L | P2.03 |
| [P2.05](05-orchestration-lintfiles.md) | `lintFiles()` orchestration (scope, severity, inline-disable) | L | P2.04 |
| [P2.06](06-schema-generation.md) | `schema.json` generation + sync test + `schema` command | M | P2.03, P2.04 |
| [P2.07](07-first-rules-lint-command.md) | First rules through the engine + `lint` command (D4) | M | P2.05, P2.06 |

## Sequence

```
(P1.06) ─► P2.01 ─► P2.02 ─► P2.03 ─► P2.04 ─► P2.05 ─┐
                                  └────────► P2.06 ───┴─► P2.07 ─► (Phase P3)
```

P2.06 depends on P2.03 (metadata) + P2.04 (config shape) and can be built alongside P2.05.

## Decisions applied

- Config: [C1–C9](../requirements/01-configuration.md) · Engine:
  [R1, R3, R4, R6, R8, R9](../requirements/02-rules-engine.md) · [D2](../index.md) clean
  replace (greenfield) · [D3](../index.md) LLM rules · [D4](../index.md) `lint` default.

## Phase exit criteria

- [ ] `Rule`/`RuleContext`/`LintMessage` (with structured fields) + `runRules` implemented.
- [ ] Closed assertion-primitive vocabulary executes over `ParsedDocument`.
- [ ] Registry + single metadata source; rule IDs canonical ([C3](../requirements/01-configuration.md)).
- [ ] New config `{ $schema?, include?, exclude?, respectGitignore?, settings?, rules:[{rule,severity?,options?}], compile? }` parsed (JSONC), validated two-stage, with rich diagnostics.
- [ ] `lintFiles()` resolves severity (incl. `"off"`), applies inline-disable, fails fast on missing `documents`.
- [ ] `schema.json` generated from metadata + sync test; `wastech-ctxlint schema` writes a local schema; `$schema` is local (no remote URL).
- [ ] `lint` runs the new engine on a few proof rules; `scan` alias plan recorded for end of P3.

## What P2 unblocks

- **P3** — implement all 22 built-ins as presets over the primitives + the `custom` rule + LLM/SIZE rules.
- **P4** — graph rules + the shared `ContextGraph` plug into `lintFiles`.
- **P7** — MCP `lint`/`lint-files` call this engine; structured findings feed `structuredContent`.
