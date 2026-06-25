# P2.05 · `lintFiles()` orchestration

> Phase: [P2 — Rule engine & new config model](index.md) · Roadmap: [v2 Index](../index.md) ·
> Size **L** · Status **Not started**.

## Goal

Wire the whole lint pipeline: load documents from config, split rules by scope, run them,
resolve severity, apply inline-disable, and return file-attributed results.

## Sequence

- **Previous:** [P2.04 — Config model & loader](04-config-model-loader.md) produced a
  validated config, resolved rules, and resolved `settings`.
- **Next:** [P2.07 — First rules + `lint` command](07-first-rules-lint-command.md) drives this
  orchestration from the CLI.
- **Depends on:** P2.04 (and P2.01/P2.02 engine) · **Blocks:** P2.07; reused by graph/MCP.

## Inputs (from previous work)

- `loadDocuments()` (P1.05), engine `runRules` (P2.01), primitives (P2.02), registry (P2.03),
  config + settings (P2.04).

## Deliverables / steps

1. `lintFiles(config, cwd)`:
   - `loadDocuments(config.include ?? ["**/*.md"], { cwd, exclude: config.exclude,
     respectGitignore: config.respectGitignore })`;
   - resolve rules; split `document` vs `project` scope;
   - run project rules once over the `documents` map (file-attributed messages);
   - run document rules per file.
2. **Severity resolution** ([R1](../requirements/02-rules-engine.md)/[C2](../requirements/01-configuration.md)):
   apply per-rule `severity` override over `defaultSeverity`; **filter out `"off"`** rules
   before running.
3. **Inline-disable** ([R8](../requirements/02-rules-engine.md)): consult
   `document.directives` and drop messages whose `(ruleId, line)` falls under a matching
   `disable` / `disable-next-line`.
4. **Fail-fast** ([R4](../requirements/02-rules-engine.md)): project rules without `documents`
   throw (programming error), never silently no-op.
5. Pass the shared `ContextGraph` through `RuleContext.graph` once available
   ([R5](../requirements/02-rules-engine.md), built in P4); until then graph rules are
   inert/injected.
6. Deterministic ordering of results.

## Decisions applied

- [R1](../requirements/02-rules-engine.md), [R4](../requirements/02-rules-engine.md),
  [R5](../requirements/02-rules-engine.md), [R8](../requirements/02-rules-engine.md) ·
  [C2](../requirements/01-configuration.md), [C1/C8](../requirements/01-configuration.md).

## Exit criteria

- [ ] `lintFiles` runs document + project rules with correct file attribution.
- [ ] `"off"` rules skipped; per-rule severity overrides applied.
- [ ] Inline-disable suppresses exactly the targeted `(rule, line)` messages.
- [ ] Missing `documents` for a project rule throws.

## Hand-off to next

P2.07 calls `lintFiles` from the new `lint` command and proves the engine end-to-end on a few
rules; P3 grows the rule set; P4 supplies the shared graph for graph rules.
