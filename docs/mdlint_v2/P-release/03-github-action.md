# 03 · Reusable GitHub Action for consumers

> Part of the [release checklist](index.md).

## Goal

Ship a reusable composite Action so a consumer runs `wastech-mdlint` in CI in one step instead of assembling an install-and-run block themselves.

This is additive. `.github/workflows/ci.yml` (the workspace verification gate, plus a `pack` job matrixed over the three packages) and `.github/workflows/publish.yml` already exist and are this repository's own CI. What is missing is the consumer-facing half.

## Steps

1. A composite Action that installs the CLI and runs `lint`, with `--fail-on`, `--config` and `--format` configurable, surfacing findings in the job log.

2. Point the workflow template that `init` can drop into a repository at the Action. Until the Action exists, `buildCiWorkflowYaml` in `config-writer.ts` emits a self-contained `npm install` plus `npx wastech-mdlint lint` block, because a template cannot `uses:` something unpublished. Swapping that template is part of this task, not a follow-up: the two will otherwise describe different ways of doing the same thing.

3. Optional: map structured findings to SARIF so results appear in GitHub code scanning. The rule engine already produces findings with a path, a line, a column, a rule ID and a severity, which is the whole of what SARIF needs.

## Done when

- [ ] The Action runs the linter in a consumer repository's CI and reports findings.
- [ ] The workflow template `init` writes references the Action.
