# Adopt the linter and wire it into CI

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** go from zero to a working config and a CI gate.

```bash
wastech-mdlint init                       # interactive: scans, infers a rule set, writes config
wastech-mdlint init --yes                 # CI-friendly: accept the inferred draft, no prompts
wastech-mdlint init --yes --with-ci-workflow   # also drop .github/workflows/wastech-mdlint.yml
```

Then gate CI on exit codes:

```bash
wastech-mdlint lint .                 # exit 1 on errors → fails the job
wastech-mdlint lint . --fail-on warning
```

**You get:** a `wastech-mdlint.config.json` with a local `$schema` and rationale comments, plus a
CI-ready lint step. `init` writes nothing on install — configuration is always explicit. See
[`init`](../cli.md#init) and [Output → exit codes](../output.md#exit-codes).
